/**
 * nav/rideSummary.ts — pure ride stats from recorded points (WR-017, NAVIGATION_SPEC §6).
 *
 * Distance, elapsed vs moving time, average speed, and — when the planned route is linked — the
 * time spent in each wind relationship (matched to planned segments by snapped progress) and the
 * headwind avoided vs the plan session's median candidate.
 */
import type { RideSummary } from '../domain';
import type { CandidateAnalysis } from '../engine/scoring';
import { haversineM } from '../engine/geometry';
import { classifyWindKind } from '../engine/wind';
import type { GpxPoint } from '../utils/gpx';
import { prepareTrack, Snapper } from './snap';

/** Below this ground speed the rider is stopped (NAVIGATION_SPEC §6: < 1.2 km/h). */
export const MOVING_SPEED_MS = 1.2 / 3.6;
/** Sub-threshold for longer than this ⇒ auto-paused. */
export const AUTO_PAUSE_S = 20;

export interface RideSummaryOptions {
  /** The planned route's analysis, for per-segment wind kind (matched by progress). */
  analysis?: CandidateAnalysis;
  /** Median headwind-km across the plan session's candidates. */
  medianHeadwindKm?: number;
  /** The ridden (chosen) route's headwind-km. */
  chosenHeadwindKm?: number;
}

const tMs = (p: GpxPoint): number => (p.time ? Date.parse(p.time) : NaN);

export function summarizeRide(points: GpxPoint[], opts: RideSummaryOptions = {}): RideSummary {
  let distanceM = 0;
  let movingS = 0;
  for (let i = 1; i < points.length; i++) {
    const d = haversineM(points[i - 1], points[i]);
    distanceM += d;
    const dt = (tMs(points[i]) - tMs(points[i - 1])) / 1000;
    if (dt > 0 && d / dt >= MOVING_SPEED_MS) movingS += dt;
  }
  const first = tMs(points[0]);
  const last = tMs(points[points.length - 1]);
  const elapsedS =
    Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, (last - first) / 1000) : 0;
  const avgSpeedMs = movingS > 0 ? distanceM / movingS : 0;

  const summary: RideSummary = { distanceM, elapsedS, movingS, avgSpeedMs };

  if (opts.analysis && points.length > 1) {
    summary.windByKindS = windByKind(points, opts.analysis);
  }
  if (opts.medianHeadwindKm !== undefined && opts.chosenHeadwindKm !== undefined) {
    summary.headwindAvoidedKm = opts.medianHeadwindKm - opts.chosenHeadwindKm;
  }
  return summary;
}

/** Seconds spent in each wind kind, snapping each point onto the planned route. */
function windByKind(
  points: GpxPoint[],
  analysis: CandidateAnalysis,
): {
  tail: number;
  cross: number;
  head: number;
} {
  const track = prepareTrack(analysis.candidate.polyline);
  const snapper = new Snapper(track);
  const segStart: number[] = [];
  let acc = 0;
  for (const sa of analysis.segments) {
    segStart.push(acc);
    acc += sa.seg.lengthM;
  }
  const kindAt = (progressM: number) => {
    let idx = 0;
    for (let i = 0; i < segStart.length; i++) {
      if (segStart[i] <= progressM) idx = i;
      else break;
    }
    const sa = analysis.segments[idx];
    return sa ? classifyWindKind(sa.wind.deltaDeg) : 'cross';
  };

  const out = { tail: 0, cross: 0, head: 0 };
  let prevProgress = snapper.update({ ...points[0], time: points[0].time ?? '' }).progressM;
  for (let i = 1; i < points.length; i++) {
    const progress = snapper.update({ ...points[i], time: points[i].time ?? '' }).progressM;
    const dt = (tMs(points[i]) - tMs(points[i - 1])) / 1000;
    if (dt > 0) out[kindAt((prevProgress + progress) / 2)] += dt;
    prevProgress = progress;
  }
  return out;
}

/** True if the ride is currently auto-paused: the trailing sub-threshold stretch exceeds 20 s. */
export function autoPaused(points: GpxPoint[]): boolean {
  let stoppedS = 0;
  for (let i = points.length - 1; i >= 1; i--) {
    const dt = (tMs(points[i]) - tMs(points[i - 1])) / 1000;
    if (dt <= 0) continue;
    const speed = haversineM(points[i - 1], points[i]) / dt;
    if (speed >= MOVING_SPEED_MS) break; // moving again — not paused
    stoppedS += dt;
    if (stoppedS > AUTO_PAUSE_S) return true;
  }
  return false;
}
