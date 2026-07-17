// adapters/routing/ors.ts — openrouteservice RouteProvider (WR-005).
// Round-trip + point-to-point directions, parsed to fully-segmented CandidateRoutes, a diverse
// candidate generator, and overlap dedupe (engine/geometry.overlapRatio). Adapters are the only
// place fetch() may appear (CLAUDE.md rule 4); free-tier budget matters (API_NOTES §2).
import { destination } from '@turf/turf';
import type {
  CandidateRoute,
  LatLon,
  RoundTripParams,
  Segment,
  Surface,
  TurnStep,
} from '../../domain';
import { expandRangesToEdges, normalizeDeg, overlapRatio, resample } from '../../engine/geometry';
import { ProviderError } from '../errors';
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

function round3(n: number): string {
  return n.toFixed(3);
}

export class OrsRouteProvider implements RouteProvider {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly cache: TtlCache<CandidateRoute>;
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(opts: OrsOptions = {}) {
    this.apiKey = opts.apiKey ?? import.meta.env.VITE_ORS_API_KEY ?? '';
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? (() => Date.now());
    this.cache =
      opts.cache ?? createIdbCache<CandidateRoute>('windride-routes', 'routes', this.now);
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  private async post(profile: string, body: unknown): Promise<OrsResponse> {
    liveCalls++;
    if (import.meta.env.MODE === 'development') {
      console.info(`[ORS] live call #${liveCalls} (${profile})`);
    }
    const doFetch = this.fetchFn(`${BASE}/v2/directions/${profile}/geojson`, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const timeout = new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new ProviderError('network', 'ORS request timed out')),
        this.timeoutMs,
      ),
    );

    let res: Response;
    try {
      res = await Promise.race([doFetch, timeout]);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('network', 'fetch failed');
    }
    if (res.status === 429) throw new ProviderError('quota', 'ORS rate limit');
    if (!res.ok) throw new ProviderError('badResponse', `HTTP ${res.status}`);
    try {
      return (await res.json()) as OrsResponse;
    } catch {
      throw new ProviderError('badResponse', 'invalid JSON');
    }
  }

  async roundTrip(p: RoundTripParams): Promise<CandidateRoute> {
    if (p.lengthM > ROUND_TRIP_CAP_M) {
      throw new ProviderError('badResponse', 'Round-trip length exceeds the 100 km ORS cap');
    }
    const key = `${round3(p.start.lat)},${round3(p.start.lon)}#${p.lengthM}#s${p.seed}#p${p.points}#${p.profile}`;
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
    const route = parseOrsRoute(feature, `ors-rt-${p.seed}-${p.points}`);
    await this.cache.set(key, route, this.now() + TTL_MS);
    return route;
  }

  async pointToPoint(a: LatLon, b: LatLon, profile: string): Promise<CandidateRoute> {
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
    return parseOrsRoute(feature, `ors-p2p`);
  }
}

// --- candidate generation & dedupe ---------------------------------------------------------
export interface GenerateOptions {
  seeds?: number[];
  pointsVariation?: Array<3 | 4 | 5>;
  /** Absolute bearings for out-and-back variants (WR-008 will make these wind-relative). */
  bearings?: number[];
  overlapThreshold?: number;
}

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
    steps: leg.steps,
  };
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
    const far = destination([start.lon, start.lat], lengthM / 2, bearing, { units: 'meters' })
      .geometry.coordinates;
    const dest: LatLon = { lat: far[1], lon: far[0] };
    tasks.push(
      provider
        .pointToPoint(start, dest, profile)
        .then((leg) => outAndBack(leg, `ors-oab-${bearing}`)),
    );
  }

  const settled = await Promise.allSettled(tasks);
  const ok = settled
    .filter((s): s is PromiseFulfilledResult<CandidateRoute> => s.status === 'fulfilled')
    .map((s) => s.value);
  return dedupeByOverlap(ok, { threshold: opts.overlapThreshold });
}

export interface DedupeOptions<T> {
  threshold?: number;
  /** Higher score wins when two candidates overlap beyond the threshold. */
  score?: (item: T) => number;
}

/** Drop candidates whose geometry overlaps an already-kept one beyond `threshold` (default 0.7). */
export function dedupeByOverlap<T extends { polyline: LatLon[] }>(
  items: T[],
  opts: DedupeOptions<T> = {},
): T[] {
  const threshold = opts.threshold ?? 0.7;
  const score = opts.score ?? (() => 0);
  const kept: T[] = [];
  for (const item of items) {
    let dupIdx = -1;
    for (let i = 0; i < kept.length; i++) {
      if (overlapRatio(item.polyline, kept[i].polyline) > threshold) {
        dupIdx = i;
        break;
      }
    }
    if (dupIdx < 0) kept.push(item);
    else if (score(item) > score(kept[dupIdx])) kept[dupIdx] = item;
  }
  return kept;
}
