import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { scoreCandidates, type CandidateWindInput, type SegmentAnalysis } from './scoring';
import { DEFAULT_SPEED_SETTINGS } from './speedModel';
import {
  ICE_RISK_TEMP_C,
  iceRisk,
  iceRiskMessage,
  precipType,
  shadedKm,
  suggestWinter,
  winterSpeedSettings,
} from './winter';

describe('suggestWinter', () => {
  it('suggests winter at/below +3 °C', () => {
    expect(suggestWinter(3)).toBe(true);
    expect(suggestWinter(-5)).toBe(true);
    expect(suggestWinter(3.1)).toBe(false);
    expect(suggestWinter(15)).toBe(false);
  });
});

describe('precipType (snow ≠ rain)', () => {
  it('classifies by temperature, and none when dry', () => {
    expect(precipType(-2, 80)).toBe('snow');
    expect(precipType(1, 80)).toBe('sleet');
    expect(precipType(8, 80)).toBe('rain');
    expect(precipType(-2, 5)).toBe('none'); // low probability ⇒ nothing falling
  });
});

describe('iceRisk truth table', () => {
  // Fires ONLY when cold enough AND it precipitated in the prior 24 h.
  const cases: Array<[number, number, boolean]> = [
    [ICE_RISK_TEMP_C, 2, true], // exactly +1 °C, wet ⇒ risk
    [-4, 0.2, true], // freezing, a trace ⇒ risk
    [1, 0, false], // cold but bone dry ⇒ no risk
    [5, 10, false], // wet but warm ⇒ no risk
    [1.1, 5, false], // just above the threshold ⇒ no risk
  ];
  it.each(cases)('minTemp %d°C, prior24h %d mm ⇒ %s', (minTempC, precipPrior24hMm, expected) => {
    expect(iceRisk({ minTempC, precipPrior24hMm })).toBe(expected);
  });

  it('is always phrased as a caution, never a guarantee', () => {
    expect(iceRiskMessage(0)).toMatch(/possible ice/i);
    expect(iceRiskMessage(0)).not.toMatch(/will be icy|is icy/i);
    expect(iceRiskMessage(4.2)).toMatch(/shaded\/forest stretches \(4\.2 km\)/i);
  });
});

describe('winterSpeedSettings (studded offset)', () => {
  it('drops every surface base speed by the studded offset', () => {
    const w = winterSpeedSettings(DEFAULT_SPEED_SETTINGS, 3);
    expect(w.baseKmh.paved).toBe(DEFAULT_SPEED_SETTINGS.baseKmh.paved - 3);
    expect(w.baseKmh.gravel).toBe(DEFAULT_SPEED_SETTINGS.baseKmh.gravel - 3);
    // Never below the model floor.
    const w2 = winterSpeedSettings(DEFAULT_SPEED_SETTINGS, 999);
    expect(w2.baseKmh.paved).toBe(DEFAULT_SPEED_SETTINGS.minKmh);
    // Grade/wind coefficients untouched.
    expect(w.tailCoef).toBe(DEFAULT_SPEED_SETTINGS.tailCoef);
  });

  it('also raises rolling resistance so the physics model slows too (not a linear-only no-op)', () => {
    const w = winterSpeedSettings(DEFAULT_SPEED_SETTINGS, 3, 1.3);
    for (const s of Object.keys(DEFAULT_SPEED_SETTINGS.crr) as Array<
      keyof typeof DEFAULT_SPEED_SETTINGS.crr
    >) {
      expect(w.crr[s]).toBeCloseTo(DEFAULT_SPEED_SETTINGS.crr[s] * 1.3, 6);
    }
  });
});

describe('shadedKm', () => {
  it('sums length of segments in deep shade (exposure ≤ 0.5)', () => {
    const seg = (exposure: number, lengthM: number): SegmentAnalysis =>
      ({ seg: { exposure, lengthM } }) as unknown as SegmentAnalysis;
    const analysis = {
      segments: [seg(0.3, 2000), seg(1.0, 3000), seg(0.5, 1000)],
    } as unknown as CandidateRoute & { segments: SegmentAnalysis[] };
    // 2000 m (0.3) + 1000 m (0.5) = 3 km shaded; the exposure-1.0 stretch is not.
    expect(shadedKm(analysis as never)).toBeCloseTo(3, 6);
  });
});

// --- Daylight hard constraint at a Nordic winter sunset (WR-027 golden) ---
function seg(bearingDeg: number): Segment {
  return {
    a: { lat: 60.17, lon: 24.94 },
    b: { lat: 60.17, lon: 24.94 },
    lengthM: 1000,
    bearingDeg,
    gradePct: 0,
    surface: 'paved',
    exposure: 1,
  };
}
function candidate(id: string, n: number): CandidateRoute {
  return {
    id,
    polyline: [
      { lat: 60.17, lon: 24.94 },
      { lat: 60.2, lon: 25.0 },
    ],
    segments: Array.from({ length: n }, () => seg(45)),
    distanceM: n * 1000,
    ascentM: 0,
    steps: [],
  };
}
const winter = (n: number): WindSample => ({
  windMs: 6,
  windFromDeg: 200,
  gustMs: 9,
  precipProb: 40,
  tempC: -4,
  time: `2026-12-15T${String(9 + n).padStart(2, '0')}:00`,
});

describe('winter daylight hard constraint (Helsinki December)', () => {
  const input: CandidateWindInput = {
    candidate: candidate('long', 30), // ~30 km ⇒ well over an hour
    windBySegment: Array.from({ length: 30 }, () =>
      Array.from({ length: 3 }, (_v, h) => winter(h)),
    ),
  };
  const opts = { targetDistanceM: 30_000, homeBeforeDark: true as const };

  it('eliminates a ride that would not finish before the ~15:13 sunset', () => {
    // Only ~40 min of usable daylight left ⇒ a >1 h ride is rejected.
    const { ranked, rejected } = scoreCandidates([input], { ...opts, minutesUntilSunset: 40 });
    expect(ranked).toHaveLength(0);
    expect(rejected[0].reasons.join()).toMatch(/dark/);
  });

  it('keeps the same ride when there is enough daylight', () => {
    const { ranked } = scoreCandidates([input], { ...opts, minutesUntilSunset: 240 });
    expect(ranked).toHaveLength(1);
  });

  it('golden winter morning: late start eliminated by daylight AND icy-morning flag fires', () => {
    // A −4 °C December morning after overnight snow: only ~40 min of daylight remains for a late
    // departure (eliminated), and the ice-risk heuristic fires (coldest hour −4 °C, 6 mm prior 24 h).
    const { ranked } = scoreCandidates([input], { ...opts, minutesUntilSunset: 40 });
    expect(ranked).toHaveLength(0); // daylight hard-constraint eliminates the late ride
    const minTempC = Math.min(...input.windBySegment[0].map((s) => s.tempC));
    expect(iceRisk({ minTempC, precipPrior24hMm: 6 })).toBe(true); // icy-morning flag fires
  });
});
