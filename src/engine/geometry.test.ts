import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import {
  bearingDeg,
  deg2rad,
  expandRangesToEdges,
  haversineM,
  normalizeDeg,
  overlapRatio,
  polylineLengthM,
  rad2deg,
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

  it('smooths single-point elevation spikes (3-window average attenuates the peak)', () => {
    const elevations = line.map((_p, i) => (i === 5 ? 50 : 0)); // one 50 m spike
    const segs = resample({ polyline: line, elevations }, 300);
    const maxGrade = Math.max(...segs.map((s) => Math.abs(s.gradePct)));
    // Unsmoothed the spike segment reads ~10%; the 3-segment average pulls it well below 6%.
    expect(maxGrade).toBeLessThan(6);
    expect(maxGrade).toBeGreaterThan(1);
  });

  it('throws on elevations whose length does not match the polyline (corrupt input)', () => {
    expect(() => resample({ polyline: line, elevations: [0, 1, 2] })).toThrow(/elevations length/);
  });

  it('returns a single whole-length segment for routes shorter than 200 m', () => {
    const shortLine = northLine(60, 24, 2, 0.0013); // ~145 m
    const total = polylineLengthM(shortLine);
    const segs = resample({ polyline: shortLine }, 300);
    expect(segs).toHaveLength(1);
    expect(segs[0].lengthM).toBeCloseTo(total, 1);
  });

  it('returns [] for a degenerate polyline', () => {
    expect(resample({ polyline: [{ lat: 60, lon: 24 }] })).toEqual([]);
  });
});

describe('resample bearings (golden bendy path + folds)', () => {
  it('matches known leg bearings on a north-then-east path', () => {
    // Leg 1: due north ~2.2 km; Leg 2: due east ~1.1 km. Segments inherit their leg's bearing.
    const path: LatLon[] = [
      { lat: 60.0, lon: 24.0 },
      { lat: 60.02, lon: 24.0 }, // north
      { lat: 60.02, lon: 24.02 }, // east
    ];
    const segs = resample({ polyline: path }, 300);
    expect(smallestAngle(segs[0].bearingDeg, 0)).toBeLessThan(1); // first segment heads north
    expect(smallestAngle(segs[segs.length - 1].bearingDeg, 90)).toBeLessThan(1); // last heads east
  });

  it('gives an out-and-back turnaround segment a sane (non-garbage) bearing', () => {
    // Out due north then back: the folded middle segment must not collapse to bearing 0 via chord.
    const out: LatLon[] = [
      { lat: 60.0, lon: 24.0 },
      { lat: 60.006, lon: 24.0 },
    ];
    const back = [...out].reverse();
    const path = [...out, ...back.slice(1)];
    const segs = resample({ polyline: path }, 300);
    // Every segment's bearing is ~0 (north, outbound) or ~180 (south, return) — never a garbage
    // in-between value from a near-zero chord.
    for (const s of segs) {
      const toN = smallestAngle(s.bearingDeg, 0);
      const toS = smallestAngle(s.bearingDeg, 180);
      expect(Math.min(toN, toS)).toBeLessThan(5);
    }
  });
});

describe('angle/distance helper coverage', () => {
  it('deg2rad and rad2deg round-trip', () => {
    expect(deg2rad(180)).toBeCloseTo(Math.PI);
    expect(rad2deg(Math.PI)).toBeCloseTo(180);
    expect(rad2deg(deg2rad(137))).toBeCloseTo(137);
  });

  it('haversineM matches a known short distance', () => {
    // 0.01° of latitude ≈ 1113 m.
    expect(haversineM({ lat: 60, lon: 24 }, { lat: 60.01, lon: 24 })).toBeGreaterThan(1100);
    expect(haversineM({ lat: 60, lon: 24 }, { lat: 60.01, lon: 24 })).toBeLessThan(1130);
  });

  it('smallestAngle normalises negative and >360 inputs', () => {
    expect(smallestAngle(-10, 350)).toBeCloseTo(0);
    expect(smallestAngle(370, 10)).toBeCloseTo(0);
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

  it('uses the fallback for gaps and clips out-of-range ends', () => {
    // Range [2,4] leaves edges 0,1 and 4..8 as fallback; end 99 clips to the last edge.
    const edges = expandRangesToEdges([[2, 4, 7]], 10, (c) => c, -1);
    expect(edges).toEqual([-1, -1, 7, 7, -1, -1, -1, -1, -1]);
    expect(expandRangesToEdges([[0, 99, 5]], 4, (c) => c, 0)).toEqual([5, 5, 5]);
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

  it('is symmetric and direction-blind (reversed loop still ~1)', () => {
    const half = northLine(60.01, 24, 6, 0.004);
    expect(overlapRatio(a, half)).toBeCloseTo(overlapRatio(half, a), 5);
    expect(overlapRatio(a, [...a].reverse())).toBeCloseTo(1, 1);
  });
});
