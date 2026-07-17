import { beforeEach, describe, expect, it } from 'vitest';
import type { LatLon } from '../domain';
import { haversineM } from '../engine/geometry';
import type { CandidateAnalysis, SegmentAnalysis } from '../engine/scoring';
import { DEFAULT_SPEED_SETTINGS } from '../engine/speedModel';
import type { GpxPoint } from '../utils/gpx';
import { activeSpeedSettings, ENOUGH_RIDES, useCalibrationStore } from './calibrationStore';

const LAT = 60;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const at = (m: number): LatLon => ({ lat: LAT, lon: 24 + m / M_PER_DEG_LON });
const SEG_M = 300;
const polyline = [at(0), at(SEG_M), at(2 * SEG_M)];

const seg = (
  a: LatLon,
  b: LatLon,
  surface: 'paved' | 'gravel',
  vParMs: number,
): SegmentAnalysis => ({
  seg: { a, b, lengthM: haversineM(a, b), bearingDeg: 90, gradePct: 0, surface, exposure: 1 },
  wind: { vParMs } as SegmentAnalysis['wind'],
  speedKmh: 0,
  timeS: 0,
  startS: 0,
  hourIndex: 0,
  precipProb: 0,
});

const analysis: CandidateAnalysis = {
  candidate: { id: 'A', polyline, segments: [], distanceM: 2 * SEG_M, ascentM: 0 },
  segments: [
    seg(polyline[0], polyline[1], 'paved', 3),
    seg(polyline[1], polyline[2], 'gravel', -3),
  ],
  totalTimeS: 90,
  distanceM: 2 * SEG_M,
  ascentM: 0,
  hasFerry: false,
};

const T0 = Date.parse('2026-07-17T10:00:00Z');
function ride(): GpxPoint[] {
  const pts: GpxPoint[] = [];
  let t = 0;
  for (let m = 0; m <= 2 * SEG_M; m += 30) {
    pts.push({ ...at(m), time: new Date(T0 + t * 1000).toISOString() });
    t += 30 / (m < SEG_M ? 30 / 3.6 : 18 / 3.6);
  }
  return pts;
}

describe('calibrationStore', () => {
  beforeEach(() => useCalibrationStore.getState().resetData());

  it('accumulates rides and only proposes a fit after ENOUGH_RIDES', () => {
    const s = useCalibrationStore.getState();
    for (let i = 0; i < ENOUGH_RIDES - 1; i++) s.recordRide(analysis, ride());
    expect(useCalibrationStore.getState().rideCount).toBe(ENOUGH_RIDES - 1);
    expect(useCalibrationStore.getState().proposal()).toBeNull();

    s.recordRide(analysis, ride());
    const proposal = useCalibrationStore.getState().proposal();
    expect(proposal).not.toBeNull();
    expect(Number.isFinite(proposal!.beforeErrorPct)).toBe(true);
    expect(Number.isFinite(proposal!.afterErrorPct)).toBe(true);
    expect(useCalibrationStore.getState().etaErrors).toHaveLength(ENOUGH_RIDES);
    // Per-ride error is coverage-robust (scored over what was ridden), so it stays sane.
    expect(useCalibrationStore.getState().etaErrors.every((e) => e >= 0 && e < 100)).toBe(true);
  });

  it('does not count a ride that produced no on-route paved/gravel observations', () => {
    useCalibrationStore.getState().recordRide(analysis, []);
    expect(useCalibrationStore.getState().rideCount).toBe(0);
  });

  it('ignores a corrupt persisted model (non-finite params) and falls back to the default', () => {
    // Simulate a corrupt hydrated `applied` reaching the store.
    useCalibrationStore.setState({
      applied: { v0Paved: NaN, v0Gravel: 20, kTail: 0.3, kHead: 0.6 },
    });
    expect(activeSpeedSettings().baseKmh.paved).toBe(DEFAULT_SPEED_SETTINGS.baseKmh.paved);
  });

  it('applies a model explicitly and reverts to the default', () => {
    expect(activeSpeedSettings().baseKmh.paved).toBe(DEFAULT_SPEED_SETTINGS.baseKmh.paved);

    useCalibrationStore.getState().apply({ v0Paved: 40, v0Gravel: 33, kTail: 0.4, kHead: 0.7 });
    expect(activeSpeedSettings().baseKmh.paved).toBe(40);
    expect(activeSpeedSettings().tailCoef).toBe(0.4);

    useCalibrationStore.getState().clearApplied();
    expect(activeSpeedSettings().baseKmh.paved).toBe(DEFAULT_SPEED_SETTINGS.baseKmh.paved);
  });

  it('resetData clears everything', () => {
    const s = useCalibrationStore.getState();
    s.recordRide(analysis, ride());
    s.apply({ v0Paved: 40, v0Gravel: 33, kTail: 0.4, kHead: 0.7 });
    s.resetData();
    const after = useCalibrationStore.getState();
    expect(after.rideCount).toBe(0);
    expect(after.buckets).toEqual([]);
    expect(after.applied).toBeNull();
  });
});
