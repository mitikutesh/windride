import { describe, expect, it } from 'vitest';
import cleanLoopGpx from '../../fixtures/traces/clean-loop.gpx?raw';
import figureEightGpx from '../../fixtures/traces/figure-eight.gpx?raw';
import cleanRouteRaw from '../../fixtures/traces/clean-loop-route.json?raw';
import figureRouteRaw from '../../fixtures/traces/figure-eight-route.json?raw';
import type { LatLon } from '../domain';
import type { Fix } from './fixSource';
import { parseTraceToFixes, mulberry32, applyJitter } from './replay';
import {
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
