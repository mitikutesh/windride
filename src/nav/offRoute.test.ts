import { describe, expect, it } from 'vitest';
import offRouteGpx from '../../fixtures/traces/off-route.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import { ProviderError } from '../adapters/errors';
import type { RouteProvider } from '../adapters/routing';
import type { CandidateRoute, LatLon } from '../domain';
import { polylineLengthM, resample } from '../engine/geometry';
import { parseTraceToFixes } from './replay';
import { prepareTrack, Snapper, pointAtDistance } from './snap';
import {
  OFF_ROUTE_PERP_M,
  OFF_ROUTE_SUSTAIN_MS,
  OffRouteMonitor,
  REJOIN_AHEAD_M,
  Rerouter,
  rerouteBackoffMs,
} from './offRoute';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];

function legFrom(points: LatLon[]): CandidateRoute {
  return {
    id: 'leg',
    polyline: points,
    segments: resample({ polyline: points }),
    distanceM: polylineLengthM(points),
    ascentM: 0,
    steps: [],
  };
}

function routeFrom(points: LatLon[]): CandidateRoute {
  return {
    id: 'route',
    polyline: points,
    segments: resample({ polyline: points }),
    distanceM: polylineLengthM(points),
    ascentM: 0,
    steps: [],
  };
}

/** RouteProvider whose pointToPoint runs `impl`; roundTrip is unused here. */
function provider(impl: RouteProvider['pointToPoint']): RouteProvider {
  return {
    roundTrip: () => Promise.reject(new Error('unused')),
    pointToPoint: impl,
  };
}

describe('OffRouteMonitor', () => {
  it('alerts only after the perpendicular exceeds the gate for the sustain window', () => {
    const m = new OffRouteMonitor();
    expect(m.update(10, 0).state).toBe('on-route');
    expect(m.update(60, 1000).state).toBe('off-pending'); // just crossed the gate
    expect(m.update(60, 5000).state).toBe('off-pending'); // 4 s in
    expect(m.update(60, 11000).state).toBe('alert'); // 10 s in -> alert
  });

  it('resets the timer when the rider returns within the gate', () => {
    const m = new OffRouteMonitor();
    m.update(60, 1000);
    expect(m.update(10, 3000).state).toBe('on-route'); // back on track
    expect(m.update(60, 4000).state).toBe('off-pending'); // fresh excursion, timer restarted
    expect(m.update(60, 13000).state).toBe('off-pending'); // only 9 s into the new excursion
  });
});

describe('rerouteBackoffMs', () => {
  it('grows exponentially and caps', () => {
    expect(rerouteBackoffMs(1)).toBe(2000);
    expect(rerouteBackoffMs(2)).toBe(4000);
    expect(rerouteBackoffMs(3)).toBe(8000);
    expect(rerouteBackoffMs(10)).toBe(30000); // capped
  });
});

describe('off-route replay trace', () => {
  it('fires the alert 10–14 s after the excursion leaves the gate', () => {
    const snapper = new Snapper(prepareTrack(cleanRoute));
    const monitor = new OffRouteMonitor();
    let firstExceedMs: number | null = null;
    let alertMs: number | null = null;
    for (const fix of parseTraceToFixes(offRouteGpx)) {
      const { perpendicularM } = snapper.update(fix);
      const tMs = Date.parse(fix.time);
      if (perpendicularM > OFF_ROUTE_PERP_M && firstExceedMs === null) firstExceedMs = tMs;
      const { state } = monitor.update(perpendicularM, tMs);
      if (state === 'alert' && alertMs === null) alertMs = tMs;
    }
    expect(firstExceedMs).not.toBeNull();
    expect(alertMs).not.toBeNull();
    const elapsed = alertMs! - firstExceedMs!;
    expect(elapsed).toBeGreaterThanOrEqual(OFF_ROUTE_SUSTAIN_MS);
    expect(elapsed).toBeLessThanOrEqual(14000);
  });
});

describe('Rerouter', () => {
  const route = routeFrom(cleanRoute);
  const track = prepareTrack(cleanRoute);
  const progressM = 500;
  const current: LatLon = { lat: cleanRoute[2].lat + 0.003, lon: cleanRoute[2].lon + 0.003 };

  it('reroutes to progress+500 m, splices, and preserves the finish', async () => {
    const rejoinExpected = Math.min(track.total, progressM + REJOIN_AHEAD_M);
    let calledTarget: LatLon | undefined;
    const r = new Rerouter(
      provider((a, b) => {
        calledTarget = b;
        return Promise.resolve(
          legFrom([a, { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, b]),
        );
      }),
      'cycling-regular',
    );
    const outcome = await r.attempt(current, route, track, progressM);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.rejoinAtM).toBeCloseTo(rejoinExpected, 3);
    // The reroute targets the track point 500 m ahead, not the finish.
    expect(calledTarget).toEqual(pointAtDistance(track, rejoinExpected));
    expect(outcome.route.polyline.at(-1)).toEqual(cleanRoute.at(-1)); // finish identical
    expect(r.failedAttempts).toBe(0);
  });

  it('rejoined route: remaining reflects the new route within 2 fixes', async () => {
    const r = new Rerouter(
      provider((a, b) =>
        Promise.resolve(legFrom([a, { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, b])),
      ),
      'cycling-regular',
    );
    const outcome = await r.attempt(current, route, track, progressM);
    if (!outcome.ok) throw new Error('expected reroute success');
    const newTrack = prepareTrack(outcome.route.polyline);
    const snapper = new Snapper(newTrack);
    const first = snapper.update({
      lat: current.lat,
      lon: current.lon,
      time: '2026-07-10T09:00:00Z',
    });
    const second = snapper.update({
      lat: outcome.route.polyline[1].lat,
      lon: outcome.route.polyline[1].lon,
      time: '2026-07-10T09:00:01Z',
    });
    // Remaining is on the scale of the new route (not the old) and advances.
    expect(first.remainingM).toBeCloseTo(newTrack.total, 0);
    expect(second.remainingM).toBeLessThan(first.remainingM);
  });

  it('keeps guidance on a provider failure: reports backoff, grows across retries', async () => {
    const r = new Rerouter(
      provider(() => Promise.reject(new ProviderError('quota', 'daily limit'))),
      'cycling-regular',
    );
    const first = await r.attempt(current, route, track, progressM);
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error).toBeInstanceOf(ProviderError);
    expect(first.nextRetryMs).toBe(2000);
    const second = await r.attempt(current, route, track, progressM);
    if (second.ok) throw new Error('expected second failure');
    expect(second.nextRetryMs).toBe(4000); // backoff grows while guidance stays in alert
    expect(r.failedAttempts).toBe(2);
  });
});
