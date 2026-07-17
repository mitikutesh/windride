/**
 * Provider contract suites (WR-003). ANY WeatherProvider/RouteProvider implementation must pass
 * these — shape, ordering, and error kinds. Run against the mocks now; WR-004/WR-005 re-run them
 * against the real adapters in fixture mode. Kept out of a *.test.ts file so both mock tests and
 * future adapter tests can import and invoke it.
 */
import { describe, expect, it } from 'vitest';
import type { LatLon, RoundTripParams } from '../domain';
import { isProviderError, type ProviderErrorKind } from './errors';
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';

const ALL_KINDS: ProviderErrorKind[] = ['quota', 'network', 'badResponse'];
const POINTS: LatLon[] = [
  { lat: 60.15, lon: 24.65 },
  { lat: 60.3, lon: 24.55 },
  { lat: 60.2, lon: 24.7 },
];

export function describeWeatherProviderContract(
  name: string,
  make: () => WeatherProvider,
  makeFailing: (kind: ProviderErrorKind) => WeatherProvider,
): void {
  describe(`WeatherProvider contract: ${name}`, () => {
    // hours (6) deliberately differs from point count (3) so a [hour][point] transpose fails.
    const HOURS = 6;

    it('returns a [pointIdx][hourIdx] grid with matching dimensions', async () => {
      const grid = await make().windAlong(POINTS, HOURS);
      expect(grid).toHaveLength(POINTS.length);
      for (const perPoint of grid) expect(perPoint).toHaveLength(HOURS);
    });

    it('produces well-formed, time-ordered samples', async () => {
      const grid = await make().windAlong(POINTS, HOURS);
      for (const perPoint of grid) {
        for (let h = 0; h < perPoint.length; h++) {
          const s = perPoint[h];
          expect(typeof s.windMs).toBe('number');
          expect(typeof s.windFromDeg).toBe('number');
          expect(s.windFromDeg).toBeGreaterThanOrEqual(0);
          expect(s.windFromDeg).toBeLessThan(360);
          expect(typeof s.gustMs).toBe('number');
          expect(typeof s.time).toBe('string');
          if (h > 0) expect(s.time > perPoint[h - 1].time).toBe(true);
        }
      }
    });

    it('returns daylight sunrise/sunset strings', async () => {
      const d = await make().daylight(POINTS[0]);
      expect(typeof d.sunrise).toBe('string');
      expect(typeof d.sunset).toBe('string');
    });

    it('maps failures to a ProviderError of each kind', async () => {
      for (const kind of ALL_KINDS) {
        try {
          await makeFailing(kind).windAlong(POINTS, 3);
          throw new Error(`expected ${kind} rejection`);
        } catch (e) {
          expect(isProviderError(e)).toBe(true);
          expect((e as { kind: ProviderErrorKind }).kind).toBe(kind);
        }
      }
    });
  });
}

export function describeRouteProviderContract(
  name: string,
  make: () => RouteProvider,
  makeFailing: (kind: ProviderErrorKind) => RouteProvider,
): void {
  describe(`RouteProvider contract: ${name}`, () => {
    const params: RoundTripParams = {
      start: { lat: 60.15, lon: 24.65 },
      lengthM: 50_000,
      seed: 1,
      points: 4,
      profile: 'cycling-regular',
    };

    it('roundTrip returns a valid CandidateRoute', async () => {
      const r = await make().roundTrip(params);
      expect(typeof r.id).toBe('string');
      expect(r.polyline.length).toBeGreaterThanOrEqual(2);
      expect(r.distanceM).toBeGreaterThan(0);
      expect(Array.isArray(r.segments)).toBe(true);
    });

    it('roundTrip is deterministic for identical params', async () => {
      const a = await make().roundTrip(params);
      const b = await make().roundTrip(params);
      expect(b).toEqual(a);
    });

    it('different seeds produce geometrically distinct routes', async () => {
      const a = await make().roundTrip({ ...params, seed: 1 });
      const b = await make().roundTrip({ ...params, seed: 2 });
      expect(b.polyline).not.toEqual(a.polyline);
    });

    it('pointToPoint returns a route spanning the two endpoints', async () => {
      const a: LatLon = { lat: 60.1, lon: 24.6 };
      const b: LatLon = { lat: 60.2, lon: 24.7 };
      const r = await make().pointToPoint(a, b, 'cycling-regular');
      expect(r.polyline[0]).toEqual(a);
      expect(r.polyline.at(-1)).toEqual(b);
      expect(r.distanceM).toBeGreaterThan(0);
    });

    it('maps failures to a ProviderError of each kind', async () => {
      for (const kind of ALL_KINDS) {
        try {
          await makeFailing(kind).roundTrip(params);
          throw new Error(`expected ${kind} rejection`);
        } catch (e) {
          expect(isProviderError(e)).toBe(true);
          expect((e as { kind: ProviderErrorKind }).kind).toBe(kind);
        }
      }
    });
  });
}
