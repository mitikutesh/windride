/**
 * adapters/transit/digitransit.ts — return-service lookup for downwind endpoints (WR-026, API_NOTES
 * §3). Digitransit GraphQL routing API. One of the few places fetch() may appear (CLAUDE.md rule 4).
 *
 * We ask for the next departures from stops near a station at (or after) the ride's ETA, and reduce
 * them to a soonest-first departure list + a median headway. The planner turns that into a frequency
 * factor (engine/downwind.ts). Requires VITE_DIGITRANSIT_KEY; with no key the planner degrades to
 * wind-only ranking (the provider signals this with a typed 'no-key' error).
 */
import { ProviderError } from '../errors';

export interface ReturnService {
  /** Absolute epoch (ms) of the next departures after the requested time, soonest first. */
  departuresMs: number[];
  /** Median minutes between consecutive departures, or null when fewer than two are known. */
  headwayMin: number | null;
}

export interface TransitProvider {
  returnService(station: { lat: number; lon: number }, afterMs: number): Promise<ReturnService>;
}

interface Stoptime {
  serviceDay?: number;
  scheduledDeparture?: number;
  realtimeDeparture?: number | null;
}
interface StopsByRadiusBody {
  data?: {
    stopsByRadius?: {
      edges?: Array<{ node?: { stop?: { stoptimesWithoutPatterns?: Stoptime[] } } }>;
    };
  };
}

/** Reduce a stopsByRadius response to soonest-first absolute departures + a median headway. Pure. */
export function parseReturnService(body: unknown, afterS: number): ReturnService {
  const edges = (body as StopsByRadiusBody)?.data?.stopsByRadius?.edges ?? [];
  const epochsS: number[] = [];
  for (const edge of edges) {
    for (const st of edge?.node?.stop?.stoptimesWithoutPatterns ?? []) {
      const secs = st.realtimeDeparture ?? st.scheduledDeparture;
      if (typeof st.serviceDay !== 'number' || typeof secs !== 'number') continue;
      const epochS = st.serviceDay + secs;
      if (epochS >= afterS) epochsS.push(epochS);
    }
  }
  const sorted = [...new Set(epochsS)].sort((a, b) => a - b);
  let headwayMin: number | null = null;
  if (sorted.length >= 2) {
    const diffs = sorted.slice(1).map((s, i) => (s - sorted[i]) / 60);
    diffs.sort((a, b) => a - b);
    headwayMin = diffs[Math.floor(diffs.length / 2)]; // median gap between departures
  }
  return { departuresMs: sorted.map((s) => s * 1000), headwayMin };
}

export interface DigitransitOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
  endpoint?: string;
  /** Search radius (m) around a station for departure stops. */
  radiusM?: number;
}

const DEFAULT_ENDPOINT = 'https://api.digitransit.fi/routing/v2/hsl/gtfs/v1';
/** Cache window for identical station+time lookups — repeated "Find downwind rides" clicks reuse it. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** Bucket the query time to 5-minute blocks so near-identical requests share a cache key. */
const TIME_BUCKET_S = 300;

export class DigitransitProvider implements TransitProvider {
  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;
  private readonly endpoint: string;
  private readonly radiusM: number;
  // Per-instance cache (ARCHITECTURE §3: adapters own caching). Registry hands out a singleton so
  // repeated plans reuse it; tests get their own instance and so stay isolated.
  private readonly cache = new Map<string, { expiresAt: number; value: Promise<ReturnService> }>();

  constructor(opts: DigitransitOptions = {}) {
    // DEV-only .env fallback (DEC-059): dead-code-eliminated from prod builds — no baked keys.
    this.apiKey =
      opts.apiKey ?? (import.meta.env.DEV ? import.meta.env.VITE_DIGITRANSIT_KEY : undefined) ?? '';
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.radiusM = opts.radiusM ?? 800;
  }

  /** True when a key is configured; the planner falls back to wind-only ranking when false. */
  get hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  async returnService(
    station: { lat: number; lon: number },
    afterMs: number,
  ): Promise<ReturnService> {
    if (!this.apiKey) {
      throw new ProviderError('badResponse', 'Digitransit key missing', 'no-key');
    }
    const afterS = Math.floor(afterMs / 1000);
    const key = `${station.lat.toFixed(3)},${station.lon.toFixed(3)},${Math.floor(afterS / TIME_BUCKET_S)}`;
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = this.fetchReturnService(station, afterS);
    this.cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
    value.catch(() => this.cache.delete(key)); // never cache a failure
    return value;
  }

  private async fetchReturnService(
    station: { lat: number; lon: number },
    afterS: number,
  ): Promise<ReturnService> {
    const query = `{ stopsByRadius(lat: ${station.lat}, lon: ${station.lon}, radius: ${this.radiusM}, first: 4) { edges { node { stop { stoptimesWithoutPatterns(startTime: ${afterS}, numberOfDepartures: 8, omitCanceled: true) { serviceDay scheduledDeparture realtimeDeparture } } } } } }`;

    let res: Response;
    try {
      res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'digitransit-subscription-key': this.apiKey,
        },
        body: JSON.stringify({ query }),
      });
    } catch {
      throw new ProviderError('network', 'Digitransit fetch failed');
    }
    if (res.status === 429) throw new ProviderError('quota', 'Digitransit rate limited');
    if (!res.ok) throw new ProviderError('badResponse', `Digitransit ${res.status}`);
    return parseReturnService(await res.json(), afterS);
  }
}
