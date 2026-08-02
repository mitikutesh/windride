import { afterEach, describe, expect, it, vi } from 'vitest';
import roundtripRaw from '../../../fixtures/ors/roundtrip-sample.geojson?raw';
import type { LatLon } from '../../domain';
import type { ProviderErrorKind } from '../errors';
import { describeRouteProviderContract } from '../providerContract';
import {
  dedupeByOverlap,
  generateCandidates,
  OrsRouteProvider,
  parseOrsRoute,
  TURNAROUND_INSTRUCTION,
} from './ors';

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
                // Real ORS legs always end with an arrival step (type 10). The mock carries one so
                // the out-and-back fold logic (WR-054) is exercised rather than accidentally skipped.
                {
                  distance: 0,
                  duration: 0,
                  type: 10,
                  instruction: 'Arrive at your destination',
                  way_points: [2, 2],
                },
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

  it('caches pointToPoint legs too (identical repeat = zero extra fetches)', async () => {
    let calls = 0;
    const counting = (async (_url: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(init.body as string) as Body;
      const [a, b] = body.coordinates;
      return jsonResponse(p2pCollection(a, b));
    }) as unknown as typeof fetch;
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: counting,
      now: () => FIXED_NOW,
    });
    const a = { lat: 60.1, lon: 24.6 };
    const b = { lat: 60.2, lon: 24.7 };
    await provider.pointToPoint(a, b, 'cycling-regular');
    await provider.pointToPoint(a, b, 'cycling-regular');
    expect(calls).toBe(1);
  });
});

// The goal-fix suite: a wrong/missing key must produce an explanatory typed error, never a
// generic "network" that the UI phrases as "you appear to be offline".
describe('OrsRouteProvider failure classification', () => {
  afterEach(() => vi.unstubAllGlobals());

  const rtParams = (seed: number) => ({
    start: { lat: 60.15, lon: 24.65 },
    lengthM: 50_000,
    seed,
    points: 4 as const,
    profile: 'cycling-regular' as const,
  });
  const statusFetch = (status: number, body: unknown = {}) =>
    (async () =>
      ({ ok: false, status, json: async () => body }) as Response) as unknown as typeof fetch;
  const provider = (fetchFn: typeof fetch, apiKey = 'test') =>
    new OrsRouteProvider({ apiKey, fetchFn, now: () => FIXED_NOW, timeoutMs: 1000 });

  it("maps 401/403 to badResponse with code 'auth', surfacing ORS's own message", async () => {
    await expect(
      provider(statusFetch(403, { error: 'Access to this API has been disallowed' })).roundTrip(
        rtParams(101),
      ),
    ).rejects.toMatchObject({
      kind: 'badResponse',
      code: 'auth',
      message: 'Access to this API has been disallowed',
    });
    await expect(provider(statusFetch(401)).roundTrip(rtParams(102))).rejects.toMatchObject({
      code: 'auth',
    });
  });

  it("fails fast with code 'no-key' when no key is configured — zero live calls", async () => {
    let calls = 0;
    const counting = (async () => {
      calls++;
      return jsonResponse(ROUNDTRIP);
    }) as unknown as typeof fetch;
    await expect(provider(counting, '   ').roundTrip(rtParams(103))).rejects.toMatchObject({
      kind: 'badResponse',
      code: 'no-key',
    });
    expect(calls).toBe(0);
  });

  it('trims whitespace from the key so a pasted newline cannot corrupt the Authorization header', async () => {
    let auth: string | undefined;
    const capture = (async (_url: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization;
      return jsonResponse(ROUNDTRIP);
    }) as unknown as typeof fetch;
    await provider(capture, ' abc123\n').roundTrip(rtParams(104));
    expect(auth).toBe('abc123');
  });

  it("classifies a fetch failure while apparently online as 'unreachable', never offline", async () => {
    const boom = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(provider(boom).roundTrip(rtParams(105))).rejects.toMatchObject({
      kind: 'network',
      code: 'unreachable',
    });
  });

  it("classifies a fetch failure as 'offline' only when the browser reports onLine=false", async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const boom = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(provider(boom).roundTrip(rtParams(106))).rejects.toMatchObject({
      kind: 'network',
      code: 'offline',
    });
  });

  it("surfaces an aborted request as code 'timeout'", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () =>
          rej(new DOMException('aborted', 'AbortError')),
        );
      })) as unknown as typeof fetch;
    await expect(
      new OrsRouteProvider({
        apiKey: 'test',
        fetchFn: hang,
        now: () => FIXED_NOW,
        timeoutMs: 20,
      }).roundTrip(rtParams(107)),
    ).rejects.toMatchObject({ kind: 'network', code: 'timeout' });
  });

  it('includes the ORS error-body message in other bad responses', async () => {
    await expect(
      provider(
        statusFetch(404, { error: { code: 2010, message: 'Could not find routable point' } }),
      ).roundTrip(rtParams(108)),
    ).rejects.toMatchObject({
      kind: 'badResponse',
      message: 'HTTP 404: Could not find routable point',
    });
  });
});

// A fetch returning seed-distinct loops (translated); can fail specific requests by CONTENT
// (deterministic regardless of call ordering).
function diverseFetch(shouldFail?: (body: Body) => boolean): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    if (shouldFail?.(body)) throw new Error('simulated failure');
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

  it('dedupes the seed x points twins: 8 tasks -> 5 candidates (3 loops + 2 out-and-back)', async () => {
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: diverseFetch(),
      now: () => FIXED_NOW,
    });
    // seeds [10,20,30] x points [3,4] = 6 round trips (each seed's p3/p4 are identical geometry
    // -> dedupe to 3) + 2 out-and-back bearings.
    const cands = await generateCandidates(provider, start, 50_000, 'cycling-regular');
    expect(cands).toHaveLength(5);
  });

  it('still returns >=3 candidates when the seed 10 & 20 round trips all fail', async () => {
    const provider = new OrsRouteProvider({
      apiKey: 'test',
      fetchFn: diverseFetch((b) => {
        const s = b.options?.round_trip?.seed;
        return s === 10 || s === 20; // 4 of 8 tasks fail
      }),
      now: () => FIXED_NOW,
    });
    const cands = await generateCandidates(provider, start, 50_000, 'cycling-regular');
    expect(cands.length).toBeGreaterThanOrEqual(3); // seed30 loop + 2 out-and-back
  });

  // WR-054: forwarding the leg's steps unchanged put the leg's ARRIVAL step on the fold, so an
  // out-and-back announced "You have arrived" at halfway and then went silent for the return leg.
  describe('out-and-back turn steps (WR-054)', () => {
    async function outAndBackCandidate() {
      const provider = new OrsRouteProvider({
        apiKey: 'test',
        fetchFn: diverseFetch(),
        now: () => FIXED_NOW,
      });
      const cands = await generateCandidates(provider, start, 50_000, 'cycling-regular');
      const oab = cands.find((c) => c.id.startsWith('ors-oab-'));
      if (!oab) throw new Error('no out-and-back candidate generated');
      return oab;
    }

    it('puts the only arrival step at the true finish, never at the fold', async () => {
      const oab = await outAndBackCandidate();
      const arrivals = (oab.steps ?? []).filter((s) => s.type === 10);
      expect(arrivals).toHaveLength(1);
      expect(arrivals[0].wayPoints).toEqual([oab.polyline.length - 1, oab.polyline.length - 1]);
    });

    it('marks the fold as a turnaround at the halfway vertex', async () => {
      const oab = await outAndBackCandidate();
      const turnarounds = (oab.steps ?? []).filter((s) => s.instruction === TURNAROUND_INSTRUCTION);
      expect(turnarounds).toHaveLength(1);
      // The doubled polyline is [leg, reverse(leg).slice(1)], so the fold is the leg's last vertex.
      const foldIdx = (oab.polyline.length - 1) / 2;
      expect(turnarounds[0].wayPoints).toEqual([foldIdx, foldIdx]);
      expect(turnarounds[0].type).toBe(9); // u-turn, so nothing reads it as an arrival
    });

    it('preserves the outbound instructions and keeps every wayPoint index in range', async () => {
      const oab = await outAndBackCandidate();
      const steps = oab.steps ?? [];
      expect(steps.map((s) => s.instruction)).toContain('go'); // the leg's own depart step survives
      for (const s of steps) {
        for (const idx of s.wayPoints ?? []) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(oab.polyline.length);
        }
      }
    });
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
