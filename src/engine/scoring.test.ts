import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { resample } from './geometry';
import { decompose } from './wind';
import {
  analyzeCandidate,
  scoreCandidates,
  type CandidateWindInput,
  type ScoreOptions,
} from './scoring';

function seg(
  bearingDeg: number,
  surface: Segment['surface'] = 'paved',
  wayClass?: string,
): Segment {
  return {
    a: { lat: 60, lon: 24 },
    b: { lat: 60, lon: 24 },
    lengthM: 1000,
    bearingDeg,
    gradePct: 0,
    surface,
    wayClass,
    exposure: 1,
  };
}

function candidate(
  id: string,
  bearingDeg: number,
  n = 10,
  surface: Segment['surface'] = 'paved',
): CandidateRoute {
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.1, lon: 24.1 },
    ],
    segments: Array.from({ length: n }, () => seg(bearingDeg, surface)),
    distanceM: n * 1000,
    ascentM: 0,
    steps: [],
  };
}

function sample(windFromDeg: number, h: number): WindSample {
  return {
    windMs: 8,
    windFromDeg,
    gustMs: 12,
    precipProb: 10,
    tempC: 17,
    time: `2026-07-10T${String(17 + h).padStart(2, '0')}:00`,
  };
}
function steadyWind(n: number, hours = 3, windFromDeg = 225): WindSample[][] {
  return Array.from({ length: n }, () =>
    Array.from({ length: hours }, (_v, h) => sample(windFromDeg, h)),
  );
}

const OPTS: ScoreOptions = { targetDistanceM: 10_000, prefersSurface: 'any' };

describe('scoreCandidates — golden ranking (SW 8 m/s steady)', () => {
  // A heads NE (tailwind), C heads SE (crosswind), B heads SW (headwind). Hand-reasoned order:
  // A wins WindComfort + is fastest; C keeps WindComfort but loses CrosswindSafety; B is headwind.
  const inputs: CandidateWindInput[] = [
    { candidate: candidate('A', 45), windBySegment: steadyWind(10) },
    { candidate: candidate('B', 225), windBySegment: steadyWind(10) },
    { candidate: candidate('C', 135), windBySegment: steadyWind(10) },
  ];

  it('ranks tailwind > crosswind > headwind', () => {
    const { ranked } = scoreCandidates(inputs, OPTS);
    expect(ranked.map((r) => r.candidate.id)).toEqual(['A', 'C', 'B']);
    expect(ranked[0].total).toBeGreaterThan(ranked[1].total);
    expect(ranked[1].total).toBeGreaterThan(ranked[2].total);
  });

  it('is snapshot-locked (changing weights requires updating this)', () => {
    const { ranked } = scoreCandidates(inputs, OPTS);
    expect(
      ranked.map((r) => ({ id: r.candidate.id, total: Math.round(r.total) })),
    ).toMatchSnapshot();
  });

  it('is deterministic: identical inputs => identical output', () => {
    const a = scoreCandidates(inputs, OPTS);
    const b = scoreCandidates(inputs, OPTS);
    expect(b.ranked.map((r) => r.total)).toEqual(a.ranked.map((r) => r.total));
    expect(b.ranked.map((r) => r.explanation)).toEqual(a.ranked.map((r) => r.explanation));
  });
});

describe('scoreCandidates — hard constraints (§5)', () => {
  it('rejects routes outside ±15% of the target distance', () => {
    const { rejected, ranked } = scoreCandidates(
      [{ candidate: candidate('short', 45, 5), windBySegment: steadyWind(5) }],
      OPTS,
    );
    expect(ranked).toHaveLength(0);
    expect(rejected[0].reasons.join()).toMatch(/distance/);
  });

  it('rejects routes that use a ferry', () => {
    const ferry = candidate('ferry', 45);
    ferry.segments[3] = seg(45, 'paved', 'ferry');
    const { rejected } = scoreCandidates(
      [{ candidate: ferry, windBySegment: steadyWind(10) }],
      OPTS,
    );
    expect(rejected[0].reasons.join()).toMatch(/ferry/);
  });

  it('rejects routes that would not finish before dark', () => {
    const { rejected } = scoreCandidates(
      [{ candidate: candidate('slow', 225), windBySegment: steadyWind(10) }],
      { ...OPTS, homeBeforeDark: true, minutesUntilSunset: 30 },
    );
    expect(rejected[0].reasons.join()).toMatch(/dark/);
  });
});

describe('two-pass arrival-time wind sampling (§1)', () => {
  it('samples later segments at a later forecast hour', () => {
    // A 40 km NE route: hour 0 blows FROM the NE (headwind), hour 1 FROM the SW (tailwind).
    const n = 40;
    const windBySegment: WindSample[][] = Array.from({ length: n }, () => [
      sample(45, 0), // hour 0: wind from NE -> headwind for a NE-bound rider
      sample(225, 1), // hour 1: wind from SW -> tailwind
    ]);
    const a = analyzeCandidate(candidate('long', 45, n), windBySegment, OPTS);
    expect(a.segments[0].wind.vParMs).toBeLessThan(0); // early: headwind (hour 0)
    expect(a.segments[a.segments.length - 1].wind.vParMs).toBeGreaterThan(0); // late: tailwind (hour 1)
    expect(a.segments[a.segments.length - 1].hourIndex).toBeGreaterThan(a.segments[0].hourIndex);
  });
});

describe('loop-cancellation invariant (§7)', () => {
  it('Σ L·cos(Δ) ≈ 0 for a closed loop in uniform wind', () => {
    const loop = [
      { lat: 60.0, lon: 24.0 },
      { lat: 60.02, lon: 24.0 },
      { lat: 60.02, lon: 24.03 },
      { lat: 60.0, lon: 24.03 },
      { lat: 60.0, lon: 24.0 },
    ];
    const segs = resample({ polyline: loop }, 300);
    let along = 0;
    let totalLen = 0;
    for (const s of segs) {
      along += s.lengthM * decompose(s.bearingDeg, 225, 1).vParMs; // cos(delta) with W=1
      totalLen += s.lengthM;
    }
    expect(Math.abs(along) / totalLen).toBeLessThan(0.05);
  });
});

describe('performance guard', () => {
  it('scores 8 candidates x ~170 segments x 12 hours in < 300 ms', () => {
    const inputs: CandidateWindInput[] = Array.from({ length: 8 }, (_v, i) => ({
      candidate: candidate(`c${i}`, i * 45, 170),
      windBySegment: steadyWind(170, 12),
    }));
    const opts: ScoreOptions = { targetDistanceM: 170_000, distanceTolerancePct: 0.5 };
    const t0 = performance.now();
    scoreCandidates(inputs, opts);
    expect(performance.now() - t0).toBeLessThan(300);
  });
});
