import { describe, expect, it } from 'vitest';
import type { Providers } from '../../adapters/registry';
import { ProviderError } from '../../adapters/errors';
import { MockRouteProvider } from '../../adapters/routing/mock';
import { MockWeatherProvider } from '../../adapters/weather/mock';
import type { RouteProvider } from '../../adapters/routing';
import { runPlan, type PlanInputs } from './runPlan';

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
