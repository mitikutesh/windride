import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import {
  downwindEndpoints,
  frequencyFactor,
  rankDownwind,
  tailwindTimeShare,
  type Station,
} from './downwind';
import type { CandidateAnalysis, SegmentAnalysis } from './scoring';

const START: LatLon = { lat: 60.17, lon: 24.94 }; // Helsinki
const WIND_TO = 45; // SW wind (from 225) ⇒ downwind travel is NE

/** Place a station at an exact bearing + distance from START (so arc/band filters are controllable). */
function stationAt(id: string, brgDeg: number, distM: number, modes = ['rail']): Station {
  const R = 6_371_000;
  const d = distM / R;
  const b = (brgDeg * Math.PI) / 180;
  const lat1 = (START.lat * Math.PI) / 180;
  const lon1 = (START.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { id, name: id, lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI, modes };
}

describe('downwindEndpoints', () => {
  const stations: Station[] = [
    stationAt('dead', 45, 50_000), // dead downwind, on target
    stationAt('offarc', 70, 48_000), // 25° off downwind (< 35° arc), on target
    stationAt('cross', 120, 50_000), // 75° off downwind ⇒ crosswind, excluded
    stationAt('toofar', 45, 80_000), // downwind but > +20% band, excluded
    stationAt('toonear', 45, 30_000), // downwind but < −20% band, excluded
  ];

  it('keeps only stations in the distance band AND the downwind arc, dead-downwind first', () => {
    const eps = downwindEndpoints(START, stations, { targetM: 50_000, windToDeg: WIND_TO });
    expect(eps.map((e) => e.station.id)).toEqual(['dead', 'offarc']);
    expect(eps[0].offWindDeg).toBeLessThan(eps[1].offWindDeg);
    expect(eps[0].offWindDeg).toBeCloseTo(0, 0);
    expect(eps[0].distanceM).toBeCloseTo(50_000, -2); // ~50 km
  });

  it('respects a custom arc half-angle', () => {
    const eps = downwindEndpoints(START, stations, {
      targetM: 50_000,
      windToDeg: WIND_TO,
      arcDeg: 10, // now the 25°-off station drops out
    });
    expect(eps.map((e) => e.station.id)).toEqual(['dead']);
  });
});

// --- Minimal synthetic analysis for the time-share + ranking tests ---
function analysisWith(vParByS: Array<{ vParMs: number; timeS: number }>): CandidateAnalysis {
  const segments = vParByS.map(
    ({ vParMs, timeS }) => ({ wind: { vParMs }, timeS }) as unknown as SegmentAnalysis,
  );
  const totalTimeS = vParByS.reduce((s, x) => s + x.timeS, 0);
  return { segments, totalTimeS } as unknown as CandidateAnalysis;
}

describe('tailwindTimeShare', () => {
  it('is the time-weighted fraction of tailwind (v_par > 0)', () => {
    const a = analysisWith([
      { vParMs: 5, timeS: 300 }, // tailwind
      { vParMs: -5, timeS: 100 }, // headwind
    ]);
    expect(tailwindTimeShare(a)).toBeCloseTo(300 / 400, 6);
  });
  it('is 0 for a pure crosswind ride and guards empty rides', () => {
    expect(tailwindTimeShare(analysisWith([{ vParMs: 0, timeS: 500 }]))).toBe(0);
    expect(tailwindTimeShare(analysisWith([]))).toBe(0);
  });
});

describe('frequencyFactor', () => {
  it('decays with headway and is 0 when unknown/no service', () => {
    expect(frequencyFactor(30)).toBeCloseTo(60 / 90, 6);
    expect(frequencyFactor(60)).toBeCloseTo(0.5, 6);
    expect(frequencyFactor(10)).toBeGreaterThan(frequencyFactor(60));
    expect(frequencyFactor(null)).toBe(0);
    expect(frequencyFactor(0)).toBe(0);
  });
});

describe('rankDownwind', () => {
  it('a closer crosswind station loses to a farther pure-downwind one', () => {
    // Closer station: mostly crosswind ride (low tailwind share) but frequent trains.
    const closerCross = analysisWith([
      { vParMs: 0.2, timeS: 100 },
      { vParMs: -1, timeS: 300 },
    ]);
    // Farther station: strong tailwind the whole way, trains a bit less often.
    const fartherDownwind = analysisWith([{ vParMs: 6, timeS: 800 }]);

    const closerRank = rankDownwind(tailwindTimeShare(closerCross), frequencyFactor(15));
    const fartherRank = rankDownwind(tailwindTimeShare(fartherDownwind), frequencyFactor(30));

    expect(fartherRank).toBeGreaterThan(closerRank);
  });

  it('no return service (freq 0) sinks the rank to 0 regardless of tailwind', () => {
    expect(rankDownwind(1, frequencyFactor(null))).toBe(0);
  });
});
