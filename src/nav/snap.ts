/**
 * nav/snap.ts — windowed snap-to-track + monotonic progress (WR-013, NAVIGATION_SPEC §1-2).
 *
 * The window is the whole trick: search only [progress-100 m, progress+300 m] so self-crossing
 * loops and out-and-backs never teleport to the wrong branch. Global nearest is used ONCE at cold
 * start. Cumulative distances are precomputed so each update is O(window), not O(route).
 */
import type { LatLon } from '../domain';
import { haversineM } from '../engine/geometry';
import type { Fix } from './fixSource';

const M_PER_DEG_LAT = 111_320;

export const SNAP_WINDOW_BACK_M = 100;
export const SNAP_WINDOW_FWD_M = 300;
export const SNAP_PERP_GATE_M = 60;
export const SNAP_JITTER_TOLERANCE_M = 15;

export interface Track {
  points: LatLon[];
  /** Cumulative distance to each point (metres). */
  cum: number[];
  total: number;
}

export function prepareTrack(polyline: LatLon[]): Track {
  const cum = [0];
  for (let i = 1; i < polyline.length; i++)
    cum.push(cum[i - 1] + haversineM(polyline[i - 1], polyline[i]));
  return { points: polyline, cum, total: cum[cum.length - 1] ?? 0 };
}

export interface SnapResult {
  progressM: number;
  remainingM: number;
  perpendicularM: number;
  snapped: LatLon;
  onTrack: boolean;
}

/** Project a fix onto segment a->b in local metres; returns fraction t, perpendicular m, point. */
function projectOntoSegment(
  fix: Fix,
  a: LatLon,
  b: LatLon,
): { t: number; perpM: number; point: LatLon } {
  const mLon = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lon - a.lon) * mLon;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (fix.lon - a.lon) * mLon;
  const py = (fix.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by || 1;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  const perpM = Math.hypot(px - bx * t, py - by * t);
  return {
    t,
    perpM,
    point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t },
  };
}

/** Nearest point on the polyline within a distance window [lo, hi]; scans only in-window segments. */
function nearestInWindow(track: Track, fix: Fix, lo: number, hi: number) {
  const { points, cum } = track;
  let best = { progressM: lo, perpM: Infinity, point: points[0] ?? { lat: 0, lon: 0 } };
  for (let i = 0; i < points.length - 1; i++) {
    if (cum[i + 1] < lo || cum[i] > hi) continue; // segment outside the window
    const { t, perpM, point } = projectOntoSegment(fix, points[i], points[i + 1]);
    if (perpM < best.perpM) {
      best = { progressM: cum[i] + t * (cum[i + 1] - cum[i]), perpM, point };
    }
  }
  return best;
}

/** Stateful snapper: feed fixes in order, get windowed progress. Cold start uses global nearest. */
export class Snapper {
  private readonly track: Track;
  private progressM: number | null = null;

  constructor(track: Track) {
    this.track = track;
  }

  update(fix: Fix): SnapResult {
    const { total } = this.track;
    if (this.progressM === null) {
      // Cold start: global nearest, once.
      const g = nearestInWindow(this.track, fix, 0, total);
      this.progressM = g.progressM;
      return this.result(g.progressM, g.perpM, g.point, g.perpM < SNAP_PERP_GATE_M);
    }
    const lo = Math.max(0, this.progressM - SNAP_WINDOW_BACK_M);
    const hi = Math.min(total, this.progressM + SNAP_WINDOW_FWD_M);
    const c = nearestInWindow(this.track, fix, lo, hi);
    const forwardOk = c.progressM >= this.progressM - SNAP_JITTER_TOLERANCE_M;
    const onTrack = c.perpM < SNAP_PERP_GATE_M && forwardOk;
    if (onTrack) this.progressM = c.progressM; // advance (may dip <=15 m on jitter)
    return this.result(this.progressM, c.perpM, c.point, onTrack);
  }

  private result(progressM: number, perpM: number, snapped: LatLon, onTrack: boolean): SnapResult {
    return {
      progressM,
      remainingM: Math.max(0, this.track.total - progressM),
      perpendicularM: perpM,
      snapped,
      onTrack,
    };
  }
}
