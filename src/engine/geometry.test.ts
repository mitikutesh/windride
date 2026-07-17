import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import {
  bearingDeg,
  expandRangesToEdges,
  normalizeDeg,
  overlapRatio,
  polylineLengthM,
  resample,
  smallestAngle,
  type RouteGeometry,
} from './geometry';

// A straight due-north polyline: 10 points ~500 m apart (0.0045° lat ≈ 500 m at this latitude).
function northLine(startLat = 60, lon = 24, n = 10, stepDeg = 0.0045): LatLon[] {
  return Array.from({ length: n }, (_v, i) => ({ lat: startLat + i * stepDeg, lon }));
}

describe('angle helpers', () => {
  it('normalizeDeg wraps into [0,360)', () => {
    expect(normalizeDeg(-10)).toBeCloseTo(350);
    expect(normalizeDeg(370)).toBeCloseTo(10);
    expect(normalizeDeg(0)).toBe(0);
  });

  it('smallestAngle handles the 359<->1 wrap and antipodes', () => {
    expect(smallestAngle(359, 1)).toBeCloseTo(2);
    expect(smallestAngle(1, 359)).toBeCloseTo(2);
    expect(smallestAngle(10, 350)).toBeCloseTo(20);
    expect(smallestAngle(0, 180)).toBeCloseTo(180);
    expect(smallestAngle(90, 270)).toBeCloseTo(180);
  });
});

describe('bearingDeg', () => {
  it('is ~0 due north and ~90 due east', () => {
    expect(
      smallestAngle(bearingDeg({ lat: 60, lon: 24 }, { lat: 60.01, lon: 24 }), 0),
    ).toBeLessThan(0.5);
    expect(
      smallestAngle(bearingDeg({ lat: 60, lon: 24 }, { lat: 60, lon: 24.01 }), 90),
    ).toBeLessThan(0.5);
  });
});

describe('resample (golden + invariants)', () => {
  const line = northLine();
  const total = polylineLengthM(line);

  it('segment lengths sum to the route distance (±0.5%) and stay within [200,500]', () => {
    const segs = resample({ polyline: line }, 300);
    const sum = segs.reduce((acc, s) => acc + s.lengthM, 0);
    expect(Math.abs(sum - total) / total).toBeLessThan(0.005);
    for (const s of segs) {
      expect(s.lengthM).toBeGreaterThanOrEqual(200);
      expect(s.lengthM).toBeLessThanOrEqual(500);
    }
  });

  it('a due-north line yields segments all bearing ~0', () => {
    const segs = resample({ polyline: line }, 300);
    for (const s of segs) expect(smallestAngle(s.bearingDeg, 0)).toBeLessThan(1);
  });

  it('reversing the polyline flips every bearing by ~180', () => {
    const fwd = resample({ polyline: line }, 300);
    const rev = resample({ polyline: [...line].reverse() }, 300);
    for (const s of fwd) expect(smallestAngle(s.bearingDeg, 0)).toBeLessThan(1);
    for (const s of rev) expect(smallestAngle(s.bearingDeg, 180)).toBeLessThan(1);
  });

  it('is stable when resampled twice', () => {
    const once = resample({ polyline: line }, 300);
    const twice = resample(
      { polyline: once.flatMap((s, i) => (i === 0 ? [s.a, s.b] : [s.b])) },
      300,
    );
    const sumOnce = once.reduce((a, s) => a + s.lengthM, 0);
    const sumTwice = twice.reduce((a, s) => a + s.lengthM, 0);
    expect(Math.abs(sumOnce - sumTwice) / sumOnce).toBeLessThan(0.01);
  });

  it('smooths single-point elevation spikes (grade stays bounded)', () => {
    const elevations = line.map((_p, i) => (i === 5 ? 50 : 0)); // one 50 m spike
    const segs = resample({ polyline: line, elevations }, 300);
    const rawSpikeGrade = (50 / 300) * 100; // ≈16.7% if unsmoothed over one segment
    const maxGrade = Math.max(...segs.map((s) => Math.abs(s.gradePct)));
    expect(maxGrade).toBeLessThan(rawSpikeGrade);
  });

  it('returns [] for a degenerate polyline', () => {
    expect(resample({ polyline: [{ lat: 60, lon: 24 }] })).toEqual([]);
  });
});

describe('resample surface majority (per-edge)', () => {
  it('carries the surface covering most of a segment', () => {
    const line = northLine(60, 24, 4, 0.0009); // 3 edges ~100 m each, ~300 m total
    const geo: RouteGeometry = {
      polyline: line,
      surfaces: ['paved', 'gravel', 'gravel'], // gravel covers 2/3 of the distance
    };
    const segs = resample(geo, 300); // one ~300 m segment spanning all edges -> gravel majority
    expect(segs).toHaveLength(1);
    expect(segs[0].surface).toBe('gravel');
  });
});

describe('expandRangesToEdges', () => {
  it('maps point-indexed ranges to per-edge values (off-by-one guard)', () => {
    const edges = expandRangesToEdges(
      [
        [0, 5, 3],
        [5, 9, 1],
      ],
      10,
      (c) => c,
      0,
    );
    expect(edges).toEqual([3, 3, 3, 3, 3, 1, 1, 1, 1]); // 9 edges for 10 points
  });
});

describe('overlapRatio', () => {
  const a = northLine(60, 24, 6, 0.004); // ~2.2 km due north
  it('is 1 for identical lines and 0 for disjoint lines', () => {
    expect(overlapRatio(a, a)).toBeCloseTo(1, 1);
    const far = northLine(60, 24.1, 6, 0.004); // ~5.5 km east
    expect(overlapRatio(a, far)).toBeCloseTo(0, 1);
  });

  it('scales with partial overlap', () => {
    const half = northLine(60.01, 24, 6, 0.004); // starts mid-A, extends beyond
    const r50 = overlapRatio(a, half);
    expect(r50).toBeGreaterThan(0.3);
    expect(r50).toBeLessThan(0.7);

    const mostly = northLine(60.002, 24, 6, 0.004); // overlaps most of A
    const r80 = overlapRatio(a, mostly);
    expect(r80).toBeGreaterThan(r50);
  });
});
