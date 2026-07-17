import { describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import { haversineM } from '../engine/geometry';
import type { CandidateAnalysis, SegmentAnalysis } from '../engine/scoring';
import type { GpxPoint } from '../utils/gpx';
import { observationsFromRide } from './rideCalibration';

// A straight eastbound route at lat 60: two ~300 m segments, one paved one gravel.
const LAT = 60;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const lonAt = (m: number): number => 24 + m / M_PER_DEG_LON;
const at = (m: number): LatLon => ({ lat: LAT, lon: lonAt(m) });

const SEG_M = 300;
const polyline: LatLon[] = [at(0), at(SEG_M), at(2 * SEG_M)];

function segAnalysis(
  a: LatLon,
  b: LatLon,
  surface: 'paved' | 'gravel',
  vParMs: number,
): SegmentAnalysis {
  return {
    seg: { a, b, lengthM: haversineM(a, b), bearingDeg: 90, gradePct: 0, surface, exposure: 1 },
    wind: { vParMs } as SegmentAnalysis['wind'],
    speedKmh: 0,
    timeS: 0,
    startS: 0,
    hourIndex: 0,
    precipProb: 0,
  };
}

const analysis: CandidateAnalysis = {
  candidate: { id: 'A', polyline, segments: [], distanceM: 2 * SEG_M, ascentM: 0 },
  segments: [
    segAnalysis(polyline[0], polyline[1], 'paved', 3), // tailwind
    segAnalysis(polyline[1], polyline[2], 'gravel', -3), // headwind
  ],
  totalTimeS: 0,
  distanceM: 2 * SEG_M,
  ascentM: 0,
  hasFerry: false,
};

const T0 = Date.parse('2026-07-17T10:00:00Z');

/** Ride the line 0→600 m, at `speed1` on segment 1 and `speed2` on segment 2 (m/s). */
function ride(speed1: number, speed2: number): GpxPoint[] {
  const pts: GpxPoint[] = [];
  let t = 0;
  for (let m = 0; m <= 2 * SEG_M; m += 30) {
    pts.push({ ...at(m), time: new Date(T0 + t * 1000).toISOString() });
    const speed = m < SEG_M ? speed1 : speed2; // speed used to reach the NEXT point
    t += 30 / speed;
  }
  return pts;
}

describe('observationsFromRide', () => {
  it('recovers per-segment observed speeds and planned conditions', () => {
    const obs = observationsFromRide(analysis, ride(30 / 3.6, 18 / 3.6)); // 30 and 18 km/h
    expect(obs).toHaveLength(2);

    const paved = obs.find((o) => o.surface === 'paved')!;
    const gravel = obs.find((o) => o.surface === 'gravel')!;
    expect(paved.observedSpeedKmh).toBeCloseTo(30, 0);
    expect(gravel.observedSpeedKmh).toBeCloseTo(18, 0);
    // Planned wind carried through as km/h (+ tail, − head).
    expect(paved.vParKmh).toBeCloseTo(3 * 3.6, 1);
    expect(gravel.vParKmh).toBeCloseTo(-3 * 3.6, 1);
    expect(paved.weightS).toBeGreaterThan(0);
  });

  it('returns nothing for a ride shorter than two points', () => {
    expect(observationsFromRide(analysis, [])).toEqual([]);
    expect(observationsFromRide(analysis, [{ ...at(0), time: '2026-07-17T10:00:00Z' }])).toEqual(
      [],
    );
  });

  it('ignores segments whose surface is not paved or gravel', () => {
    const pathAnalysis: CandidateAnalysis = {
      ...analysis,
      segments: [
        segAnalysis(polyline[0], polyline[1], 'paved', 0),
        {
          ...segAnalysis(polyline[1], polyline[2], 'gravel', 0),
          seg: { ...analysis.segments[1].seg, surface: 'path' },
        },
      ],
    };
    const obs = observationsFromRide(pathAnalysis, ride(25 / 3.6, 25 / 3.6));
    expect(obs.every((o) => o.surface === 'paved')).toBe(true);
  });

  it('excludes stopped time so a red light does not drag the observed speed down', () => {
    // Ride segment 1 at 30 km/h with a 120 s stop partway; segment 2 at 30 km/h throughout.
    const pts: GpxPoint[] = [];
    let t = 0;
    for (let m = 0; m <= 2 * SEG_M; m += 30) {
      pts.push({ ...at(m), time: new Date(T0 + t * 1000).toISOString() });
      t += 30 / (30 / 3.6); // 30 km/h to the next point
      if (m === 150) {
        // Stationary for 120 s (8 fixes at the same spot) — must not count toward speed.
        for (let k = 0; k < 8; k++) {
          pts.push({ ...at(150), time: new Date(T0 + (t + k * 15) * 1000).toISOString() });
        }
        t += 8 * 15;
      }
    }
    const paved = observationsFromRide(analysis, pts).find((o) => o.surface === 'paved')!;
    // With the 120 s stop counted, paved speed would collapse to ~7 km/h and weightS would exceed
    // 160 s; the gate keeps observed speed in the riding range and weight to the moving portion.
    expect(paved.observedSpeedKmh).toBeGreaterThan(20);
    expect(paved.weightS).toBeLessThan(90);
  });
});
