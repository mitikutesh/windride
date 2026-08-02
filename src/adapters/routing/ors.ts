// adapters/routing/ors.ts — openrouteservice RouteProvider (WR-005).
// Round-trip + point-to-point directions, parsed to fully-segmented CandidateRoutes, a diverse
// candidate generator, and overlap dedupe (engine/geometry.overlapRatio). Adapters are the only
// place fetch() may appear (CLAUDE.md rule 4); free-tier budget matters (API_NOTES §2).
import { destination } from '@turf/turf';
import {
  ORS_ARRIVAL,
  ORS_UTURN,
  type CandidateRoute,
  type LatLon,
  type RoundTripParams,
  type Segment,
  type Surface,
  type TurnStep,
} from '../../domain';
import { expandRangesToEdges, normalizeDeg, overlapRatio, resample } from '../../engine/geometry';
import { fetchFailure, ProviderError } from '../errors';
import { createIdbCache, type TtlCache } from '../idbCache';
import type { RouteProvider } from './index';

const BASE = 'https://api.openrouteservice.org';
const ROUND_TRIP_CAP_M = 100_000; // ORS round-trip is capped at 100 km (API_NOTES §2)
const TTL_MS = 24 * 60 * 60 * 1000;

// ORS extra_info surface codes -> our Surface (subset; unknown for anything unmapped).
const SURFACE_BY_CODE: Record<number, Surface> = {
  1: 'paved',
  3: 'paved',
  4: 'paved',
  5: 'paved',
  6: 'paved',
  14: 'paved',
  18: 'paved',
  8: 'gravel',
  9: 'gravel',
  10: 'gravel',
  2: 'path',
  11: 'path',
  12: 'path',
  15: 'path',
  16: 'path',
  17: 'path',
};
function mapSurface(code: number): Surface {
  return SURFACE_BY_CODE[code] ?? 'unknown';
}

const WAYTYPE_BY_CODE: Record<number, string> = {
  0: 'unknown',
  1: 'state road',
  2: 'road',
  3: 'street',
  4: 'path',
  5: 'track',
  6: 'cycleway',
  7: 'footway',
  8: 'steps',
  9: 'ferry',
  10: 'construction',
};
function mapWayType(code: number): string {
  return WAYTYPE_BY_CODE[code] ?? 'unknown';
}

// --- ORS geojson types (only the fields we read) -------------------------------------------
type OrsRange = readonly [number, number, number];
interface OrsFeature {
  geometry: { coordinates: Array<[number, number, number?]> };
  properties: {
    summary: { distance: number; ascent?: number };
    segments: Array<{
      steps: Array<{
        distance: number;
        duration: number;
        type: number;
        instruction: string;
        way_points: [number, number];
      }>;
    }>;
    extras?: {
      surface?: { values: OrsRange[] };
      waytypes?: { values: OrsRange[] };
    };
  };
}
interface OrsResponse {
  features: OrsFeature[];
}

// --- live-call budget counter (API_NOTES §2: ~6-8/plan, <=30/dev session) ------------------
let liveCalls = 0;
export function getOrsLiveCallCount(): number {
  return liveCalls;
}
export function resetOrsLiveCallCount(): void {
  liveCalls = 0;
}

/** Parse one ORS geojson feature into a fully-segmented CandidateRoute (WR-005). Exported for tests. */
export function parseOrsRoute(feature: OrsFeature, id: string): CandidateRoute {
  const coords = feature.geometry.coordinates;
  const polyline: LatLon[] = coords.map((c) => ({ lat: c[1], lon: c[0] }));
  const hasEle = coords.every((c) => typeof c[2] === 'number');
  const elevations = hasEle ? coords.map((c) => c[2] as number) : undefined;

  const surfaceRanges = feature.properties.extras?.surface?.values ?? [];
  const wayRanges = feature.properties.extras?.waytypes?.values ?? [];
  const surfaces = surfaceRanges.length
    ? expandRangesToEdges(surfaceRanges, polyline.length, mapSurface, 'unknown')
    : undefined;
  const wayClasses = wayRanges.length
    ? expandRangesToEdges(wayRanges, polyline.length, mapWayType, 'unknown')
    : undefined;

  const segments = resample({ polyline, elevations, surfaces, wayClasses });
  const steps: TurnStep[] = feature.properties.segments.flatMap((seg) =>
    seg.steps.map((s) => ({
      instruction: s.instruction,
      distanceM: s.distance,
      durationS: s.duration,
      type: s.type,
      wayPoints: s.way_points,
    })),
  );

  return {
    id,
    polyline,
    segments,
    distanceM: feature.properties.summary.distance,
    ascentM: feature.properties.summary.ascent ?? ascentFromSegments(segments),
    steps,
  };
}

function ascentFromSegments(segments: Segment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, (s.gradePct / 100) * s.lengthM), 0);
}

export interface OrsOptions {
  apiKey?: string;
  /** Injectable fetch for fixture-mode tests (defaults to global fetch). */
  fetchFn?: typeof fetch;
  cache?: TtlCache<CandidateRoute>;
  now?: () => number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

// 4 dp (~11 m) keeps cache hits for the same spot while staying inside the contract's 50 m
// "starts at start" tolerance (a coarser round could return a route starting up to ~78 m away).
function round4(n: number): string {
  return n.toFixed(4);
}

/** Short deterministic hash of a cache key, appended to route ids so they are globally unique. */
function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** Best-effort extraction of ORS's own error message from a non-OK body (shape varies by status). */
async function orsErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: string | { message?: string } };
    return typeof body.error === 'string' ? body.error : body.error?.message;
  } catch {
    return undefined;
  }
}

export class OrsRouteProvider implements RouteProvider {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: TtlCache<CandidateRoute>;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(opts: OrsOptions = {}) {
    // Trim: a key pasted with a trailing newline/space makes fetch() throw on the invalid
    // Authorization header — indistinguishable from being offline, so it must never reach fetch.
    // The .env fallback is DEV-only (DEC-059): Vite dead-code-eliminates it from prod builds, so
    // the owner's key can never be baked into dist/. Production keys come from the runtime keychain.
    this.apiKey = (
      opts.apiKey ??
      (import.meta.env.DEV ? import.meta.env.VITE_ORS_API_KEY : undefined) ??
      ''
    ).trim();
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.cache =
      opts.cache ?? createIdbCache<CandidateRoute>('windride-routes', 'routes', this.now);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async post(profile: string, body: unknown): Promise<OrsResponse> {
    // A missing key can never succeed — fail fast with an actionable code instead of burning a
    // live call that comes back as an opaque 403/CORS failure.
    if (!this.apiKey) {
      throw new ProviderError('badResponse', 'openrouteservice API key missing', 'no-key');
    }
    liveCalls++;
    if (import.meta.env.MODE === 'development') {
      console.info(`[ORS] live call #${liveCalls} (${profile})`);
    }
    // One AbortController + timer covers BOTH header arrival and body read, aborts the losing
    // request, and is always cleared in finally (no lingering timer after a fast response).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchFn(`${BASE}/v2/directions/${profile}/geojson`, {
          method: 'POST',
          headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw fetchFailure('ORS', controller.signal.aborted);
      }
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError(
          'badResponse',
          (await orsErrorDetail(res)) ?? 'openrouteservice rejected the API key',
          'auth',
        );
      }
      if (res.status === 429) throw new ProviderError('quota', 'ORS rate limit');
      if (!res.ok) {
        const detail = await orsErrorDetail(res);
        throw new ProviderError('badResponse', `HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      try {
        return (await res.json()) as OrsResponse;
      } catch {
        if (controller.signal.aborted) throw fetchFailure('ORS', true);
        throw new ProviderError('badResponse', 'invalid JSON');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async roundTrip(p: RoundTripParams): Promise<CandidateRoute> {
    if (p.lengthM > ROUND_TRIP_CAP_M) {
      // 'roundtrip-cap' code: the UI must phrase this (retrying can never succeed), not offer retry.
      throw new ProviderError(
        'badResponse',
        'Round-trip length exceeds the 100 km ORS cap',
        'roundtrip-cap',
      );
    }
    const key = `${round4(p.start.lat)},${round4(p.start.lon)}#${p.lengthM}#s${p.seed}#p${p.points}#${p.profile}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const body = {
      coordinates: [[p.start.lon, p.start.lat]],
      elevation: true,
      extra_info: ['surface', 'waytype', 'steepness'],
      instructions: true,
      options: { round_trip: { length: p.lengthM, points: p.points, seed: p.seed } },
    };
    const json = await this.post(p.profile, body);
    const feature = json.features?.[0];
    if (!feature) throw new ProviderError('badResponse', 'no route feature');
    const route = parseOrsRoute(feature, `ors-rt-${p.seed}-${p.points}-${shortHash(key)}`);
    await this.cache.set(key, route, this.now() + TTL_MS);
    return route;
  }

  async pointToPoint(a: LatLon, b: LatLon, profile: string): Promise<CandidateRoute> {
    const key = `p2p#${round4(a.lat)},${round4(a.lon)}-${round4(b.lat)},${round4(b.lon)}#${profile}`;
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const body = {
      coordinates: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      elevation: true,
      extra_info: ['surface', 'waytype', 'steepness'],
      instructions: true,
    };
    const json = await this.post(profile, body);
    const feature = json.features?.[0];
    if (!feature) throw new ProviderError('badResponse', 'no route feature');
    const route = parseOrsRoute(feature, `ors-p2p-${shortHash(key)}`);
    await this.cache.set(key, route, this.now() + TTL_MS);
    return route;
  }
}

// --- candidate generation & dedupe ---------------------------------------------------------
export interface GenerateOptions {
  seeds?: number[];
  pointsVariation?: Array<3 | 4 | 5>;
  /** Absolute bearings for out-and-back variants ([] to disable). Wind-relative bearings later. */
  bearings?: number[];
  overlapThreshold?: number;
  /** Progress callback fired as each candidate task settles (for the Plan screen's progress). */
  onSettled?: (done: number, total: number) => void;
}

/**
 * What the fold of an out-and-back says. Must avoid 'arrive'/'destination'/'goal' — `cues.ts`
 * `isArrival` sniffs the instruction text as well as the maneuver code.
 */
export const TURNAROUND_INSTRUCTION = 'Turn around and ride back';

/** Turn a one-way leg into a there-and-back CandidateRoute (segments mirrored, bearings +180). */
function outAndBack(leg: CandidateRoute, id: string): CandidateRoute {
  const back = [...leg.polyline].reverse().slice(1);
  const polyline = [...leg.polyline, ...back];
  const backSegs: Segment[] = [...leg.segments].reverse().map((s) => ({
    ...s,
    a: s.b,
    b: s.a,
    bearingDeg: normalizeDeg(s.bearingDeg + 180),
    gradePct: -s.gradePct,
  }));
  const segments = [...leg.segments, ...backSegs];
  return {
    id,
    polyline,
    segments,
    distanceM: leg.distanceM * 2,
    ascentM: ascentFromSegments(segments),
    steps: outAndBackSteps(leg, polyline.length),
  };
}

/**
 * Turn instructions for a doubled route (WR-054).
 *
 * The leg's own steps CANNOT be forwarded unchanged: the leg's ORS arrival step (type 10) sits at
 * the leg's last vertex, which in the doubled polyline is the FOLD — so navigation announced "You
 * have arrived" at the halfway point and then went silent, because no cue point existed past it.
 *
 * The outbound half of the doubled polyline is identical to the leg, so outbound `wayPoints` stay
 * valid as-is. The leg's arrival becomes an explicit turnaround, and a real arrival is added at the
 * true finish.
 *
 * The return leg deliberately carries NO street-level turns. ORS instructions cannot be honestly
 * reversed — which way you turn at each node depends on the reversed geometry, and the instruction
 * text is the source of truth for wording (see cues.ts) — so inventing them would be fabrication.
 * Riders are retracing a road they have just ridden; NAVIGATION_SPEC §4 records the limitation.
 */
function outAndBackSteps(leg: CandidateRoute, totalPoints: number): TurnStep[] | undefined {
  if (!leg.steps?.length) return leg.steps;
  const foldIdx = leg.polyline.length - 1;
  const endIdx = totalPoints - 1;
  const outbound = leg.steps.filter((s) => s.type !== ORS_ARRIVAL);
  return [
    ...outbound,
    // ORS u-turn code, so nothing downstream can mistake the fold for an arrival. The wording avoids
    // 'arrive'/'destination'/'goal' for the same reason (cues.ts isArrival also sniffs the text).
    {
      instruction: TURNAROUND_INSTRUCTION,
      distanceM: 0,
      type: ORS_UTURN,
      wayPoints: [foldIdx, foldIdx],
    },
    {
      instruction: 'Arrive at your finish',
      distanceM: 0,
      type: ORS_ARRIVAL,
      wayPoints: [endIdx, endIdx],
    },
  ];
}

/**
 * Generate 6–8 genuinely different candidate loops: seeds x points variation plus out-and-back
 * bearing variants. Runs in parallel; partial failures are tolerated (allSettled) so a few dead
 * calls still yield >=3 candidates. Results are overlap-deduped (keeping the first of a cluster;
 * WR-008 re-dedupes after scoring to keep the higher-scoring twin).
 */
export async function generateCandidates(
  provider: RouteProvider,
  start: LatLon,
  lengthM: number,
  profile: RoundTripParams['profile'],
  opts: GenerateOptions = {},
): Promise<CandidateRoute[]> {
  const seeds = opts.seeds ?? [10, 20, 30];
  const pointsVariation = opts.pointsVariation ?? [3, 4];
  const bearings = opts.bearings ?? [45, 225];

  const tasks: Array<Promise<CandidateRoute>> = [];
  for (const seed of seeds) {
    for (const points of pointsVariation) {
      tasks.push(provider.roundTrip({ start, lengthM, seed, points, profile }));
    }
  }
  for (const bearing of bearings) {
    // Crow-flies radius is shrunk (~0.75x half-length) because the road there-and-back winds,
    // so the out-and-back total lands nearer the requested length.
    const radiusM = (lengthM / 2) * 0.75;
    const far = destination([start.lon, start.lat], radiusM, bearing, { units: 'meters' }).geometry
      .coordinates;
    const dest: LatLon = { lat: far[1], lon: far[0] };
    tasks.push(
      provider
        .pointToPoint(start, dest, profile)
        .then((leg) => outAndBack(leg, `ors-oab-${bearing}`)),
    );
  }

  const total = tasks.length;
  let done = 0;
  const tracked = tasks.map((t) =>
    t.finally(() => {
      done++;
      opts.onSettled?.(done, total);
    }),
  );
  const settled = await Promise.allSettled(tracked);
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<CandidateRoute> => s.status === 'fulfilled')
    .map((s) => s.value);
  // Total failure must surface (e.g. ORS quota exhausted) rather than resolve to an empty list —
  // rethrow the first rejection so its ProviderError kind reaches the UI.
  if (ok.length === 0) {
    const firstErr = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
    if (firstErr) throw firstErr.reason;
  }
  return dedupeByOverlap(ok, { threshold: opts.overlapThreshold });
}

export interface DedupeOptions<T> {
  threshold?: number;
  /** Higher score wins when two candidates overlap beyond the threshold. */
  score?: (item: T) => number;
}

/**
 * Drop candidates whose geometry overlaps an already-kept one beyond `threshold` (default 0.7).
 * Highest-scoring first (stable sort), then keep-first greedy checking each new item against ALL
 * kept ones — this guarantees the output is pairwise below `threshold` AND keeps the higher-scoring
 * member of every cluster (no score => input order preserved, first wins).
 */
export function dedupeByOverlap<T extends { polyline: LatLon[] }>(
  items: T[],
  opts: DedupeOptions<T> = {},
): T[] {
  const threshold = opts.threshold ?? 0.7;
  const score = opts.score ?? (() => 0);
  const ordered = [...items].sort((a, b) => score(b) - score(a));
  const kept: T[] = [];
  for (const item of ordered) {
    const isDup = kept.some((k) => overlapRatio(item.polyline, k.polyline) > threshold);
    if (!isDup) kept.push(item);
  }
  return kept;
}
