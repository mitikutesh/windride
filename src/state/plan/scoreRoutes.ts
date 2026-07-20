// state/plan/scoreRoutes.ts — score a set of ALREADY-BUILT candidate routes the same way the main
// plan does (WR-047). Mirrors the exposure-fill + weather + scoreCandidates block of runPlan so any
// candidates (e.g. AI-discovered ones) are ranked by the identical wind/shelter/safety engine — the
// engine stays the single source of truth (DEC-043). Kept separate from runPlan (which also builds
// the start-time matrix, conditions, and winter caution from the same fetch) to avoid a double
// weather fetch there; a future refactor could unify the two.
import type { CandidateRoute } from '../../domain';
import type { Providers } from '../../adapters/registry';
import { exposureAt, loadExposureGrid, type DecodedGrid } from '../../data/exposureGrid';
import { resample, segmentMidpoint } from '../../engine/geometry';
import {
  DEFAULT_WEIGHTS,
  scoreCandidates,
  type RejectedCandidate,
  type ScoredCandidate,
  type ScoringWeights,
} from '../../engine/scoring';
import {
  iceRisk,
  iceRiskMessage,
  precipType,
  shadedKm,
  winterSpeedSettings,
} from '../../engine/winter';
import { activeSpeedSettings } from '../calibrationStore';
import { activeRiddenEdges } from '../noveltyStore';
import type { PlanInputs, WinterInfo } from './runPlan';

export interface ScoreRoutesResult {
  ranked: ScoredCandidate[];
  rejected: RejectedCandidate[];
  shelterDataAvailable: boolean;
  /** Winter ice-risk caution (WR-027), same as a normal plan — null when winter mode is off. */
  winter: WinterInfo | null;
}

export interface ScoreRoutesOpts {
  now: number;
  /** Injectable shelter-grid loader (tests supply null/synthetic; default loads the asset). */
  loadGrid?: () => Promise<DecodedGrid | null>;
}

function forecastHours(distanceKm: number): number {
  return Math.max(6, Math.min(24, Math.ceil(distanceKm / 12) + 2));
}

export async function scoreBuiltRoutes(
  providers: Providers,
  inputs: PlanInputs,
  candidates: CandidateRoute[],
  opts: ScoreRoutesOpts,
): Promise<ScoreRoutesResult> {
  const lengthM = inputs.distanceKm * 1000;
  // Ensure segmentation (mock/geometry-only routes come as bare polylines); ORS routes already are.
  const segmented = candidates.map((c) =>
    c.segments.length > 0 ? c : { ...c, segments: resample({ polyline: c.polyline }) },
  );

  const grid = await (opts.loadGrid ?? loadExposureGrid)();
  let shelterDataAvailable = false;
  for (const c of segmented) {
    for (const s of c.segments) {
      const mid = segmentMidpoint(s);
      const { factor, inRegion } = exposureAt(grid, mid.lat, mid.lon);
      s.exposure = factor;
      if (inRegion) shelterDataAvailable = true;
    }
  }

  const hours = forecastHours(inputs.distanceKm);
  const hourly = (await providers.weather.windAlong([inputs.start], hours))[0] ?? [];
  const daylight = await providers.weather.daylight(inputs.start);

  const departureHour = inputs.departureHour ?? 0;
  const winterActive = !!inputs.winter;
  const homeBeforeDark = inputs.homeBeforeDark || winterActive;
  const speed = winterActive ? winterSpeedSettings(activeSpeedSettings()) : activeSpeedSettings();
  const minutesUntilSunset = homeBeforeDark
    ? (Date.parse(daylight.sunset) - opts.now) / 60000 - departureHour * 60
    : undefined;
  const weights: ScoringWeights = inputs.avoidBusy
    ? { ...DEFAULT_WEIGHTS, traffic: DEFAULT_WEIGHTS.traffic * 2 }
    : DEFAULT_WEIGHTS;

  const windInputs = segmented.map((candidate) => ({
    candidate,
    windBySegment: candidate.segments.map(() => hourly),
  }));
  const { ranked, rejected } = scoreCandidates(windInputs, {
    targetDistanceM: lengthM,
    prefersSurface: inputs.surface === 'gravel' ? 'gravel' : 'paved',
    weights,
    hasShelterData: shelterDataAvailable,
    speed,
    riddenEdges: activeRiddenEdges(),
    homeBeforeDark,
    minutesUntilSunset,
    startHourIndex: departureHour,
  });

  // Ice-risk caution (WR-027) — same computation as runPlan, so it never vanishes on discovered
  // routes just because a different button was pressed (a safety-adjacent advisory must not).
  let winter: WinterInfo | null = null;
  if (winterActive) {
    const current = hourly[0];
    const minTempC = hourly.length
      ? Math.min(...hourly.map((s) => s.tempC))
      : (current?.tempC ?? 0);
    const precipPrior24hMm = (await providers.weather.recentPrecipMm?.(inputs.start, 24)) ?? 0;
    const risk = iceRisk({ minTempC, precipPrior24hMm });
    const departSample = hourly[Math.min(departureHour, Math.max(0, hourly.length - 1))] ?? current;
    winter = {
      iceRisk: risk,
      message: risk ? iceRiskMessage(ranked[0] ? shadedKm(ranked[0].analysis) : 0) : '',
      precip: precipType(departSample?.tempC ?? minTempC, departSample?.precipProb ?? 0),
      minTempC,
    };
  }

  return { ranked, rejected, shelterDataAvailable, winter };
}
