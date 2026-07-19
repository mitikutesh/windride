/**
 * nav/reroute.ts — live auto-reroute wiring (DEC-022 follow-up).
 *
 * Ties the WR-015 Rerouter to the RideController: on a sustained off-route, fetch a fresh leg back to
 * a rejoin point, splice it, RE-ANALYSE the spliced geometry for per-segment wind (so the ETA and
 * wind HUD keep working), and swap it into the ride. Wind on a mid-ride detour is treated as ~uniform
 * (the app's spatial-uniform model), reconstructed from the original plan's analysis.
 */
import type { CandidateRoute, WindSample } from '../domain';
import { analyzeCandidate, type CandidateAnalysis } from '../engine/scoring';
import type { SpeedSettings } from '../engine/speedModel';
import type { Rerouter } from './offRoute';
import type { RideController } from './rideController';

/** A representative wind sample rebuilt from an analysis (ride wind is ~uniform). Pure. */
export function referenceWind(ref: CandidateAnalysis): WindSample {
  if (ref.segments.length === 0) {
    return { windMs: 0, windFromDeg: 0, gustMs: 0, precipProb: 0, tempC: 0, time: '' };
  }
  // Use the LEAST-sheltered segment: windMs = effectiveMs/exposure recovers the raw wind most
  // reliably there (a fully-sheltered segment[0] with exposure 0 would otherwise read as calm).
  const s = ref.segments.reduce((best, sa) => (sa.seg.exposure > best.seg.exposure ? sa : best));
  const exposure = s.seg.exposure || 1;
  return {
    windMs: s.wind.effectiveMs / exposure, // undo the exposure scaling applied at analysis time
    windFromDeg: (((s.wind.windToDeg + 180) % 360) + 360) % 360, // wind_to → wind_from
    gustMs: s.wind.gustEffMs / exposure,
    precipProb: s.precipProb,
    tempC: 0, // not preserved in an analysis; unused by wind scoring
    time: '',
  };
}

/** Re-analyse a spliced (geometry-only) reroute for wind, reusing the ride's ~uniform wind. Pure. */
export function reanalyzeReroute(
  route: CandidateRoute,
  ref: CandidateAnalysis,
  speed: SpeedSettings,
): CandidateAnalysis {
  const wind = referenceWind(ref);
  const windBySegment = route.segments.map(() => [wind]);
  return analyzeCandidate(route, windBySegment, { targetDistanceM: route.distanceM, speed });
}

export type RerouteResult = 'rerouted' | 'near-finish' | 'failed' | 'skipped';

/**
 * One reroute attempt: ask the router for a rejoin leg, re-analyse it, and apply it to the live ride.
 * `ref` is the ORIGINAL plan analysis (real forecast wind) — not the last spliced one — so repeated
 * reroutes don't compound wind-reconstruction error. Backoff on failure is the Rerouter's job
 * (its attempt counter drives outcome.nextRetryMs).
 */
export async function attemptReroute(
  rerouter: Rerouter,
  controller: RideController,
  ref: CandidateAnalysis,
  speed: SpeedSettings,
  /** Re-checked when the leg resolves — skip applying if the ride paused/ended mid-fetch. */
  canApply?: () => boolean,
): Promise<{ result: RerouteResult; nextRetryMs?: number }> {
  const inputs = controller.rerouteInputs();
  if (!inputs) return { result: 'skipped' };
  const outcome = await rerouter.attempt(
    inputs.current,
    inputs.route,
    inputs.track,
    inputs.progressM,
  );
  if (outcome.ok) {
    if (canApply && !canApply()) return { result: 'skipped' }; // ride paused/ended while loading
    controller.applyReroute(reanalyzeReroute(outcome.route, ref, speed));
    return { result: 'rerouted' };
  }
  if (outcome.reason === 'near-finish') return { result: 'near-finish' };
  return { result: 'failed', nextRetryMs: outcome.nextRetryMs };
}
