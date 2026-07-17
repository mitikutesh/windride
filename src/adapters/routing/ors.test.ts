import { describe, expect, it } from 'vitest';
import roundtripRaw from '../../../fixtures/ors/roundtrip-sample.geojson?raw';
import type { LatLon } from '../../domain';
import type { ProviderErrorKind } from '../errors';
import { describeRouteProviderContract } from '../providerContract';
import { dedupeByOverlap, generateCandidates, OrsRouteProvider, parseOrsRoute } from './ors';

const ROUNDTRIP = JSON.parse(roundtripRaw);
const FIXED_NOW = 1_700_000_000_000;

type Body = {
  coordinates: [number, number][];
  options?: { round_trip?: { seed: number } };
};

function jsonResponse(obj: unknown): Response {
  return { ok: true, status: 200, json: async () => obj } as Response;
}

function p2pCollection(a: [number, number], b: [number, number]) {
  const mid: [number, number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 5];
  return {
    type: 'FeatureCollection',
    features: [
      {
        properties: {
          summary: { distance: 1000, ascent: 4 },
          segments: [
            {
              steps: [
                { distance: 1000, duration: 120, type: 11, instruction: 'go', way_points: [0, 2] },
              ],
            },
          ],
          extras: { surface: { values: [[0, 2, 3]] }, waytypes: { values: [[0, 2, 6]] } },
        },
        geometry: { coordinates: [[a[0], a[1], 1], mid, [b[0], b[1], 2]] },
      },
    ],
  };
}

/** Fixture fetch that returns the canonical (start-anchored) round trip and synthesises p2p legs. */
function fixtureFetch(): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    if (body.options?.round_trip) return jsonResponse(ROUNDTRIP);
    const [a, b] = body.coordinates;
    return jsonResponse(p2pCollection(a, b));
  }) as unknown as typeof fetch;
}

function failFetch(kind: ProviderErrorKind): typeof fetch {
  if (kind === 'network') {
    return (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
  }
  const status = kind === 'quota' ? 429 : 500;
  return (async () =>
    ({ ok: false, status, json: async () => ({}) }) as Response) as unknown as typeof fetch;
}

const makeProvider = () =>
  new OrsRouteProvider({
    apiKey: 'test',
    fetchFn: fixtureFetch(),
    now: () => FIXED_NOW,
    timeoutMs: 1000,
  });

// WR-003 contract, re-run against the real adapter in fixture mode. A single captured fixture
// replays the same polyline for every seed, so seed-distinctness is opted out (per WR-006 note).
describeRouteProviderContract(
  'OrsRouteProvider (fixture mode)',
  makeProvider,
  (kind) =>
    new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: failFetch(kind),
      now: () => FIXED_NOW,
      timeoutMs: 1000,
    }),
  { expectSeedDistinct: false },
);

describe('parseOrsRoute (extras alignment)', () => {
  const route = parseOrsRoute(ROUNDTRIP.features[0], 'ors-rt-1-4');

  it('reads a closed loop, distance, ascent and steps', () => {
    expect(route.polyline).toHaveLength(9);
    expect(route.polyline[0]).toEqual(route.polyline.at(-1)); // closed
    expect(route.distanceM).toBe(4004);
    expect(route.ascentM).toBe(10);
    expect(route.steps).toHaveLength(2);
  });

  it('carries surface that changes across the loop (asphalt -> gravel) and cycleway wayClass', () => {
    expect(route.segments.some((s) => s.surface === 'paved')).toBe(true);
    expect(route.segments.some((s) => s.surface === 'gravel')).toBe(true);
    expect(route.segments.every((s) => s.wayClass === 'cycleway')).toBe(true);
  });

  it('derives non-zero grade from the elevation coordinates', () => {
    expect(route.segments.some((s) => Math.abs(s.gradePct) > 0)).toBe(true);
  });
});

describe('OrsRouteProvider', () => {
  it('rejects round-trip lengths above the 100 km ORS cap', async () => {
    await expect(
      makeProvider().roundTrip({
        start: { lat: 60.15, lon: 24.65 },
        lengthM: 150_000,
        seed: 1,
        points: 4,
        profile: 'cycling-regular',
      }),
    ).rejects.toMatchObject({ kind: 'badResponse' });
  });

  it('serves an identical repeat request from cache (zero extra fetches)', async () => {
    let calls = 0;
    const counting = (async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string) as Body;
      return jsonResponse(body.options?.round_trip ? ROUNDTRIP : p2pCollection([0, 0], [1, 1]));
    }) as unknown as typeof fetch;
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: counting,
      now: () => FIXED_NOW,
    });
    const params = {
      start: { lat: 60.15, lon: 24.65 },
      lengthM: 50_000,
      seed: 7,
      points: 4 as const,
      profile: 'cycling-regular' as const,
    };
    await provider.roundTrip(params);
    await provider.roundTrip(params);
    expect(calls).toBe(1);
  });
});

// A fetch that returns seed-distinct loops (translated) and can fail a subset of calls by index.
function diverseFetch(failIndex?: (i: number) => boolean): typeof fetch {
  let n = 0;
  return (async (_url: string, init: RequestInit) => {
    const i = n++;
    if (failIndex?.(i)) throw new Error('simulated failure');
    const body = JSON.parse(init.body as string) as Body;
    if (body.options?.round_trip) {
      const seed = body.options.round_trip.seed;
      const shifted = JSON.parse(JSON.stringify(ROUNDTRIP));
      const d = seed * 0.003; // ~330 m/seed translation => geometrically distinct loops
      shifted.features[0].geometry.coordinates = shifted.features[0].geometry.coordinates.map(
        (c: number[]) => [c[0] + d, c[1] + d, c[2]],
      );
      return jsonResponse(shifted);
    }
    const [a, b] = body.coordinates;
    return jsonResponse(p2pCollection(a, b));
  }) as unknown as typeof fetch;
}

describe('generateCandidates', () => {
  const start: LatLon = { lat: 60.15, lon: 24.65 };

  it('produces multiple distinct candidates when all calls succeed', async () => {
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: diverseFetch(),
      now: () => FIXED_NOW,
    });
    const cands = await generateCandidates(provider, start, 50_000, 'cycling-regular');
    expect(cands.length).toBeGreaterThanOrEqual(3);
  });

  it('still returns >=3 candidates when half the calls fail', async () => {
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: diverseFetch((i) => i % 2 === 0), // fail every other call
      now: () => FIXED_NOW,
    });
    const cands = await generateCandidates(provider, start, 50_000, 'cycling-regular');
    expect(cands.length).toBeGreaterThanOrEqual(3);
  });
});

describe('dedupeByOverlap', () => {
  const north = (lat0: number, lon = 24, n = 6, step = 0.004): LatLon[] =>
    Array.from({ length: n }, (_v, i) => ({ lat: lat0 + i * step, lon }));

  it('drops near-identical routes and keeps disjoint ones', () => {
    const a = { id: 'a', polyline: north(60) };
    const identical = { id: 'a2', polyline: north(60) };
    const far = { id: 'b', polyline: north(60, 24.1) };
    expect(dedupeByOverlap([a, identical, far])).toHaveLength(2);
  });

  it('treats >80% overlap as duplicate but keeps <50% overlap', () => {
    const a = { id: 'a', polyline: north(60) };
    const mostly = { id: 'm', polyline: north(60.002) }; // heavy overlap
    const half = { id: 'h', polyline: north(60.01) }; // partial overlap
    expect(dedupeByOverlap([a, mostly])).toHaveLength(1);
    expect(dedupeByOverlap([a, half])).toHaveLength(2);
  });

  it('keeps the higher-scoring twin when two overlap', () => {
    const lo = { id: 'lo', polyline: north(60), score: 1 };
    const hi = { id: 'hi', polyline: north(60), score: 9 };
    const kept = dedupeByOverlap([lo, hi], { score: (r) => r.score });
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('hi');
  });
});
