import { describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import type { LatLon, WindSample } from '../domain';
import { polylineLengthM, resample } from '../engine/geometry';
import { analyzeCandidate } from '../engine/scoring';
import type { GpxPoint } from '../utils/gpx';
import { parseTraceToFixes } from './replay';
import { autoPaused, MOVING_SPEED_MS, summarizeRide } from './rideSummary';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];

/** A stop-and-go track: move ~10 m/s for 10 s, stop for 30 s, move again for 10 s. */
function stopAndGo(): GpxPoint[] {
  const pts: GpxPoint[] = [];
  let lat = 60;
  const push = (t: number) =>
    pts.push({ lat, lon: 24, time: new Date(1e12 + t * 1000).toISOString() });
  for (let t = 0; t <= 10; t++) {
    push(t);
    lat += 10 / 111_320; // ~10 m/s north
  }
  for (let t = 11; t <= 40; t++) push(t); // stationary 30 s
  for (let t = 41; t <= 50; t++) {
    push(t);
    lat += 10 / 111_320;
  }
  return pts;
}

describe('summarizeRide', () => {
  it('returns a zero summary for an empty ride (crash before the first batch)', () => {
    expect(summarizeRide([])).toEqual({ distanceM: 0, elapsedS: 0, movingS: 0, avgSpeedMs: 0 });
  });

  it('records distance within 1% of the trace length', () => {
    const points = parseTraceToFixes(cleanLoopGpx);
    const { distanceM } = summarizeRide(points);
    const trueLength = polylineLengthM(cleanRoute);
    expect(Math.abs(distanceM - trueLength) / trueLength).toBeLessThan(0.01);
  });

  it('separates moving time from elapsed time', () => {
    const s = summarizeRide(stopAndGo());
    expect(s.elapsedS).toBeCloseTo(50, 0);
    expect(s.movingS).toBeGreaterThan(15);
    expect(s.movingS).toBeLessThan(25); // ~20 s moving, 30 s stopped
    expect(s.avgSpeedMs).toBeGreaterThan(MOVING_SPEED_MS);
  });

  it('buckets time by wind kind against the planned segments', () => {
    const segments = resample({ polyline: cleanRoute });
    const sample: WindSample = {
      windMs: 5,
      windFromDeg: 200,
      gustMs: 7,
      precipProb: 0,
      tempC: 15,
      time: '2026-07-10T09:00',
    };
    const analysis = analyzeCandidate(
      {
        id: 'r',
        polyline: cleanRoute,
        segments,
        distanceM: polylineLengthM(cleanRoute),
        ascentM: 0,
        steps: [],
      },
      segments.map(() => [sample]),
      { targetDistanceM: polylineLengthM(cleanRoute) },
    );
    const points = parseTraceToFixes(cleanLoopGpx);
    const s = summarizeRide(points, { analysis, medianHeadwindKm: 3, chosenHeadwindKm: 2 });
    const total = s.windByKindS!.tail + s.windByKindS!.cross + s.windByKindS!.head;
    expect(total).toBeCloseTo(s.elapsedS, 0); // every interval bucketed
    expect(s.headwindAvoidedKm).toBeCloseTo(1, 6); // 3 − 2
  });
});

describe('autoPaused', () => {
  it('detects a sustained stop (> 20 s below 1.2 km/h)', () => {
    expect(autoPaused(stopAndGo().slice(0, 41))).toBe(true); // ends in the 30 s stop
  });

  it('is false while moving', () => {
    expect(autoPaused(stopAndGo())).toBe(false); // ends in the final moving stretch
  });
});
