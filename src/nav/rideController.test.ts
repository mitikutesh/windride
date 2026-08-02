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
import { pointAtDistance, prepareTrack } from './snap';

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

  // --- map bearing (WR-053): heading-up rotation, gated on travel only ---------------------
  it('has no map bearing on the first fix, then locks onto the travel bearing once moving', () => {
    const controller = new RideController({ analysis: eastLine(), announcer: fakeAnnouncer() });
    const first = controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:00Z' });
    expect(first.mapBearingDeg).toBeNull(); // nothing has moved yet — the map stays north-up
    const moved = controller.onFix({ lat: 60, lon: 24 + dLon, time: '2026-07-10T09:00:01Z' });
    expect(moved.mapBearingDeg).not.toBeNull();
    expect(angDiff(moved.mapBearingDeg!, 90)).toBeLessThan(5); // riding east
  });

  it('never lets the device compass rotate the map', () => {
    const controller = new RideController({ analysis: eastLine(), announcer: fakeAnnouncer() });
    controller.setCompassHeading(270); // phone pointing west in a bag
    controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:00Z' });
    const moved = controller.onFix({ lat: 60, lon: 24 + dLon, time: '2026-07-10T09:00:01Z' });
    // headingDeg blends the compass in; mapBearingDeg must not — else the map spins with the phone.
    expect(angDiff(moved.mapBearingDeg!, 90)).toBeLessThan(5);
    // A stationary rider swinging the phone moves the puck (setCompassHeading) but not the map.
    controller.setCompassHeading(0);
    const still = controller.onFix({ lat: 60, lon: 24 + dLon, time: '2026-07-10T09:00:02Z' });
    expect(still.mapBearingDeg).toBeCloseTo(moved.mapBearingDeg!, 6);
  });
});

describe('RideController — seeded starts (F-004) and resume seeding', () => {
  const analysis = buildAnalysis();

  it('a fresh ride is seeded at the route start, never globally latched', () => {
    const controller = new RideController({ analysis, announcer: fakeAnnouncer() });
    const p = pointAtDistance(prepareTrack(cleanRoute), 890);
    const state = controller.onFix({ ...p, time: '2026-07-10T09:00:00.000Z' });
    // Held inside [0, +300 m]: a first fix far along a loop must not start the ride "mid-route"
    // (on a closed loop the equivalent jitter case would start it "already finished").
    expect(state.onTrack).toBe(false);
    expect(state.progressM).toBeLessThanOrEqual(301);
  });

  it('resume seeds from the recorded path — the first fix latches mid-route immediately', () => {
    const resumePath = cleanRoute.slice(0, Math.floor(cleanRoute.length / 2));
    const ridden = polylineLengthM(resumePath);
    const controller = new RideController({ analysis, announcer: fakeAnnouncer(), resumePath });
    const last = resumePath[resumePath.length - 1];
    const state = controller.onFix({ ...last, time: '2026-07-10T09:00:00.000Z' });
    expect(state.onTrack).toBe(true);
    expect(Math.abs(state.progressM - ridden)).toBeLessThan(50);
  });
});

// WR-054: an out-and-back's steps used to be forwarded from the one-way leg unchanged, so the leg's
// ARRIVAL step landed on the fold — "You have arrived" at halfway, then silence for the return.
describe('RideController — out-and-back cues (WR-054)', () => {
  const wind: WindSample = {
    windMs: 4,
    windFromDeg: 200,
    gustMs: 6,
    precipProb: 0,
    tempC: 15,
    time: '2026-07-10T09:00',
  };

  /** A there-and-back route shaped exactly the way the ORS adapter now builds one. */
  function outAndBackAnalysis() {
    const leg: LatLon[] = Array.from({ length: 11 }, (_v, i) => ({ lat: 60, lon: 24 + i * 0.002 }));
    const polyline = [...leg, ...[...leg].reverse().slice(1)];
    const foldIdx = leg.length - 1;
    const endIdx = polyline.length - 1;
    const steps: TurnStep[] = [
      { instruction: 'Head east on Rantatie', distanceM: 200, type: 11, wayPoints: [0, 1] },
      {
        instruction: 'Turn around and ride back',
        distanceM: 0,
        type: 9,
        wayPoints: [foldIdx, foldIdx],
      },
      { instruction: 'Arrive at your finish', distanceM: 0, type: 10, wayPoints: [endIdx, endIdx] },
    ];
    const segments = resample({ polyline });
    const distanceM = polylineLengthM(polyline);
    return analyzeCandidate(
      { id: 'oab', polyline, segments, distanceM, ascentM: 0, steps },
      segments.map(() => [wind]),
      { targetDistanceM: distanceM },
    );
  }

  /** Ride the whole route at ~5 m/s, returning what was said and where. */
  function rideIt() {
    const analysis = outAndBackAnalysis();
    const announcer = fakeAnnouncer();
    const controller = new RideController({ analysis, announcer });
    const track = prepareTrack(analysis.candidate.polyline);
    const t0 = Date.parse('2026-07-10T09:00:00Z');
    const said: Array<{ text: string; progressM: number }> = [];
    const turnsSeen: Array<{ instruction: string; progressM: number }> = [];
    let step = 0;
    for (let m = 0; m <= track.total; m += 20) {
      const before = announcer.announce.mock.calls.length;
      const state = controller.onFix({
        ...pointAtDistance(track, m),
        time: new Date(t0 + step * 4000).toISOString(),
        speed: 5,
      });
      step += 1;
      for (const call of announcer.announce.mock.calls.slice(before)) {
        said.push({ text: (call[0] as { text: string }).text, progressM: state.progressM });
      }
      if (state.nextTurn) {
        turnsSeen.push({ instruction: state.nextTurn.instruction, progressM: state.progressM });
      }
    }
    return { said, turnsSeen, total: track.total };
  }

  it('never announces arrival before the real finish', () => {
    const { said, total } = rideIt();
    const arrivals = said.filter((s) => /arriv/i.test(s.text));
    expect(arrivals.length).toBeGreaterThan(0); // it still announces the finish
    // The fold sits at 50% of the doubled route; nothing arrival-shaped may be said near it.
    for (const a of arrivals) expect(a.progressM).toBeGreaterThan(total * 0.75);
  });

  it('announces the turnaround at the fold instead', () => {
    const { said, total } = rideIt();
    const turnaround = said.find((s) => /turn around now/i.test(s.text));
    expect(turnaround).toBeDefined();
    expect(Math.abs(turnaround!.progressM - total / 2)).toBeLessThan(60);
  });

  // WR-055: the junction-zoom input. Distinct from nextTurn.inM — it stays 0 through the corner.
  it('reports maneuver proximity that tightens toward the fold and holds through it', () => {
    const analysis = outAndBackAnalysis();
    const controller = new RideController({ analysis, announcer: fakeAnnouncer() });
    const track = prepareTrack(analysis.candidate.polyline);
    const t0 = Date.parse('2026-07-10T09:00:00Z');
    const seen: Array<{ m: number; prox: number | null }> = [];
    let step = 0;
    for (let m = 0; m <= track.total; m += 20) {
      const state = controller.onFix({
        ...pointAtDistance(track, m),
        time: new Date(t0 + step * 4000).toISOString(),
        speed: 5,
      });
      step += 1;
      seen.push({ m, prox: state.turnProximityM });
    }
    const fold = track.total / 2;
    // Well before the fold: proximity is the distance to it, shrinking as the rider closes in.
    const early = seen.find((s) => Math.abs(s.m - (fold - 300)) < 15)!;
    const later = seen.find((s) => Math.abs(s.m - (fold - 100)) < 15)!;
    expect(early.prox).toBeGreaterThan(later.prox!);
    // Through the fold it pins to 0 — the rider is mid-maneuver, which nextTurn.inM cannot express.
    const atFold = seen.filter((s) => Math.abs(s.m - fold) < 30);
    expect(atFold.length).toBeGreaterThan(0);
    for (const s of atFold) expect(s.prox).toBe(0);
    // The arrival step is excluded, so the run-in to the finish is NOT treated as a junction.
    expect(seen[seen.length - 1].prox).toBeNull();
  });

  // WR-057: the on-map junction arrow. The fold is the strongest available check that the bearing is
  // the OUTGOING one — the route leaves it ~180° from the direction it arrived.
  it('locates the next junction and the bearing the route LEAVES it on', () => {
    const analysis = outAndBackAnalysis();
    const controller = new RideController({ analysis, announcer: fakeAnnouncer() });
    const track = prepareTrack(analysis.candidate.polyline);
    const first = controller.onFix({
      ...pointAtDistance(track, 0),
      time: '2026-07-10T09:00:00Z',
      speed: 5,
    });
    expect(first.junction).not.toBeNull();
    // The only maneuver is the turnaround at the fold.
    const fold = pointAtDistance(track, track.total / 2);
    expect(first.junction!.at.lat).toBeCloseTo(fold.lat, 4);
    expect(first.junction!.at.lon).toBeCloseTo(fold.lon, 4);
    // Outbound is due east (90°); the route leaves the fold heading back west (270°).
    const angDiffLocal = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    expect(angDiffLocal(first.junction!.outBearingDeg, 270)).toBeLessThan(5);
  });

  it('has no junction once the last maneuver is behind (the finish is not one)', () => {
    const analysis = outAndBackAnalysis();
    const controller = new RideController({ analysis, announcer: fakeAnnouncer() });
    const track = prepareTrack(analysis.candidate.polyline);
    const t0 = Date.parse('2026-07-10T09:00:00Z');
    let step = 0;
    let last = null as null | ReturnType<RideController['onFix']>;
    for (let m = 0; m <= track.total; m += 20) {
      last = controller.onFix({
        ...pointAtDistance(track, m),
        time: new Date(t0 + step * 4000).toISOString(),
        speed: 5,
      });
      step += 1;
    }
    expect(last!.junction).toBeNull();
  });

  it('reports no maneuver proximity on a route that ships no steps', () => {
    const analysis = outAndBackAnalysis();
    const bare = { ...analysis, candidate: { ...analysis.candidate, steps: [] } };
    const controller = new RideController({ analysis: bare, announcer: fakeAnnouncer() });
    const state = controller.onFix({ lat: 60, lon: 24, time: '2026-07-10T09:00:00Z', speed: 5 });
    expect(state.turnProximityM).toBeNull();
  });

  it('still has a next turn to show on the return leg', () => {
    const { turnsSeen, total } = rideIt();
    const onReturn = turnsSeen.filter((t) => t.progressM > total * 0.6);
    expect(onReturn.length).toBeGreaterThan(0);
    expect(onReturn.every((t) => t.instruction === 'Arrive at your finish')).toBe(true);
  });
});
