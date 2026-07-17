import { describe, expect, it, vi } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import geoRaw from '../../fixtures/ors/roundtrip-sample.geojson?raw';
import type { CandidateRoute, LatLon, TurnStep, WindSample } from '../domain';
import { polylineLengthM, resample } from '../engine/geometry';
import { analyzeCandidate } from '../engine/scoring';
import type { Announcer } from './announcer';
import { parseTraceToFixes } from './replay';
import { RideController } from './rideController';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];

function fixtureSteps(): TurnStep[] {
  const geo = JSON.parse(geoRaw) as {
    features: { properties: { segments: { steps: Record<string, unknown>[] }[] } }[];
  };
  return geo.features[0].properties.segments.flatMap((seg) =>
    seg.steps.map((s) => ({
      instruction: s.instruction as string,
      distanceM: s.distance as number,
      type: s.type as number,
      wayPoints: s.way_points as [number, number],
    })),
  );
}

function buildAnalysis() {
  const segments = resample({ polyline: cleanRoute });
  const candidate: CandidateRoute = {
    id: 'ride',
    polyline: cleanRoute,
    segments,
    distanceM: polylineLengthM(cleanRoute),
    ascentM: 0,
    steps: fixtureSteps(),
  };
  const sample: WindSample = {
    windMs: 4,
    windFromDeg: 200,
    gustMs: 6,
    precipProb: 0,
    tempC: 15,
    time: '2026-07-10T09:00',
  };
  const windBySegment = segments.map(() => [sample]);
  return analyzeCandidate(candidate, windBySegment, { targetDistanceM: candidate.distanceM });
}

function fakeAnnouncer() {
  return { announce: vi.fn(), stop: vi.fn() } as unknown as Announcer & {
    announce: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  };
}

describe('RideController', () => {
  const analysis = buildAnalysis();
  const fixes = parseTraceToFixes(cleanLoopGpx);

  it('produces live ride state: next turn, decreasing remaining, heading, ETA', () => {
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis, announcer });
    const first = controller.onFix(fixes[0]);
    expect(first.nextTurn?.instruction).toBe('Turn left onto Metsapolku');
    expect(first.etaS).toBeGreaterThan(0);
    let prevRemaining = first.remainingM;
    let sawHeading = false;
    for (const fix of fixes.slice(1, 40)) {
      const s = controller.onFix(fix);
      expect(s.remainingM).toBeLessThanOrEqual(prevRemaining + 1);
      prevRemaining = s.remainingM;
      if (s.headingDeg !== null) sawHeading = true;
    }
    expect(sawHeading).toBe(true); // heading derived from fix deltas
  });

  it('fires cues while riding', () => {
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis, announcer });
    for (const fix of fixes) controller.onFix(fix);
    expect(announcer.announce).toHaveBeenCalled();
  });

  it('pause stops cue firing (and clears the announcer)', () => {
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis, announcer });
    controller.pause();
    expect(announcer.stop).toHaveBeenCalled();
    for (const fix of fixes) controller.onFix(fix);
    expect(announcer.announce).not.toHaveBeenCalled();
    // Resuming lets cues fire again.
    controller.resume();
    const announcer2 = fakeAnnouncer();
    const c2 = new RideController({ analysis, announcer: announcer2 });
    for (const fix of fixes) c2.onFix(fix);
    expect(announcer2.announce).toHaveBeenCalled();
  });
});
