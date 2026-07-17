/**
 * nav/offRoute.ts — off-route detection + rejoin-track reroute (WR-015, NAVIGATION_SPEC §3).
 *
 * The detail most nav apps get wrong: when the rider leaves the track, guide them back to the
 * CHOSEN route ~500 m downstream — never reroute to the finish. This module owns (a) the sustained-
 * off-route trigger and (b) a single pointToPoint reroute whose leg is spliced into the route with
 * everything downstream preserved. Reroute failures keep the alert up (bearing-to-track arrow) and
 * retry with backoff — guidance is never silently dropped.
 */
import type { CandidateRoute, LatLon } from '../domain';
import { bearingDeg, haversineM, spliceRoute } from '../engine/geometry';
import type { RouteProvider } from '../adapters/routing';
import { pointAtDistance, type Track } from './snap';

export const OFF_ROUTE_PERP_M = 45;
export const OFF_ROUTE_SUSTAIN_MS = 10_000;
export const REJOIN_AHEAD_M = 500;
export const REROUTE_BACKOFF_BASE_MS = 2_000;
export const REROUTE_BACKOFF_CAP_MS = 30_000;

export type OffRouteState = 'on-route' | 'off-pending' | 'alert';

/**
 * Sustained-off-route trigger. Feed the snap perpendicular distance + fix time each fix; it reports
 * 'alert' once perpendicular has exceeded the gate continuously for OFF_ROUTE_SUSTAIN_MS.
 */
export class OffRouteMonitor {
  private offSinceMs: number | null = null;

  update(perpendicularM: number, fixTimeMs: number): { state: OffRouteState; offForMs: number } {
    if (perpendicularM <= OFF_ROUTE_PERP_M) {
      this.offSinceMs = null;
      return { state: 'on-route', offForMs: 0 };
    }
    if (this.offSinceMs === null) this.offSinceMs = fixTimeMs;
    const offForMs = fixTimeMs - this.offSinceMs;
    return { state: offForMs >= OFF_ROUTE_SUSTAIN_MS ? 'alert' : 'off-pending', offForMs };
  }

  /** Clear the timer (call after a successful reroute so the new route starts on-route). */
  reset(): void {
    this.offSinceMs = null;
  }
}

/** Exponential backoff (ms) for reroute retry attempt N (1-based), capped. */
export function rerouteBackoffMs(attempt: number): number {
  return Math.min(REROUTE_BACKOFF_CAP_MS, REROUTE_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

/** Bearing + straight-line distance from the rider to the nearest point on the track (failed-state arrow). */
export function bearingToTrack(
  current: LatLon,
  snapped: LatLon,
): { bearingDeg: number; distanceM: number } {
  return { bearingDeg: bearingDeg(current, snapped), distanceM: haversineM(current, snapped) };
}

export type RerouteOutcome =
  | { ok: true; route: CandidateRoute; rejoinAtM: number }
  | { ok: false; error: unknown; nextRetryMs: number };

/**
 * Runs one rejoin reroute: pointToPoint(current → trackPointAt(progress + 500 m)), then splices the
 * returned leg into `route`. On provider failure returns ok:false with a backoff delay; the caller
 * stays in alert and retries. Attempt count is internal so backoff grows across consecutive failures
 * and resets on success.
 */
export class Rerouter {
  private attempts = 0;

  constructor(
    private readonly provider: RouteProvider,
    private readonly profile: string,
  ) {}

  get failedAttempts(): number {
    return this.attempts;
  }

  async attempt(
    current: LatLon,
    route: CandidateRoute,
    track: Track,
    progressM: number,
  ): Promise<RerouteOutcome> {
    const rejoinAtM = Math.min(track.total, progressM + REJOIN_AHEAD_M);
    const target = pointAtDistance(track, rejoinAtM);
    try {
      const leg = await this.provider.pointToPoint(current, target, this.profile);
      this.attempts = 0;
      return { ok: true, route: spliceRoute(route, rejoinAtM, leg), rejoinAtM };
    } catch (error) {
      this.attempts += 1;
      return { ok: false, error, nextRetryMs: rerouteBackoffMs(this.attempts) };
    }
  }
}
