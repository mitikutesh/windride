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

  it('reports the TRUE fix position even off-route — the marker must not stick to the track (WR-051)', () => {
    // Same due-east straight route; the rider is well north of it.
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
    const controller = new RideController({ analysis: straight, announcer: fakeAnnouncer() });
    controller.onFix({ lat: 60, lon: 24.01, time: '2026-07-10T09:00:00Z' }); // latch on-track
    const s = controller.onFix({ lat: 60.002, lon: 24.01, time: '2026-07-10T09:00:01Z' }); // ~222 m north
    expect(s.position).toEqual({ lat: 60.002, lon: 24.01 }); // the raw fix, verbatim
    expect(s.snapped.lat).toBeCloseTo(60, 4); // the snap stays on the track…
    expect(s.position.lat).not.toBeCloseTo(s.snapped.lat, 4); // …and the two must differ off-route
  });

  it('warns once about an upcoming exposed-crosswind gust stretch (WR-021)', () => {
    // A due-east route; wind from the north = crosswind. First 3 segments sheltered (unflagged),
    // the rest exposed with 16 m/s gusts → a flagged stretch starting ~900 m in.
    const dLon = 300 / (111_320 * Math.cos((60 * Math.PI) / 180)); // 300 m east at 60°N
    const seg = (i: number, exposure: number) => ({
      a: { lat: 60, lon: 24 + i * dLon },
      b: { lat: 60, lon: 24 + (i + 1) * dLon },
      lengthM: 300,
      bearingDeg: 90,
      gradePct: 0,
      surface: 'paved' as const,
      exposure,
    });
    const segments = Array.from({ length: 10 }, (_v, i) => seg(i, i < 3 ? 0.35 : 1.0));
    const gustCand: CandidateRoute = {
      id: 'gust',
      polyline: [
        { lat: 60, lon: 24 },
        { lat: 60, lon: 24 + 10 * dLon },
      ],
      segments,
      distanceM: 3000,
      ascentM: 0,
      steps: [],
    };
    const gustSample: WindSample = {
      windMs: 8,
      windFromDeg: 0, // north → crosswind for an eastbound route
      gustMs: 16,
      precipProb: 0,
      tempC: 15,
      time: '2026-07-10T09:00',
    };
    const gustAnalysis = analyzeCandidate(
      gustCand,
      segments.map(() => [gustSample]),
      { targetDistanceM: 3000 },
    );
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis: gustAnalysis, announcer });
    let sawGustAhead = false;
    for (let i = 0; i <= 20; i++) {
      const s = controller.onFix({
        lat: 60,
        lon: 24 + (i * 150) / (111_320 * Math.cos((60 * Math.PI) / 180)), // ~150 m steps east
        time: new Date(1e12 + i * 1000).toISOString(),
      });
      if (s.gustAhead) sawGustAhead = true;
    }
    expect(sawGustAhead).toBe(true);
    const gustSays = announcer.announce.mock.calls.filter((c) =>
      (c[0] as { text: string }).text.includes('Crosswind gusts'),
    );
    expect(gustSays).toHaveLength(1); // announced exactly once
  });

  it('auto-pauses after a sustained stop and resumes on movement', () => {
    const controller = new RideController({ analysis, announcer: fakeAnnouncer() });
    const p = analysis.candidate.polyline[0];
    // Stationary for 25 s at the start point.
    let last;
    for (let i = 0; i < 26; i++) {
      last = controller.onFix({
        lat: p.lat,
        lon: p.lon,
        time: new Date(1e12 + i * 1000).toISOString(),
      });
    }
    expect(last!.autoPaused).toBe(true);
    // Move ~10 m/s — auto-pause clears.
    const moved = controller.onFix({
      lat: p.lat + 10 / 111_320,
      lon: p.lon,
      time: new Date(1e12 + 26_000).toISOString(),
    });
    expect(moved.autoPaused).toBe(false);
  });
});

describe('RideController.applyReroute (auto-reroute swap)', () => {
  const wind: WindSample = {
    windMs: 4,
    windFromDeg: 200,
    gustMs: 6,
    precipProb: 0,
    tempC: 15,
    time: '2026-07-10T09:00',
  };
  function analysisFor(polyline: LatLon[], id: string) {
    const segments = resample({ polyline });
    return analyzeCandidate(
      { id, polyline, segments, distanceM: polylineLengthM(polyline), ascentM: 0 },
      segments.map(() => [wind]),
      { targetDistanceM: polylineLengthM(polyline) },
    );
  }

  it('swaps in a new route: geometry changes, cues rearm, fixes snap to the new line', () => {
    const ann = fakeAnnouncer();
    const controller = new RideController({ analysis: buildAnalysis(), announcer: ann });
    controller.onFix({ lat: cleanRoute[0].lat, lon: cleanRoute[0].lon, time: '2026-07-10T09:00' });

    // A distinct reroute route (a straight north line well away from the original).
    const newLine: LatLon[] = [
      { lat: 60.3, lon: 24.9 },
      { lat: 60.31, lon: 24.9 },
      { lat: 60.32, lon: 24.9 },
    ];
    ann.stop.mockClear();
    ann.announce.mockClear();
    controller.applyReroute(analysisFor(newLine, 'reroute'));

    expect(controller.route.polyline).toEqual(newLine); // route swapped
    expect(ann.stop).toHaveBeenCalled(); // stale cues dropped
    expect(ann.announce).toHaveBeenCalled(); // "New route" cue

    // A fix near the START of the new line (where the spliced leg begins, seed 0) snaps on-track;
    // the old geometry is gone.
    const onNew = controller.onFix({ lat: 60.301, lon: 24.9, time: '2026-07-10T09:01', speed: 4 });
    expect(onNew.onTrack).toBe(true);
  });

  it('applyReroute while paused swaps silently — no voice cue during pause (WR-051)', () => {
    const ann = fakeAnnouncer();
    const controller = new RideController({ analysis: buildAnalysis(), announcer: ann });
    controller.pause(); // a stopped rider accepting from the reroute dialog
    ann.announce.mockClear();
    const newLine: LatLon[] = [
      { lat: 60.3, lon: 24.9 },
      { lat: 60.31, lon: 24.9 },
    ];
    controller.applyReroute(analysisFor(newLine, 'paused-reroute'));
    expect(controller.route.polyline).toEqual(newLine); // the swap still happens…
    expect(ann.announce).not.toHaveBeenCalled(); // …but pause keeps cue output silent
  });
});

describe('RideController — compass-blended heading (task #32)', () => {
  const wind: WindSample = {
    windMs: 4,
    windFromDeg: 200,
    gustMs: 6,
    precipProb: 0,
    tempC: 15,
    time: '2026-07-10T09:00',
  };
  function eastLine() {
    const line: LatLon[] = [
      { lat: 60, lon: 24 },
      { lat: 60, lon: 24.05 },
    ];
    const segments = resample({ polyline: line });
    return analyzeCandidate(
      {
        id: 'east',
        polyline: line,
        segments,
        distanceM: polylineLengthM(line),
        ascentM: 0,
        steps: [],
      },
      segments.map(() => [wind]),
      { targetDistanceM: polylineLengthM(line) },
    );
  }
  /** Smallest absolute angular difference in degrees. */
  const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const dLon = 11 / (111_320 * Math.cos((60 * Math.PI) / 180)); // ~11 m east at 60°N

  it('trusts the GPS travel bearing over a wayward compass while moving', () => {
    const controller = new RideController({ analysis: eastLine(), announcer: fakeAnnouncer() });
    controller.setCompassHeading(270); // phone pointing west in a bag
    controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:00Z' });
    // ~11 m east in 1 s ⇒ ~11 m/s, well above the GPS-trust threshold.
    const s = controller.onFix({ lat: 60, lon: 24 + dLon, time: '2026-07-10T09:00:01Z' });
    expect(s.headingDeg).not.toBeNull();
    expect(angDiff(s.headingDeg!, 90)).toBeLessThan(5); // points east (travel), not west (compass)
  });

  it('uses the device compass when stopped (GPS course is unreliable)', () => {
    const controller = new RideController({ analysis: eastLine(), announcer: fakeAnnouncer() });
    controller.setCompassHeading(270);
    // Two fixes at the same point ⇒ speed 0, no travel bearing → the compass is all we have.
    controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:00Z' });
    const s = controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:01Z' });
    expect(s.headingDeg).toBeCloseTo(270, 3);
  });

  it('setCompassHeading returns the blended heading for between-fix map updates', () => {
    const controller = new RideController({ analysis: eastLine(), announcer: fakeAnnouncer() });
    // No fix yet (no travel, speed 0) ⇒ the compass passes straight through.
    expect(controller.setCompassHeading(123)).toBeCloseTo(123, 3);
    // Dropping the compass falls back to the (still unknown) travel bearing → null.
    expect(controller.setCompassHeading(null)).toBeNull();
  });
});
