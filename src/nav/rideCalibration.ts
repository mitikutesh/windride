/**
 * nav/rideCalibration.ts — turn a recorded ride into speed-model observations (WR-024).
 *
 * Snaps each recorded fix onto the planned route (same windowed Snapper navigation uses, so
 * self-crossing loops don't teleport), accumulates the ALONG-TRACK distance and MOVING time spent
 * on each planned segment, and emits one {@link RideObservation} per paved/gravel segment that saw
 * motion. Distance is the snapped progress delta (not raw GPS haversine, which lateral jitter always
 * inflates), and stopped time is excluded with the same MOVING_SPEED_MS gate rideSummary uses — so
 * the observed speeds and their weights are on the SAME moving-time clock as summary.movingS, the
 * ETA target. The planned per-segment wind (v_par) and grade come from the analysis — they aren't
 * recoverable from the GPX alone, which is why calibration is captured at finish.
 */
import { DEFAULT_SPEED_SETTINGS } from '../engine/speedModel';
import type { RideObservation } from '../engine/calibration';
import type { CandidateAnalysis } from '../engine/scoring';
import type { GpxPoint } from '../utils/gpx';
import { MOVING_SPEED_MS } from './rideSummary';
import { prepareTrack, Snapper } from './snap';

const tMs = (p: GpxPoint): number => (p.time ? Date.parse(p.time) : NaN);

export function observationsFromRide(
  analysis: CandidateAnalysis,
  points: GpxPoint[],
): RideObservation[] {
  if (points.length < 2 || analysis.segments.length === 0) return [];

  const track = prepareTrack(analysis.candidate.polyline);
  const snapper = new Snapper(track);

  const segStart: number[] = [];
  let acc = 0;
  for (const sa of analysis.segments) {
    segStart.push(acc);
    acc += sa.seg.lengthM;
  }
  const segIndexAt = (progressM: number): number => {
    let idx = 0;
    for (let i = 0; i < segStart.length; i++) {
      if (segStart[i] <= progressM) idx = i;
      else break;
    }
    return idx;
  };

  const accum = analysis.segments.map(() => ({ distM: 0, timeS: 0 }));
  let prev = snapper.update({ ...points[0], time: points[0].time ?? '' });
  for (let i = 1; i < points.length; i++) {
    const cur = snapper.update({ ...points[i], time: points[i].time ?? '' });
    const dt = (tMs(points[i]) - tMs(points[i - 1])) / 1000;
    const along = cur.progressM - prev.progressM; // along-track metres this interval
    // Count only forward, on-route motion above the stopped threshold — off-route detours aren't
    // this segment, and stopped/creeping time must not drag the observed speed down (it's excluded
    // from summary.movingS too).
    if (dt > 0 && prev.onTrack && cur.onTrack && along > 0 && along / dt >= MOVING_SPEED_MS) {
      const idx = segIndexAt((prev.progressM + cur.progressM) / 2);
      accum[idx].distM += along;
      accum[idx].timeS += dt;
    }
    prev = cur;
  }

  const obs: RideObservation[] = [];
  analysis.segments.forEach((sa, i) => {
    const { distM, timeS } = accum[i];
    const surface = sa.seg.surface;
    // The linear model calibrates only paved/gravel base speeds (path/unknown are left at defaults).
    if (timeS <= 0 || distM <= 0 || (surface !== 'paved' && surface !== 'gravel')) return;
    // Sanity clamp: a residual GPS spike can't push an observed speed past the model ceiling.
    const observedSpeedKmh = Math.min((distM / timeS) * 3.6, DEFAULT_SPEED_SETTINGS.maxKmh);
    obs.push({
      surface,
      vParKmh: sa.wind.vParMs * 3.6,
      gradePct: sa.seg.gradePct,
      observedSpeedKmh,
      weightS: timeS,
    });
  });
  return obs;
}
