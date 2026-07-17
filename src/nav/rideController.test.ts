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
  });

  it('resume re-enables cue firing on the same controller', () => {
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis, announcer });
    controller.pause();
    // Pause only a short prefix so the turn is still ahead when we resume.
    for (const fix of fixes.slice(0, 5)) controller.onFix(fix);
    expect(announcer.announce).not.toHaveBeenCalled();
    controller.resume();
    for (const fix of fixes.slice(5)) controller.onFix(fix);
    expect(announcer.announce).toHaveBeenCalled();
  });

  it('flags off-route with a bearing-to-track arrow and announces it once', () => {
    // A due-east straight route; a fix well north of it is unambiguously off-track.
    const line: LatLon[] = [
      { lat: 60, lon: 24 },
      { lat: 60, lon: 24.05 },
    ];
    const segments = resample({ polyline: line });
    const sample: WindSample = {
      windMs: 4,
      windFromDeg: 200,
      gustMs: 6,
      precipProb: 0,
      tempC: 15,
      time: '2026-07-10T09:00',
    };
    const straight = analyzeCandidate(
      {
        id: 'straight',
        polyline: line,
        segments,
        distanceM: polylineLengthM(line),
        ascentM: 0,
        steps: [],
      },
      segments.map(() => [sample]),
      { targetDistanceM: polylineLengthM(line) },
    );
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis: straight, announcer });
    let alerts = 0;
    let sawArrow = false;
    for (let i = 0; i < 20; i++) {
      const t = new Date(1_752_744_000_000 + i * 1000).toISOString();
      const s = controller.onFix({ lat: 60.002, lon: 24.01, time: t }); // ~222 m north of the line
      if (s.offRoute === 'alert') {
        alerts += 1;
        if (s.toTrack && s.toTrack.distanceM > 60) sawArrow = true;
      }
    }
    expect(alerts).toBeGreaterThan(0);
    expect(sawArrow).toBe(true);
    const offRouteSays = announcer.announce.mock.calls.filter((c) =>
      (c[0] as { text: string }).text.includes('Off route'),
    );
    expect(offRouteSays).toHaveLength(1);
  });
});
