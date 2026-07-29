import { describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import figureEightGpx from '../../fixtures/traces/figure-eight.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import figureRouteRaw from '../../fixtures/traces/figure-eight-route.json?raw';
import type { LatLon } from '../domain';
import type { Fix } from './fixSource';
import { parseTraceToFixes, mulberry32, applyJitter } from './replay';
import {
  estimateProgressFromPath,
  prepareTrack,
  Snapper,
  SNAP_JITTER_TOLERANCE_M,
  SNAP_PERP_GATE_M,
  SNAP_WINDOW_FWD_M,
} from './snap';

const cleanRoute = JSON.parse(cleanRouteRaw) as LatLon[];
const figureRoute = JSON.parse(figureRouteRaw) as LatLon[];

// A simple 2-segment straight track running due north (~1113 m per 0.01°).
const straight: LatLon[] = [
  { lat: 60, lon: 24 },
  { lat: 60.005, lon: 24 },
  { lat: 60.01, lon: 24 },
];
const fx = (lat: number, lon: number): Fix => ({ lat, lon, time: '2026-07-10T09:00:00.000Z' });

describe('prepareTrack', () => {
  it('precomputes cumulative distances and total', () => {
    const t = prepareTrack(straight);
    expect(t.cum).toHaveLength(3);
    expect(t.cum[0]).toBe(0);
    expect(t.total).toBeCloseTo(t.cum[2], 6);
    expect(t.total).toBeGreaterThan(1000); // ~1113 m
  });
});

describe('Snapper — core behaviour', () => {
  it('cold start snaps to the globally nearest point', () => {
    const s = new Snapper(prepareTrack(straight));
    const r = s.update(fx(60.008, 24.0001)); // near the far end, slightly east
    expect(r.progressM).toBeGreaterThan(800);
    expect(r.perpendicularM).toBeLessThan(SNAP_PERP_GATE_M);
    expect(r.onTrack).toBe(true);
  });

  it('cold start does NOT latch on a fix outside the perpendicular gate (retries)', () => {
    const s = new Snapper(prepareTrack(straight));
    const far = s.update(fx(60.005, 24.01)); // ~550 m east of the line
    expect(far.onTrack).toBe(false);
    expect(far.accepted).toBe(false);
    // Progress was not latched: a subsequent good fix cold-starts cleanly at its true position.
    const good = s.update(fx(60.001, 24));
    expect(good.onTrack).toBe(true);
    expect(good.progressM).toBeGreaterThan(90);
    expect(good.progressM).toBeLessThan(140); // ~111 m, not dragged near the bogus first fix
  });

  it('a progress seed constrains the first fix to a windowed search, not a global nearest', () => {
    // After a reroute splice the rider is at the new leg's start; seeding progress 0 must keep the
    // FIRST fix windowed so a later self-crossing branch cannot be latched at cold-start.
    const far = fx(60.008, 24); // ~890 m along — well past the +300 m window
    const cold = new Snapper(prepareTrack(straight)).update(far); // unseeded scans the whole track
    expect(cold.progressM).toBeGreaterThan(800); // global nearest acquires the far point
    const seeded = new Snapper(prepareTrack(straight), 0).update(far); // seeded at the leg start
    expect(seeded.progressM).toBeLessThanOrEqual(SNAP_WINDOW_FWD_M + 1); // held inside [0, +300 m]
    expect(seeded.onTrack).toBe(false); // clamped point is far laterally -> off-gate, no false latch
  });

  it('does not teleport forward past +300 m through a long segment (B1)', () => {
    // One 1113 m segment; cold-started at the start, a fix ~900 m ahead must not jump there.
    const s = new Snapper(
      prepareTrack([
        { lat: 60, lon: 24 },
        { lat: 60.01, lon: 24 },
      ]),
    );
    s.update(fx(60, 24)); // progress ~0
    const r = s.update(fx(60.008, 24)); // ~890 m along the same segment
    expect(r.progressM).toBeLessThanOrEqual(SNAP_WINDOW_FWD_M + 1); // capped at +300 m
    expect(r.onTrack).toBe(false); // clamped point is ~590 m away laterally -> off-gate
  });

  it('reports off-track beyond the perpendicular gate without advancing progress', () => {
    const s = new Snapper(prepareTrack(straight));
    s.update(fx(60.001, 24)); // establish progress near the start
    const before = s.update(fx(60.002, 24)).progressM;
    const r = s.update(fx(60.0025, 24.002)); // ~110 m east of the line
    expect(r.perpendicularM).toBeGreaterThan(SNAP_PERP_GATE_M);
    expect(r.onTrack).toBe(false);
    expect(r.accepted).toBe(false);
    expect(r.progressM).toBe(before); // progress held, not advanced onto the off-track fix
  });

  it('rejects a large backward jump (windowed, forward-only)', () => {
    const s = new Snapper(prepareTrack(straight));
    // Walk forward in ~111 m steps (each within the +300 m window) to ~556 m in.
    let mid = 0;
    for (const lat of [60, 60.001, 60.002, 60.003, 60.004, 60.005])
      mid = s.update(fx(lat, 24)).progressM;
    const r = s.update(fx(60.001, 24)); // true position ~110 m — >15 m behind
    expect(r.progressM).toBeCloseTo(mid, 3); // not dragged backwards
  });

  it('tolerates small backward jitter within the tolerance', () => {
    const s = new Snapper(prepareTrack(straight));
    let mid = 0;
    for (const lat of [60, 60.001, 60.002, 60.003, 60.004, 60.005])
      mid = s.update(fx(lat, 24)).progressM;
    const backM = 10; // < 15 m tolerance
    const r = s.update(fx(60.005 - backM / 111_320, 24));
    expect(r.progressM).toBeLessThan(mid);
    expect(mid - r.progressM).toBeLessThanOrEqual(SNAP_JITTER_TOLERANCE_M + 1);
  });
});

// A rectangular closed loop: start == finish exactly, like every planned round-trip.
const loop: LatLon[] = [
  { lat: 60, lon: 24 },
  { lat: 60.005, lon: 24 },
  { lat: 60.005, lon: 24.01 },
  { lat: 60, lon: 24.01 },
  { lat: 60, lon: 24 },
];

describe('Snapper — cold start on closed loops (F-004)', () => {
  it('latches the START arm even when first-fix jitter favours the finish arm', () => {
    const track = prepareTrack(loop);
    // 2.2 m up the start arm but 4.5 m along the finish arm: the finish arm is strictly nearer
    // (perp 2.2 m vs 4.5 m), so plain min-perp would begin the ride at ~total ("already done").
    const r = new Snapper(track).update(fx(60.00002, 24.00008));
    expect(r.onTrack).toBe(true);
    expect(r.progressM).toBeLessThan(30); // start arm
    expect(r.progressM).toBeLessThan(track.total - 100); // decisively not the finish arm
  });

  it('unambiguous cold starts are unaffected by the tie-break', () => {
    const track = prepareTrack(loop);
    const r = new Snapper(track).update(fx(60.003, 24.0001)); // clearly on the west arm
    expect(r.onTrack).toBe(true);
    expect(r.progressM).toBeGreaterThan(300);
    expect(r.progressM).toBeLessThan(400);
  });
});

describe('Snapper — outage re-acquisition (F-003, DEC-058)', () => {
  const T0 = Date.parse('2026-07-10T09:00:00.000Z');
  // Fixes along the straight track: `m` metres due north of the start, at second `tS`.
  const fxAt = (m: number, tS: number, lonOff = 0): Fix => ({
    lat: 60 + m / 111_320,
    lon: 24 + lonOff,
    time: new Date(T0 + tS * 1000).toISOString(),
  });

  it('re-latches within 3 fixes after a 60 s GPS gap that outruns the +300 m window', () => {
    const s = new Snapper(prepareTrack(straight), 0);
    expect(s.update(fxAt(0, 0)).accepted).toBe(true);
    expect(s.update(fxAt(7, 1)).accepted).toBe(true);
    // 60 s tunnel at ~25 km/h: the rider reappears ~430 m along — beyond progress + 300 m.
    const r1 = s.update(fxAt(430, 61));
    expect(r1.accepted).toBe(false); // gated: one far fix must never teleport progress
    expect(r1.progressM).toBeLessThan(50);
    expect(s.update(fxAt(437, 62)).accepted).toBe(false);
    const r3 = s.update(fxAt(444, 63));
    expect(r3.accepted).toBe(true); // third agreeing candidate commits
    expect(r3.onTrack).toBe(true);
    expect(r3.progressM).toBeGreaterThan(420);
    expect(r3.progressM).toBeLessThan(460);
    expect(s.update(fxAt(451, 64)).accepted).toBe(true); // normal windowed progress resumes
  });

  it('recovers from a position jump under continuous fix cadence (count-based widening)', () => {
    const s = new Snapper(prepareTrack(straight), 0);
    expect(s.update(fxAt(0, 0)).accepted).toBe(true);
    // Fixes keep arriving at 1 Hz but positions leap beyond the window (backgrounded app).
    let committedAt = -1;
    for (let i = 1; i <= 15; i++) {
      const r = s.update(fxAt(430 + i * 7, i));
      if (r.accepted) {
        committedAt = i;
        expect(r.progressM).toBeGreaterThan(430);
        break;
      }
    }
    expect(committedAt).toBeGreaterThan(0);
    expect(committedAt).toBeLessThanOrEqual(12); // recovered well before the off-route flow gives up
  });

  it('never commits on inconsistent far candidates (ambiguity cannot teleport progress)', () => {
    const s = new Snapper(prepareTrack(straight), 0);
    expect(s.update(fxAt(0, 0)).accepted).toBe(true);
    for (let i = 1; i <= 12; i++) {
      // Alternate between two distant spots — each plausible alone, inconsistent as a streak.
      const r = s.update(fxAt(i % 2 ? 500 : 900, i));
      expect(r.accepted).toBe(false);
      expect(r.progressM).toBeLessThan(50);
    }
  });

  it('stays honestly off-track while the rider is genuinely off the route (no false commit)', () => {
    const s = new Snapper(prepareTrack(straight), 0);
    expect(s.update(fxAt(0, 0)).accepted).toBe(true);
    for (let i = 1; i <= 20; i++) {
      const r = s.update(fxAt(100 + i * 7, i, 0.01)); // ~556 m east of the line, moving north
      expect(r.accepted).toBe(false);
      expect(r.onTrack).toBe(false);
    }
  });
});

describe('estimateProgressFromPath (resume seeding)', () => {
  // Out-and-back along one line: the outbound and return arms overlap exactly (perp ties).
  const outAndBack = prepareTrack([
    { lat: 60, lon: 24 },
    { lat: 60.01, lon: 24 },
    { lat: 60, lon: 24 },
  ]);

  it('disambiguates overlapping arms with the recorded distance (return leg)', () => {
    // Out ~1112 m, back ~445 m: physically ~667 m north but ~1557 m ridden — the return arm.
    const path: LatLon[] = [
      { lat: 60, lon: 24 },
      { lat: 60.01, lon: 24 },
      { lat: 60.006, lon: 24 },
    ];
    const seed = estimateProgressFromPath(outAndBack, path);
    expect(seed).toBeGreaterThan(outAndBack.total / 2); // not the ~667 m outbound alias
    expect(Math.abs(seed - 1557)).toBeLessThan(50);
  });

  it('stays on the outbound arm for a short path; empty path seeds 0', () => {
    const path: LatLon[] = [
      { lat: 60, lon: 24 },
      { lat: 60.002, lon: 24 },
    ];
    expect(Math.abs(estimateProgressFromPath(outAndBack, path) - 222)).toBeLessThan(50);
    expect(estimateProgressFromPath(outAndBack, [])).toBe(0);
  });
});

describe('Snapper — replay integration (WR-013 test contract)', () => {
  it('clean loop: progress is monotonic and finishes within 30 m', () => {
    const s = new Snapper(prepareTrack(cleanRoute));
    const progress = parseTraceToFixes(cleanLoopGpx).map((f) => s.update(f));
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i].progressM).toBeGreaterThanOrEqual(progress[i - 1].progressM);
    }
    expect(progress[progress.length - 1].remainingM).toBeLessThan(30);
    expect(progress.every((p) => p.onTrack)).toBe(true);
  });

  it('jittered clean loop: no backward jump greater than the tolerance', () => {
    const clean = parseTraceToFixes(cleanLoopGpx);
    const jittered = applyJitter(clean, 8, mulberry32(7));
    const s = new Snapper(prepareTrack(cleanRoute));
    const progress = jittered.map((f) => s.update(f).progressM);
    let maxBackward = 0;
    for (let i = 1; i < progress.length; i++) {
      maxBackward = Math.max(maxBackward, progress[i - 1] - progress[i]);
    }
    expect(maxBackward).toBeLessThanOrEqual(SNAP_JITTER_TOLERANCE_M + 1e-6);
    expect(progress[progress.length - 1]).toBeGreaterThan(0.8 * prepareTrack(cleanRoute).total);
  });

  it('figure-eight: passes the crossing without teleporting (max jump < 50 m)', () => {
    const track = prepareTrack(figureRoute);
    const s = new Snapper(track);
    // Jitter the trace: on a clean trace global-nearest would ALSO pass, so this would not
    // guard against a regression to global nearest-point. With 8 m noise the branches at the
    // self-crossing (~4 km apart in progress) diverge — global nearest teleports, windowed does not.
    const jittered = applyJitter(parseTraceToFixes(figureEightGpx), 8, mulberry32(7));
    const progress = jittered.map((f) => s.update(f).progressM);
    let maxJump = 0;
    for (let i = 1; i < progress.length; i++) {
      maxJump = Math.max(maxJump, progress[i] - progress[i - 1]);
    }
    expect(maxJump).toBeLessThan(50); // no teleport to the far branch at the self-crossing
    expect(progress[progress.length - 1]).toBeGreaterThan(0.9 * track.total); // traversed the whole eight
  });
});
