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

/** A headwind candidate (bearing 45 into a NE wind) with a uniform exposure factor. */
function shelteredCandidate(id: string, exposure: number): CandidateRoute {
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.1, lon: 24.1 },
    ],
    segments: Array.from({ length: 10 }, () => ({ ...seg(45), exposure })),
    distanceM: 10_000,
    ascentM: 0,
    steps: [],
  };
}

describe('WR-019 shelter-aware scoring', () => {
  it('W_eff scales v_par by segment exposure', () => {
    // bearing 45, wind_from 45 ⇒ pure headwind; exposure 0.35 scales the effective wind.
    const a = analyzeCandidate(shelteredCandidate('s', 0.35), steadyWind(10, 3, 45), OPTS);
    expect(a.segments[0].wind.effectiveMs).toBeCloseTo(8 * 0.35, 6);
    expect(a.segments[0].wind.vParMs).toBeCloseTo(-8 * 0.35, 6); // headwind, scaled down
  });

  it('a forest-sheltered headwind route outranks its exposed twin (synthetic grid)', () => {
    const inputs: CandidateWindInput[] = [
      { candidate: shelteredCandidate('exposed', 1.0), windBySegment: steadyWind(10, 3, 45) },
      { candidate: shelteredCandidate('sheltered', 0.35), windBySegment: steadyWind(10, 3, 45) },
    ];
    // hasShelterData:true — a real exposure grid covers these routes, so the shelter axis is live.
    const { ranked } = scoreCandidates(inputs, { ...OPTS, hasShelterData: true });
    const sheltered = ranked.find((r) => r.candidate.id === 'sheltered')!;
    const exposed = ranked.find((r) => r.candidate.id === 'exposed')!;
    // All upwind time is sheltered vs none.
    expect(sheltered.sub.shelter.raw).toBeCloseTo(1, 6);
    expect(exposed.sub.shelter.raw).toBeCloseTo(0, 6);
    expect(sheltered.evidence.shelteredUpwindKm).toBeCloseTo(10, 6);
    expect(sheltered.evidence.shelteredEffWindMs).toBeCloseTo(8 * 0.35, 6);
    expect(sheltered.total).toBeGreaterThan(exposed.total);
    expect(ranked[0].candidate.id).toBe('sheltered');
  });

  it('CrosswindSafety penalizes an exposed ≥13 m/s gust crosswind and not a calm twin', () => {
    // bearing 135 into a SW (225) wind ⇒ pure crosswind; gust 16 ≥ 13 with exposure 1 flags it.
    const gusty = candidate('gusty', 135);
    const calm = candidate('calm', 135);
    const wind = (gustMs: number): WindSample[][] =>
      Array.from({ length: 10 }, () => [
        { windMs: 8, windFromDeg: 225, gustMs, precipProb: 0, tempC: 15, time: '2026-07-10T09:00' },
      ]);
    const { ranked } = scoreCandidates(
      [
        { candidate: gusty, windBySegment: wind(16) },
        { candidate: calm, windBySegment: wind(9) }, // below the 13 m/s flag
      ],
      OPTS,
    );
    const g = ranked.find((r) => r.candidate.id === 'gusty')!;
    const c = ranked.find((r) => r.candidate.id === 'calm')!;
    expect(g.sub.safety.raw).toBeGreaterThan(0); // crossPenalty accrued
    expect(c.sub.safety.raw).toBe(0);
    expect(g.evidence.gustyKm).toBeCloseTo(10, 6);
    expect(g.evidence.maxGustMs).toBeCloseTo(16, 6);
    expect(c.evidence.gustyKm).toBe(0);
    expect(g.sub.safety.normalized).toBeLessThan(c.sub.safety.normalized); // safer = higher
  });

  it('does NOT differentiate on shelter without a grid (headwind presence is not shelter)', () => {
    // A headwind and a tailwind candidate, both exposure 1.0, no shelter data → uniform 0.5 shelter
    // so presence-of-headwind can't leak into the shelter axis.
    const { ranked } = scoreCandidates(
      [
        { candidate: shelteredCandidate('hw', 1.0), windBySegment: steadyWind(10, 3, 45) }, // headwind
        { candidate: shelteredCandidate('tw', 1.0), windBySegment: steadyWind(10, 3, 225) }, // tailwind
      ],
      OPTS, // hasShelterData defaults false
    );
    for (const r of ranked) expect(r.sub.shelter.normalized).toBe(0.5);
  });
});

describe('scoreCandidates — golden ranking (SW 8 m/s steady)', () => {
  // A heads NE (tailwind), C heads SE (crosswind), B heads SW (headwind). Hand-reasoned order:
  // A wins WindComfort + is fastest; C keeps WindComfort (crosswind, no headwind); B is headwind.
  // NOTE: the golden gust is 12 m/s (< the 13 m/s WR-021 flag), so CrosswindSafety is uniform here
  // and does not differentiate — the safety penalty path is exercised separately below.
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

describe('WR-025 forecast robustness (±30°)', () => {
  /** A closed 12-gon: bearings 0,30,…330 — the delta multiset is invariant under a 30° wind shift. */
  function circleCandidate(id: string, n = 12): CandidateRoute {
    return {
      id,
      polyline: [
        { lat: 60, lon: 24 },
        { lat: 60.1, lon: 24.1 },
      ],
      segments: Array.from({ length: n }, (_v, i) => seg((i * 360) / n)),
      distanceM: n * 1000,
      ascentM: 0,
      steps: [],
    };
  }

  it('symmetric loop: robustness ≈ WindComfort (rotation-invariant), spread ≈ 0', () => {
    const c = circleCandidate('loop', 12);
    const { ranked } = scoreCandidates([{ candidate: c, windBySegment: steadyWind(12, 3, 200) }], {
      ...OPTS,
      targetDistanceM: 12_000,
    });
    const loop = ranked[0];
    // Worst-case (min WindComfort) equals the forecast penalty for a rotation-symmetric loop.
    expect(loop.sub.robustness.raw).toBeCloseTo(loop.sub.wind.raw, 5);
    expect(loop.evidence.robustnessSpreadMs).toBeCloseTo(0, 5);
  });

  it('demotes a fragile route below a slightly-worse-but-robust one', () => {
    // fragile: bearing 135 into a SW wind ⇒ pure crosswind at forecast (zero headwind, "great"),
    //          but a −30° shift swings it to a 120° headwind — it collapses.
    // robust: bearing 100 ⇒ tailwind at forecast and still headwind-free at ±30°, but it's a touch
    //          short of target (9 km vs 10 km) so its DISTANCE score is slightly worse.
    const fragile = candidate('fragile', 135, 10); // 10 km, on target
    const robust = candidate('robust', 100, 9); // 9 km, slightly short
    const { ranked } = scoreCandidates(
      [
        { candidate: fragile, windBySegment: steadyWind(10, 3, 225) },
        { candidate: robust, windBySegment: steadyWind(9, 3, 225) },
      ],
      OPTS,
    );

    const f = ranked.find((r) => r.candidate.id === 'fragile')!;
    const r = ranked.find((r) => r.candidate.id === 'robust')!;
    // Both are headwind-free at the exact forecast (WindComfort ties)...
    expect(f.sub.wind.raw).toBeCloseTo(0, 6);
    expect(r.sub.wind.raw).toBeCloseTo(0, 6);
    // ...but the fragile one collapses under a wrong forecast, the robust one does not.
    expect(f.evidence.robustnessSpreadMs).toBeGreaterThan(1);
    expect(r.evidence.robustnessSpreadMs).toBeCloseTo(0, 6);
    expect(r.sub.robustness.normalized).toBeGreaterThan(f.sub.robustness.normalized);
    // Robustness outweighs the fragile route's small distance edge: robust ranks first.
    expect(ranked[0].candidate.id).toBe('robust');
    expect(
      ranked.map((x) => ({ id: x.candidate.id, total: Math.round(x.total) })),
    ).toMatchSnapshot();
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

  it('maps each segment to the correct forecast hour (midpoint math, ≥4 hours)', () => {
    // 30 flat paved 1 km segments at 27 km/h base => ~133 s each. Segment k's midpoint elapsed
    // time is (k+0.5)*133 s; the hour index is floor(that / 3600).
    const n = 30;
    const windBySegment: WindSample[][] = Array.from({ length: n }, () =>
      Array.from({ length: 6 }, (_v, h) => sample(225, h)),
    );
    const a = analyzeCandidate(candidate('hours', 90, n), windBySegment, OPTS);
    const perSegMs = 1000 / (27 / 3.6);
    for (let i = 0; i < n; i++) {
      const expected = Math.min(5, Math.floor(((i + 0.5) * perSegMs) / 3600));
      expect(a.segments[i].hourIndex).toBe(expected);
    }
  });

  it('throws on a transposed/short WindGrid rather than scoring dead calm', () => {
    expect(() => analyzeCandidate(candidate('x', 45, 10), steadyWind(3), OPTS)).toThrow(/segments/);
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
