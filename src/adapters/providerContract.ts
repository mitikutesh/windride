/**
 * Provider contract suites (WR-003). ANY WeatherProvider/RouteProvider implementation must pass
 * these — shape, ordering, round-trip semantics, and error kinds. Run against the mocks now;
 * WR-004/WR-005 re-run them against the real adapters in fixture mode (override the options so
 * the captured fixture's dimensions and single-polyline replay are respected). Kept out of a
 * *.test.ts file so both mock tests and future adapter tests can import and invoke it.
 */
import { describe, expect, it } from 'vitest';
import type { LatLon, RoundTripParams } from '../domain';
import { isProviderError, type ProviderErrorKind } from './errors';
import type { RouteProvider } from './routing';
import type { WeatherProvider } from './weather';

const ALL_KINDS: ProviderErrorKind[] = ['quota', 'network', 'badResponse'];
const DEFAULT_POINTS: LatLon[] = [
  { lat: 60.15, lon: 24.65 },
  { lat: 60.3, lon: 24.55 },
  { lat: 60.2, lon: 24.7 },
];

function metersBetween(a: LatLon, b: LatLon): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const x = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(meanLat) * 6_371_000;
  const y = (b.lat - a.lat) * (Math.PI / 180) * 6_371_000;
  return Math.hypot(x, y);
}

/** Assert a call rejects with a ProviderError of the given kind (no self-caught throws). */
async function expectProviderError(run: () => Promise<unknown>, kind: ProviderErrorKind) {
  const err = await run().then(
    () => {
      throw new Error(`expected a ${kind} rejection but the call resolved`);
    },
    (e: unknown) => e,
  );
  expect(isProviderError(err)).toBe(true);
  expect((err as { kind: ProviderErrorKind }).kind).toBe(kind);
}

export interface WeatherContractOptions {
  /** Points to sample (default 3). Must differ in count from `hours` to guard the transpose. */
  points?: LatLon[];
  /** Forecast hours (default 6). */
  hours?: number;
}

export function describeWeatherProviderContract(
  name: string,
  make: () => WeatherProvider,
  makeFailing: (kind: ProviderErrorKind) => WeatherProvider,
  opts: WeatherContractOptions = {},
): void {
  const POINTS = opts.points ?? DEFAULT_POINTS;
  const HOURS = opts.hours ?? 6;

  describe(`WeatherProvider contract: ${name}`, () => {
    it('returns a [pointIdx][hourIdx] grid with matching dimensions', async () => {
      // points count and hours differ so a [hour][point] transpose fails these assertions.
      expect(POINTS.length).not.toBe(HOURS);
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

    it('maps failures in every method to a ProviderError of each kind', async () => {
      for (const kind of ALL_KINDS) {
        await expectProviderError(() => makeFailing(kind).windAlong(POINTS, 3), kind);
        await expectProviderError(() => makeFailing(kind).daylight(POINTS[0]), kind);
      }
    });
  });
}

export interface RouteContractOptions {
  /** Whether different seeds must yield distinct geometry (false for single-fixture replay). */
  expectSeedDistinct?: boolean;
  /** Tolerance (m) for "starts at start" and "loop is closed". */
  toleranceM?: number;
}

export function describeRouteProviderContract(
  name: string,
  make: () => RouteProvider,
  makeFailing: (kind: ProviderErrorKind) => RouteProvider,
  opts: RouteContractOptions = {},
): void {
  const expectSeedDistinct = opts.expectSeedDistinct ?? true;
  const TOL = opts.toleranceM ?? 50;
  const params: RoundTripParams = {
    start: { lat: 60.15, lon: 24.65 },
    lengthM: 50_000,
    seed: 1,
    points: 4,
    profile: 'cycling-regular',
  };

  describe(`RouteProvider contract: ${name}`, () => {
    it('roundTrip returns a valid CandidateRoute', async () => {
      const r = await make().roundTrip(params);
      expect(typeof r.id).toBe('string');
      expect(r.polyline.length).toBeGreaterThanOrEqual(2);
      expect(r.distanceM).toBeGreaterThan(0);
      expect(Array.isArray(r.segments)).toBe(true);
    });

    it('roundTrip is a closed loop that starts at the requested start', async () => {
      const r = await make().roundTrip(params);
      const first = r.polyline[0];
      const last = r.polyline.at(-1);
      expect(last).toBeDefined();
      expect(metersBetween(first, params.start)).toBeLessThan(TOL);
      expect(metersBetween(first, last as LatLon)).toBeLessThan(TOL);
    });

    it('roundTrip is deterministic for identical params', async () => {
      const a = await make().roundTrip(params);
      const b = await make().roundTrip(params);
      expect(b).toEqual(a);
    });

    if (expectSeedDistinct) {
      it('different seeds produce geometrically distinct routes', async () => {
        const a = await make().roundTrip({ ...params, seed: 1 });
        const b = await make().roundTrip({ ...params, seed: 2 });
        expect(b.polyline).not.toEqual(a.polyline);
      });
    }

    it('pointToPoint returns a route spanning the two endpoints', async () => {
      const a: LatLon = { lat: 60.1, lon: 24.6 };
      const b: LatLon = { lat: 60.2, lon: 24.7 };
      const r = await make().pointToPoint(a, b, 'cycling-regular');
      expect(r.polyline[0]).toEqual(a);
      expect(r.polyline.at(-1)).toEqual(b);
      expect(r.distanceM).toBeGreaterThan(0);
    });

    it('maps failures in every method to a ProviderError of each kind', async () => {
      const a: LatLon = { lat: 60.1, lon: 24.6 };
      const b: LatLon = { lat: 60.2, lon: 24.7 };
      for (const kind of ALL_KINDS) {
        await expectProviderError(() => makeFailing(kind).roundTrip(params), kind);
        await expectProviderError(
          () => makeFailing(kind).pointToPoint(a, b, 'cycling-regular'),
          kind,
        );
      }
    });
  });
}
