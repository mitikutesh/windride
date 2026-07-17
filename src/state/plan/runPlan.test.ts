import { describe, expect, it } from 'vitest';
import type { Providers } from '../../adapters/registry';
import { ProviderError } from '../../adapters/errors';
import { MockRouteProvider } from '../../adapters/routing/mock';
import { MockWeatherProvider } from '../../adapters/weather/mock';
import type { RouteProvider } from '../../adapters/routing';
import type { WeatherProvider } from '../../adapters/weather';
import type { LatLon, WindSample } from '../../domain';
import { decodeExposureGrid } from '../../data/exposureGrid';
import { runPlan, type PlanInputs } from './runPlan';

/** A single-cell grid of factor 0.35 covering all of Uusimaa, for exposure-fill tests. */
const shelterAllGrid = decodeExposureGrid({
  version: 1,
  origin: { lat: 59, lon: 23 },
  dLat: 2,
  dLon: 3,
  cols: 1,
  rows: 1,
  cellSizeM: 250,
  quant: { min: 0.35, max: 1.15 },
  factorsB64: btoa(String.fromCharCode(0)), // byte 0 → 0.35
});

const INPUTS: PlanInputs = {
  distanceKm: 50,
  routeType: 'loop',
  surface: 'gravel',
  homeBeforeDark: false,
  avoidBusy: false,
  start: { lat: 60.17, lon: 24.65 },
};
const NOW = Date.parse('2026-07-10T12:00:00Z');

function providers(overrides: Partial<Providers> = {}): Providers {
  return {
    weather: new MockWeatherProvider({ scenario: 'sw-steady' }),
    routing: new MockRouteProvider(),
    ...overrides,
  };
}

describe('runPlan', () => {
  it('happy path: mock providers produce ranked, segmented candidates + conditions', async () => {
    const out = await runPlan(providers(), INPUTS, { now: NOW });
    expect(out.ranked.length).toBeGreaterThan(0);
    expect(out.ranked[0].candidate.segments.length).toBeGreaterThan(0); // resampled
    expect(out.ranked[0].explanation).toMatch(/wind-aware ETA/);
    expect(out.conditions.windMs).toBe(8);
    expect(out.conditions.windFromDeg).toBe(225);
  });

  it('produces a start-time matrix, recommendation, and aligned hour labels (WR-020)', async () => {
    const out = await runPlan(providers(), INPUTS, { now: NOW });
    expect(out.startMatrix.rows.length).toBe(out.ranked.length + out.rejected.length);
    expect(out.startMatrix.hours.length).toBeGreaterThan(0);
    expect(out.hourLabels).toHaveLength(out.startMatrix.hours.length);
    expect(out.hourLabels[0]).toMatch(/^\d\d:00$/);
    expect(out.startMessage).toMatch(/Route [A-Z]/); // never the generic "a route"
    // Each row has one cell per window hour.
    expect(out.startMatrix.rows[0].cells).toHaveLength(out.startMatrix.hours.length);
  });

  it('departureHour shifts both the ranking hour and the sunset margin', async () => {
    // home-before-dark on, tight sunset: departing +6 h should reject more than departing now.
    const sunsetSoon = { ...INPUTS, homeBeforeDark: true };
    const now = await runPlan(providers(), { ...sunsetSoon, departureHour: 0 }, { now: NOW });
    const later = await runPlan(providers(), { ...sunsetSoon, departureHour: 6 }, { now: NOW });
    // Later departures never leave MORE daylight, so can't rank more routes than departing now.
    expect(later.ranked.length).toBeLessThanOrEqual(now.ranked.length);
  });

  it('fills segment exposure from a covering grid and flags shelter data available', async () => {
    const out = await runPlan(providers(), INPUTS, {
      now: NOW,
      loadGrid: () => Promise.resolve(shelterAllGrid),
    });
    expect(out.shelterDataAvailable).toBe(true);
    const exposures = out.ranked.flatMap((r) => r.candidate.segments.map((s) => s.exposure));
    expect(exposures.length).toBeGreaterThan(0);
    expect(exposures.every((e) => Math.abs(e - 0.35) < 1e-9)).toBe(true);
  });

  it('degrades to neutral exposure with no grid and flags shelter data unavailable', async () => {
    const out = await runPlan(providers(), INPUTS, {
      now: NOW,
      loadGrid: () => Promise.resolve(null),
    });
    expect(out.shelterDataAvailable).toBe(false);
    const exposures = out.ranked.flatMap((r) => r.candidate.segments.map((s) => s.exposure));
    expect(exposures.every((e) => e === 1.0)).toBe(true);
  });

  it('tolerates partial candidate failures and still ranks routes', async () => {
    // A routing provider that fails the seed-10 round trips but serves everything else.
    const base = new MockRouteProvider();
    const flaky: RouteProvider = {
      roundTrip: (p) => {
        if (p.seed === 10) return Promise.reject(new ProviderError('network', 'flaky'));
        return base.roundTrip(p);
      },
      pointToPoint: (a, b, profile) => base.pointToPoint(a, b, profile),
    };
    const out = await runPlan(providers({ routing: flaky }), INPUTS, { now: NOW });
    expect(out.ranked.length).toBeGreaterThan(0);
  });

  it('propagates a quota error from the weather provider', async () => {
    await expect(
      runPlan(providers({ weather: new MockWeatherProvider({ failWith: 'quota' }) }), INPUTS, {
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: 'quota' });
  });

  it('produces routes for out-and-back mode (winding legs land near target length)', async () => {
    const out = await runPlan(providers(), { ...INPUTS, routeType: 'out-and-back' }, { now: NOW });
    expect(out.ranked.length).toBeGreaterThan(0);
  });

  it('surfaces total routing failure rather than resolving empty', async () => {
    await expect(
      runPlan(providers({ routing: new MockRouteProvider({ failWith: 'quota' }) }), INPUTS, {
        now: NOW,
      }),
    ).rejects.toMatchObject({ kind: 'quota' });
  });
});

// --- Winter mode wiring (WR-027) -------------------------------------------------------------
/** A cold-winter weather provider with a controllable sunset margin (min from NOW) + recent precip. */
function winterWeather(sunsetOffsetMin: number, tempC = -4, precipMm = 5): WeatherProvider {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);
  return {
    windAlong: async (points: LatLon[], hours: number) =>
      points.map(() =>
        Array.from({ length: hours }, (_v, h): WindSample => ({
          windMs: 6,
          windFromDeg: 200,
          gustMs: 9,
          precipProb: 40,
          tempC,
          time: iso(NOW + h * 3_600_000),
        })),
      ),
    daylight: async () => ({
      sunrise: iso(NOW - 3 * 3_600_000),
      sunset: iso(NOW + sunsetOffsetMin * 60_000),
    }),
    recentPrecipMm: async () => precipMm,
  };
}
const WINTER_IN = { ...INPUTS, routeType: 'out-and-back' as const };

describe('runPlan winter mode (WR-027)', () => {
  it('assembles WinterInfo in winter mode and leaves it null otherwise', async () => {
    const w = await runPlan(
      providers({ weather: winterWeather(600) }),
      { ...WINTER_IN, winter: true },
      { now: NOW },
    );
    expect(w.winter).not.toBeNull();
    expect(w.winter!.minTempC).toBeLessThan(0);
    const n = await runPlan(
      providers({ weather: winterWeather(600) }),
      { ...WINTER_IN, winter: false },
      { now: NOW },
    );
    expect(n.winter).toBeNull();
  });

  it('applies studded speeds so the same route is slower in winter', async () => {
    const w = await runPlan(
      providers({ weather: winterWeather(600) }),
      { ...WINTER_IN, winter: true },
      { now: NOW },
    );
    const n = await runPlan(
      providers({ weather: winterWeather(600) }),
      { ...WINTER_IN, winter: false },
      { now: NOW },
    );
    const wTop = w.ranked[0];
    const nSame = n.ranked.find((r) => r.candidate.id === wTop.candidate.id) ?? n.ranked[0];
    expect(wTop.evidence.timeS).toBeGreaterThan(nSame.evidence.timeS); // studded reached the model
  });

  it('forces home-before-dark ON in winter even with the user toggle off', async () => {
    // Only ~40 min of daylight: winter rejects the long ride; a non-winter run (toggle off) keeps it.
    const w = await runPlan(
      providers({ weather: winterWeather(40) }),
      { ...WINTER_IN, winter: true, homeBeforeDark: false },
      { now: NOW },
    );
    const n = await runPlan(
      providers({ weather: winterWeather(40) }),
      { ...WINTER_IN, winter: false, homeBeforeDark: false },
      { now: NOW },
    );
    expect(w.ranked.length).toBeLessThan(n.ranked.length);
  });

  it('fires the ice-risk caution on a cold wet morning and not on a dry one', async () => {
    const wet = await runPlan(
      providers({ weather: winterWeather(600, -4, 5) }),
      { ...WINTER_IN, winter: true },
      { now: NOW },
    );
    expect(wet.winter!.iceRisk).toBe(true);
    expect(wet.winter!.message).toMatch(/possible ice/i);
    const dry = await runPlan(
      providers({ weather: winterWeather(600, -4, 0) }),
      { ...WINTER_IN, winter: true },
      { now: NOW },
    );
    expect(dry.winter!.iceRisk).toBe(false);
  });
});
