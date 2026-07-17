/**
 * nav/snap.ts — windowed snap-to-track + monotonic progress (WR-013, NAVIGATION_SPEC §1-2).
 *
 * The window is the whole trick: search only [progress-100 m, progress+300 m] so self-crossing
 * loops and out-and-backs never teleport to the wrong branch. Global nearest is used ONCE at cold
 * start (and only latches on a fix inside the perpendicular gate). Cumulative distances are
 * precomputed and the in-window segment span is found by binary search, so each update is
 * O(window), not O(route). The projection is clamped to the in-window sub-segment, so even a long
 * segment cannot carry progress past +300 m in a single update (§2: search ONLY within the window).
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
  if (polyline.length < 2) throw new Error('prepareTrack needs at least 2 points');
  const cum = [0];
  for (let i = 1; i < polyline.length; i++)
    cum.push(cum[i - 1] + haversineM(polyline[i - 1], polyline[i]));
  return { points: polyline, cum, total: cum[cum.length - 1] };
}

/** Interpolated point at distance `m` along the track (clamped to the ends). WR-015 rejoin target. */
export function pointAtDistance(track: Track, m: number): LatLon {
  const { points, cum, total } = track;
  const d = Math.max(0, Math.min(total, m));
  if (d <= 0) return points[0];
  if (d >= total) return points[points.length - 1];
  let i = 0;
  while (i < cum.length - 1 && cum[i + 1] < d) i++;
  const span = cum[i + 1] - cum[i] || 1;
  const t = (d - cum[i]) / span;
  return {
    lat: points[i].lat + (points[i + 1].lat - points[i].lat) * t,
    lon: points[i].lon + (points[i + 1].lon - points[i].lon) * t,
  };
}

export interface SnapResult {
  progressM: number;
  remainingM: number;
  perpendicularM: number;
  snapped: LatLon;
  /** Within the perpendicular gate — i.e. laterally on the route (WR-015 consumes this). */
  onTrack: boolean;
  /** This fix advanced progress (on-track AND not a >tolerance backward jump). */
  accepted: boolean;
}

/** Distance (m) from fix to the point at fraction t on segment a->b, and that point. Local frame. */
function perpAt(fix: Fix, a: LatLon, b: LatLon, t: number): { perpM: number; point: LatLon } {
  const mLon = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lon - a.lon) * mLon;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (fix.lon - a.lon) * mLon;
  const py = (fix.lat - a.lat) * M_PER_DEG_LAT;
  return {
    perpM: Math.hypot(px - bx * t, py - by * t),
    point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t },
  };
}

/** Unclamped projection fraction of fix onto the infinite line through a->b (0 for a point). */
function projectionFraction(fix: Fix, a: LatLon, b: LatLon): number {
  const mLon = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lon - a.lon) * mLon;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (fix.lon - a.lon) * mLon;
  const py = (fix.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  return len2 === 0 ? 0 : (px * bx + py * by) / len2;
}

/** First segment index whose end (cum[i+1]) is >= lo, via binary search over cumulative distances. */
function firstSegmentAtOrAfter(cum: number[], lo: number): number {
  let a = 0;
  let b = cum.length - 1;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (cum[mid] < lo) a = mid + 1;
    else b = mid;
  }
  return Math.max(0, a - 1); // segment (a-1) ends at cum[a] >= lo
}

/**
 * Nearest point on the polyline within the distance window [lo, hi]. Scans only in-window segments
 * and clamps each projection to the portion of the segment inside the window, so progress can never
 * jump past `hi`. Returns the best (minimum perpendicular) candidate.
 */
function nearestInWindow(track: Track, fix: Fix, lo: number, hi: number) {
  const { points, cum } = track;
  let best = { progressM: lo, perpM: Infinity, point: points[0] };
  for (let i = firstSegmentAtOrAfter(cum, lo); i < points.length - 1; i++) {
    if (cum[i] > hi) break; // sorted: no later segment is in-window
    const segLen = cum[i + 1] - cum[i];
    let t = projectionFraction(fix, points[i], points[i + 1]);
    if (segLen > 0) {
      const tLo = Math.max(0, (lo - cum[i]) / segLen);
      const tHi = Math.min(1, (hi - cum[i]) / segLen);
      t = Math.max(tLo, Math.min(tHi, t));
    } else {
      t = 0;
    }
    const { perpM, point } = perpAt(fix, points[i], points[i + 1], t);
    if (perpM < best.perpM) best = { progressM: cum[i] + t * segLen, perpM, point };
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
      // Cold start: global nearest, once — but only latch on a fix inside the gate, else retry.
      const g = nearestInWindow(this.track, fix, 0, total);
      const onTrack = g.perpM < SNAP_PERP_GATE_M;
      if (onTrack) this.progressM = g.progressM;
      return this.result(g.progressM, g.perpM, g.point, onTrack, onTrack);
    }
    const lo = Math.max(0, this.progressM - SNAP_WINDOW_BACK_M);
    const hi = Math.min(total, this.progressM + SNAP_WINDOW_FWD_M);
    const c = nearestInWindow(this.track, fix, lo, hi);
    const onTrack = c.perpM < SNAP_PERP_GATE_M;
    const accepted = onTrack && c.progressM >= this.progressM - SNAP_JITTER_TOLERANCE_M;
    if (accepted) this.progressM = c.progressM; // advance (may dip <=15 m on jitter)
    return this.result(this.progressM, c.perpM, c.point, onTrack, accepted);
  }

  private result(
    progressM: number,
    perpM: number,
    snapped: LatLon,
    onTrack: boolean,
    accepted: boolean,
  ): SnapResult {
    return {
      progressM,
      remainingM: Math.max(0, this.track.total - progressM),
      perpendicularM: perpM,
      snapped,
      onTrack,
      accepted,
    };
  }
}
