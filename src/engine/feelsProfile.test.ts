import { describe, expect, it } from 'vitest';
import type { SegmentAnalysis } from './scoring';
import { buildFeelsProfile, equivalentGrade, FEEL_K_PCT } from './feelsProfile';

/** SegmentAnalysis with a set grade, along-wind component, and delta (for kind). */
function sa(gradePct: number, vParMs: number, deltaDeg = 0): SegmentAnalysis {
  return {
    seg: {
      a: { lat: 60, lon: 24 },
      b: { lat: 60, lon: 24 },
      lengthM: 1000,
      bearingDeg: 0,
      gradePct,
      surface: 'paved',
      exposure: 1,
    },
    wind: { windToDeg: 0, deltaDeg, effectiveMs: 8, vParMs, vCrossMs: 0, gustEffMs: 10 },
    speedKmh: 20,
    timeS: 180,
    startS: 0,
    hourIndex: 0,
    precipProb: 0,
  } as SegmentAnalysis;
}

describe('equivalentGrade', () => {
  it('is unchanged in still air', () => {
    expect(equivalentGrade(3, 0)).toBe(3);
    expect(equivalentGrade(0, 0)).toBe(0);
  });
  it('adds ~+2.5% for an 8 m/s direct headwind, subtracts for tailwind', () => {
    expect(equivalentGrade(0, -8)).toBeCloseTo(FEEL_K_PCT, 6); // headwind
    expect(equivalentGrade(0, 8)).toBeCloseTo(-FEEL_K_PCT, 6); // tailwind
    expect(equivalentGrade(3, -8)).toBeCloseTo(3 + FEEL_K_PCT, 6);
  });
});

describe('buildFeelsProfile', () => {
  it('still air: feels-like profile equals the actual profile', () => {
    const profile = buildFeelsProfile([sa(2, 0), sa(0, 0), sa(-2, 0)]);
    for (const p of profile) expect(p.feelsEleM).toBeCloseTo(p.eleM, 6);
  });

  it('tailwind on flats: feels-like drops below the actual (flat) profile', () => {
    const profile = buildFeelsProfile([sa(0, 8), sa(0, 8), sa(0, 8)]); // tailwind, no hills
    const last = profile[profile.length - 1];
    expect(last.eleM).toBeCloseTo(0, 6);
    expect(last.feelsEleM).toBeLessThan(0);
  });

  it('headwind on flats: feels-like climbs above the actual profile', () => {
    const last = buildFeelsProfile([sa(0, -8), sa(0, -8), sa(0, -8)]).at(-1)!;
    expect(last.feelsEleM).toBeGreaterThan(0);
  });

  it('downsamples to ≤ 200 points', () => {
    const many = Array.from({ length: 500 }, () => sa(0, -4));
    expect(buildFeelsProfile(many).length).toBeLessThanOrEqual(200);
  });

  it('golden profile snapshot', () => {
    const profile = buildFeelsProfile([sa(2, -8, 180), sa(0, 0, 90), sa(-2, 8, 0)]);
    expect(
      profile.map((p) => ({
        d: Math.round(p.distanceM),
        ele: Math.round(p.eleM),
        feels: Math.round(p.feelsEleM),
        kind: p.kind,
      })),
    ).toMatchSnapshot();
  });
});
