/**
 * nav/snap.ts — windowed snap-to-track + monotonic progress (WR-013, NAVIGATION_SPEC §1-2).
 *
 * The window is the whole trick: search only [progress-100 m, progress+300 m] so self-crossing
 * loops and out-and-backs never teleport to the wrong branch. Global nearest is used ONCE at cold
 * start (and only latches on a fix inside the perpendicular gate). Cumulative distances are
 * precomputed and the in-window segment span is found by binary search, so each update is
 * O(window), not O(route). The projection is clamped to the in-window sub-segment, so even a long
 * segment cannot carry progress past +300 m in a single update (§2: search ONLY within the window).
 *
 * Outage recovery (F-003, DEC-058): the FORWARD bound widens with time since the last accepted fix
 * (bounded by a generous rider speed), so a GPS gap that carries the rider past +300 m no longer
 * strands progress forever. Re-latches beyond the classic window are gated: the candidate must sit
 * inside the perpendicular gate and agree across REACQ_CONFIRM_FIXES consecutive fixes before
 * progress commits — one glitchy far fix cannot teleport progress. The window stays anchored at
 * progress−100 m; a rider who moved BACKWARD past that during an outage is deliberately left to the
 * confirm-first off-route/reroute flow (§3).
 */
import type { LatLon } from '../domain';
import { haversineM, polylineLengthM } from '../engine/geometry';
import type { Fix } from './fixSource';

const M_PER_DEG_LAT = 111_320;

export const SNAP_WINDOW_BACK_M = 100;
export const SNAP_WINDOW_FWD_M = 300;
export const SNAP_PERP_GATE_M = 60;
export const SNAP_JITTER_TOLERANCE_M = 15;
/** Perp distances within this band of the minimum are a tie — geometry alone can't pick a branch. */
export const SNAP_TIE_BAND_M = 10;
/**
 * Two in-window candidates whose progress differs by more than this are different ARMS of the route
 * — the two directions of an out-and-back, or the two crossings of a figure-eight — rather than two
 * projections of the same neighbourhood (WR-054).
 *
 * Must stay comfortably above SNAP_TIE_BAND_M: on a straight stretch a candidate `d` metres behind
 * has a perpendicular distance of about `d`, so it can only look like a tie while `d` ≤ the tie band.
 * Anything beyond that is real geometry doubling back on itself. It must also stay well BELOW the
 * arm separation near an out-and-back's fold (~2× the distance still to ride to it), or the fold
 * itself would be left undefended — which is exactly where the turnaround cue lives.
 */
export const SNAP_ARM_SEPARATION_M = 25;
/** Generous rider speed bound (72 km/h): how fast the forward window may widen while lost. */
export const REACQ_SPEED_MS = 20;
/** Consecutive agreeing beyond-window candidates required before progress commits (DEC-058). */
export const REACQ_CONFIRM_FIXES = 3;
/** Widening cap: past this the extension is effectively "rest of the route". */
const REACQ_MAX_LOST_S = 900;

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

/** Distance (m) from a point to the point at fraction t on segment a->b, and that point. Local frame. */
function perpAt(p: LatLon, a: LatLon, b: LatLon, t: number): { perpM: number; point: LatLon } {
  const mLon = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lon - a.lon) * mLon;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (p.lon - a.lon) * mLon;
  const py = (p.lat - a.lat) * M_PER_DEG_LAT;
  return {
    perpM: Math.hypot(px - bx * t, py - by * t),
    point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t },
  };
}

/** Unclamped projection fraction of a point onto the infinite line through a->b (0 for a point). */
function projectionFraction(p: LatLon, a: LatLon, b: LatLon): number {
  const mLon = M_PER_DEG_LAT * Math.cos((a.lat * Math.PI) / 180);
  const bx = (b.lon - a.lon) * mLon;
  const by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const px = (p.lon - a.lon) * mLon;
  const py = (p.lat - a.lat) * M_PER_DEG_LAT;
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
 *
 * `preferProgressM` breaks TIES, the same way `nearestGlobalNear` does for the cold start: among
 * candidates within `SNAP_TIE_BAND_M` of the best perpendicular, the one whose progress is closest
 * to it wins. This matters on an out-and-back, where the outbound and return arms are the SAME
 * polyline for the entire route, so both arms are always equidistant and plain min-perp picks
 * between them on floating-point noise (WR-054): progress would leap to the mirrored position and
 * then freeze, because progress may only move forward. Omit it to keep plain min-perp.
 */
function nearestInWindow(
  track: Track,
  p: LatLon,
  lo: number,
  hi: number,
  preferProgressM?: number,
) {
  const { points, cum } = track;
  let best = { progressM: lo, perpM: Infinity, point: points[0] };
  for (let i = firstSegmentAtOrAfter(cum, lo); i < points.length - 1; i++) {
    if (cum[i] > hi) break; // sorted: no later segment is in-window
    const segLen = cum[i + 1] - cum[i];
    let t = projectionFraction(p, points[i], points[i + 1]);
    if (segLen > 0) {
      const tLo = Math.max(0, (lo - cum[i]) / segLen);
      const tHi = Math.min(1, (hi - cum[i]) / segLen);
      t = Math.max(tLo, Math.min(tHi, t));
    } else {
      t = 0;
    }
    const { perpM, point } = perpAt(p, points[i], points[i + 1], t);
    const progressM = cum[i] + t * segLen;
    // Two candidates that are equally close but FAR APART along the route are different arms of the
    // route, not two projections of the same neighbourhood: stay on the arm we are already on. The
    // separation test matters — without it, on a straight stretch every candidate a few metres
    // behind is also "within the tie band" (its perpendicular IS that along-track gap), and
    // preferring the nearest-to-current would drag progress backwards on every fix.
    const tie = Math.abs(perpM - best.perpM) <= SNAP_TIE_BAND_M;
    const differentArm = Math.abs(progressM - best.progressM) > SNAP_ARM_SEPARATION_M;
    if (tie && differentArm && preferProgressM !== undefined) {
      if (Math.abs(progressM - preferProgressM) < Math.abs(best.progressM - preferProgressM)) {
        best = { progressM, perpM, point };
      }
    } else if (perpM < best.perpM) {
      best = { progressM, perpM, point };
    }
  }
  return best;
}

/**
 * Global nearest with a deterministic tie-break: among candidates whose perpendicular distance is
 * within SNAP_TIE_BAND_M of the minimum, prefer the one whose progress is closest to
 * `targetProgressM`. On a closed loop the start and finish arms are geometrically identical, so
 * plain min-perp latches on first-fix jitter (F-004); the band makes the choice intentional.
 */
export function nearestGlobalNear(track: Track, p: LatLon, targetProgressM: number) {
  const min = nearestInWindow(track, p, 0, track.total);
  const { points, cum } = track;
  let best = min;
  let bestDist = Math.abs(min.progressM - targetProgressM);
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = cum[i + 1] - cum[i];
    const t =
      segLen > 0 ? Math.max(0, Math.min(1, projectionFraction(p, points[i], points[i + 1]))) : 0;
    const { perpM, point } = perpAt(p, points[i], points[i + 1], t);
    if (perpM > min.perpM + SNAP_TIE_BAND_M) continue;
    const progressM = cum[i] + t * segLen;
    const dist = Math.abs(progressM - targetProgressM);
    if (dist < bestDist) {
      best = { progressM, perpM, point };
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Progress seed for resuming a crash-interrupted ride: project the LAST recorded point onto the
 * track, disambiguating overlapping arms (out-and-back) with the recorded path length — the one
 * signal that still works for a stationary rider. Recorded length ≥ true progress (detours only
 * add), so ties resolve near the ridden distance rather than at 0 or total.
 */
export function estimateProgressFromPath(track: Track, path: LatLon[]): number {
  if (path.length === 0) return 0;
  const ridden = polylineLengthM(path);
  return nearestGlobalNear(track, path[path.length - 1], Math.min(ridden, track.total)).progressM;
}

/** Stateful snapper: feed fixes in order, get windowed progress. Cold start uses global nearest. */
export class Snapper {
  private readonly track: Track;
  private progressM: number | null = null;
  /** Timestamp of the last ACCEPTED fix (null until one accepts or when times are unparseable). */
  private lastAcceptedTMs: number | null = null;
  /** Consecutive fixes without an acceptance — the time fallback when fix times are garbage. */
  private unacceptedCount = 0;
  /** Pending beyond-window re-latch streak (F-003): last candidate, agreement count, its time. */
  private reacq: { progressM: number; count: number; tMs: number | null } | null = null;

  /**
   * `initialProgressM` seeds progress so the FIRST fix uses the windowed search around it instead of
   * a global nearest — used on ride start (0, F-004), reroute (0, the spliced leg's start) and
   * resume (estimateProgressFromPath), so a global cold-start can't mis-latch onto a far branch.
   */
  constructor(track: Track, initialProgressM: number | null = null) {
    this.track = track;
    this.progressM = initialProgressM;
  }

  update(fix: Fix): SnapResult {
    const { total } = this.track;
    const tMs = Date.parse(fix.time); // NaN on garbage — time-based logic falls back to fix counts
    if (this.progressM === null) {
      // Cold start: global nearest, once — but only latch on a fix inside the gate, else retry.
      // Ties (closed-loop start==finish arms) resolve toward the start (F-004).
      const g = nearestGlobalNear(this.track, fix, 0);
      const onTrack = g.perpM < SNAP_PERP_GATE_M;
      if (onTrack) {
        this.progressM = g.progressM;
        this.markAccepted(tMs);
      }
      return this.result(g.progressM, g.perpM, g.point, onTrack, onTrack);
    }
    const lo = Math.max(0, this.progressM - SNAP_WINDOW_BACK_M);
    const hi = Math.min(total, this.progressM + SNAP_WINDOW_FWD_M);
    // Tie-break toward where we already are: on an out-and-back both arms are always equidistant.
    const c = nearestInWindow(this.track, fix, lo, hi, this.progressM);
    const onTrack = c.perpM < SNAP_PERP_GATE_M;
    const accepted = onTrack && c.progressM >= this.progressM - SNAP_JITTER_TOLERANCE_M;
    if (accepted) {
      this.progressM = c.progressM; // advance (may dip <=15 m on jitter)
      this.markAccepted(tMs);
      return this.result(this.progressM, c.perpM, c.point, onTrack, accepted);
    }

    // Nothing acceptable in the classic window. Widen the FORWARD bound by how far the rider could
    // plausibly have travelled since the last accepted fix (F-003, DEC-058) and look for a gated
    // re-latch there. The returned result stays the classic-window one until a commit, so off-route
    // semantics (perp to the un-widened window) are unchanged while lost.
    this.unacceptedCount++;
    const extraM = Math.min(this.lostSeconds(tMs), REACQ_MAX_LOST_S) * REACQ_SPEED_MS;
    if (extraM > 0 && hi < total) {
      const w = nearestInWindow(this.track, fix, hi, Math.min(total, hi + extraM), this.progressM);
      if (w.perpM < SNAP_PERP_GATE_M) {
        if (this.confirmReacquire(w.progressM, tMs)) {
          this.progressM = w.progressM;
          this.markAccepted(tMs);
          return this.result(this.progressM, w.perpM, w.point, true, true);
        }
      } else {
        this.reacq = null; // streak must be consecutive — a gateless fix restarts it
      }
    }
    return this.result(this.progressM, c.perpM, c.point, onTrack, false);
  }

  /** An acceptance clears all lost-state: widening and any pending re-latch stop immediately. */
  private markAccepted(tMs: number): void {
    this.lastAcceptedTMs = Number.isFinite(tMs) ? tMs : null;
    this.unacceptedCount = 0;
    this.reacq = null;
  }

  /** Seconds "lost": time since the last accepted fix, or the unaccepted-fix count (~1 Hz) when
   *  timestamps are unusable — whichever is larger. 0 while fixes are being accepted. */
  private lostSeconds(tMs: number): number {
    const byTime =
      this.lastAcceptedTMs !== null && Number.isFinite(tMs)
        ? Math.max(0, (tMs - this.lastAcceptedTMs) / 1000)
        : 0;
    return Math.max(byTime, this.unacceptedCount);
  }

  /**
   * Track agreement of beyond-window candidates across consecutive fixes. A candidate extends the
   * streak only if it advances plausibly from the previous one (backward within jitter, forward
   * within rider speed × dt); anything else restarts the streak at this candidate. True on the
   * REACQ_CONFIRM_FIXES-th agreeing fix — the commit signal.
   */
  private confirmReacquire(progressM: number, tMs: number): boolean {
    const prev = this.reacq;
    const dtS =
      prev?.tMs != null && Number.isFinite(tMs)
        ? Math.min(Math.max((tMs - prev.tMs) / 1000, 0), 30)
        : 1;
    const consistent =
      prev !== null &&
      progressM >= prev.progressM - SNAP_JITTER_TOLERANCE_M &&
      progressM <= prev.progressM + dtS * REACQ_SPEED_MS + SNAP_JITTER_TOLERANCE_M;
    const count = consistent ? prev.count + 1 : 1;
    this.reacq = { progressM, count, tMs: Number.isFinite(tMs) ? tMs : null };
    if (count >= REACQ_CONFIRM_FIXES) {
      this.reacq = null;
      return true;
    }
    return false;
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
