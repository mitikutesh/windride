/**
 * nav/reroute.ts — confirmed reroute proposals (DEC-022 follow-up, reshaped by WR-051).
 *
 * Ties the WR-015 Rerouter to the RideController: on a sustained off-route, fetch a fresh leg back to
 * a rejoin point on the ORIGINAL route (~500 m downstream — everything beyond is preserved), splice
 * it, and RE-ANALYSE the spliced geometry for per-segment wind (so the ETA and wind HUD keep
 * working). Nothing is applied here: `proposeReroute` returns the analysed proposal for the Ride
 * screen to preview, and only an explicit rider Accept calls `controller.applyReroute` (WR-051 —
 * never silently swap the route under someone doing 30 km/h). Wind on a mid-ride detour is treated
 * as ~uniform (the app's spatial-uniform model), reconstructed from the original plan's analysis.
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

/** A fetched + re-analysed reroute awaiting the rider's Accept (WR-051). */
export interface RerouteProposal {
  /** Ready to hand to `RideController.applyReroute` if the rider accepts. */
  analysis: CandidateAnalysis;
  /** Where (along the ORIGINAL track) the proposed leg rejoins the planned route. */
  rejoinAtM: number;
}

export type ProposeOutcome =
  | { result: 'proposed'; proposal: RerouteProposal }
  | { result: 'near-finish' }
  | { result: 'failed'; nextRetryMs: number }
  | { result: 'skipped' };

/**
 * One rider-confirmed reroute request: ask the router for a leg back to the original route, splice +
 * re-analyse it, and return it as a PROPOSAL — the caller previews it and applies only on an explicit
 * Accept. `ref` is the ORIGINAL plan analysis (real forecast wind) — not the last spliced one — so
 * repeated reroutes don't compound wind-reconstruction error. Backoff bookkeeping on failure is the
 * Rerouter's job (its attempt counter drives outcome.nextRetryMs).
 */
export async function proposeReroute(
  rerouter: Rerouter,
  controller: RideController,
  ref: CandidateAnalysis,
  speed: SpeedSettings,
): Promise<ProposeOutcome> {
  const inputs = controller.rerouteInputs();
  if (!inputs) return { result: 'skipped' };
  const outcome = await rerouter.attempt(
    inputs.current,
    inputs.route,
    inputs.track,
    inputs.progressM,
  );
  if (outcome.ok) {
    return {
      result: 'proposed',
      proposal: {
        analysis: reanalyzeReroute(outcome.route, ref, speed),
        rejoinAtM: outcome.rejoinAtM,
      },
    };
  }
  if (outcome.reason === 'near-finish') return { result: 'near-finish' };
  return { result: 'failed', nextRetryMs: outcome.nextRetryMs };
}
