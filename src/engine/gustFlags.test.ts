import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import type { SegmentAnalysis } from './scoring';
import { detectGustStretches, isGustFlagged } from './gustFlags';

/** Minimal SegmentAnalysis for flag tests: a lengthM segment on a due-east line, with wind fields. */
function sa(
  i: number,
  lengthM: number,
  opts: { exposure?: number; gustEffMs?: number; vCrossMs?: number; effectiveMs?: number } = {},
): SegmentAnalysis {
  const a: LatLon = { lat: 60, lon: 24 + i * 0.01 };
  const b: LatLon = { lat: 60, lon: 24 + (i + 1) * 0.01 };
  return {
    seg: {
      a,
      b,
      lengthM,
      bearingDeg: 90,
      gradePct: 0,
      surface: 'paved',
      exposure: opts.exposure ?? 1,
    },
    wind: {
      windToDeg: 0,
      deltaDeg: 90,
      effectiveMs: opts.effectiveMs ?? 10,
      vParMs: 0,
      vCrossMs: opts.vCrossMs ?? 9,
      gustEffMs: opts.gustEffMs ?? 15,
    },
    speedKmh: 20,
    timeS: lengthM / 5.5,
    startS: 0,
    hourIndex: 0,
    precipProb: 0,
  } as SegmentAnalysis;
}

describe('isGustFlagged', () => {
  it('flags an exposed, strong-gust, crosswind segment', () => {
    expect(isGustFlagged(sa(0, 100))).toBe(true);
  });
  it('does not flag sheltered / weak-gust / along-wind segments', () => {
    expect(isGustFlagged(sa(0, 100, { exposure: 0.35 }))).toBe(false); // sheltered
    expect(isGustFlagged(sa(0, 100, { gustEffMs: 10 }))).toBe(false); // below 13
    expect(isGustFlagged(sa(0, 100, { vCrossMs: 2 }))).toBe(false); // mostly along-wind
  });
});

describe('detectGustStretches', () => {
  it('merges contiguous flagged segments into one stretch ≥ 300 m', () => {
    const segs = [0, 1, 2, 3, 4].map((i) => sa(i, 100)); // 5 × 100 m, all flagged
    const s = detectGustStretches(segs, { minStretchM: 300, gapBridgeM: 0 });
    expect(s).toHaveLength(1);
    expect(s[0].lengthM).toBe(500);
    expect(s[0].maxGustMs).toBe(15);
  });

  it('drops stretches shorter than the minimum', () => {
    const segs = [0, 1].map((i) => sa(i, 100)); // 200 m < 300
    expect(detectGustStretches(segs, { minStretchM: 300, gapBridgeM: 0 })).toHaveLength(0);
  });

  it('bridges a short calm gap, but a long gap splits', () => {
    // flagged(0-100), calm(100-200), flagged(200-300): a 100 m gap bridges → one 300 m stretch.
    const bridged = [sa(0, 100), sa(1, 100, { gustEffMs: 5 }), sa(2, 100)];
    expect(detectGustStretches(bridged, { minStretchM: 300, gapBridgeM: 150 })).toHaveLength(1);
    // With no bridging tolerance the two 100 m flagged runs are each < 300 m → nothing.
    expect(detectGustStretches(bridged, { minStretchM: 300, gapBridgeM: 0 })).toHaveLength(0);
  });

  it('reports a midpoint inside the stretch', () => {
    const segs = [0, 1, 2].map((i) => sa(i, 100));
    const [s] = detectGustStretches(segs, { minStretchM: 300, gapBridgeM: 0 });
    expect(s.midpoint.lat).toBeCloseTo(60, 6);
    expect(s.midpoint.lon).toBeGreaterThan(24);
    expect(s.midpoint.lon).toBeLessThan(24 + 3 * 0.01);
  });

  it('golden: an exposed coastal candidate flags, a sheltered forest one does not', () => {
    const coastal = [0, 1, 2, 3].map((i) => sa(i, 150, { exposure: 1.15 })); // 600 m exposed
    const forest = [0, 1, 2, 3].map((i) => sa(i, 150, { exposure: 0.35 })); // sheltered
    expect(detectGustStretches(coastal).length).toBeGreaterThan(0);
    expect(detectGustStretches(forest)).toHaveLength(0);
  });
});
