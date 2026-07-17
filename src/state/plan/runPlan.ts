/**
 * state/plan/runPlan.ts — the v0.1 planning pipeline (WR-008, ARCHITECTURE §5).
 *
 * inputs -> routing.generateCandidates (segmented) -> exposure fill (shelter grid) -> ONE weather
 * call -> engine scoring -> ranked candidates. Stores call adapters; the engine stays pure. Wind is
 * spatially uniform (every segment shares the start's hourly column), but per-segment exposure comes
 * from the shelter grid (WR-019) and the two-pass scoring varies wind by time-of-arrival.
 */
import type { Providers } from '../../adapters/registry';
import { generateCandidates } from '../../adapters/routing/ors';
import { activeSpeedSettings } from '../calibrationStore';
import { exposureAt, loadExposureGrid, type DecodedGrid } from '../../data/exposureGrid';
import type { LatLon } from '../../domain';
import { resample, segmentMidpoint } from '../../engine/geometry';
import {
  DEFAULT_WEIGHTS,
  scoreCandidates,
  scoreMatrix,
  type RejectedCandidate,
  type ScoredCandidate,
  type ScoringWeights,
  type StartTimeMatrix,
} from '../../engine/scoring';
import { startTimeMessage } from '../../engine/startTime';
import {
  iceRisk,
  iceRiskMessage,
  precipType,
  shadedKm,
  winterSpeedSettings,
  type PrecipType,
} from '../../engine/winter';

export interface PlanInputs {
  distanceKm: number;
  routeType: 'loop' | 'out-and-back' | 'downwind';
  surface: 'road' | 'gravel';
  homeBeforeDark: boolean;
  avoidBusy: boolean;
  start: LatLon;
  /** Departure hour offset from now for the main ranking (0 = now; WR-020 picker). */
  departureHour?: number;
  /** Winter / Nordic mode (WR-027): studded speeds, daylight-on, ice-risk caution, snow copy. */
  winter?: boolean;
}

/** Winter-mode advisory info for the results/ride UI (WR-027). Null outside winter mode. */
export interface WinterInfo {
  /** Advisory ice-risk flag — a caution, never a guarantee. */
  iceRisk: boolean;
  /** Hedged caution copy (empty when no ice risk). */
  message: string;
  /** Temperature-inferred precipitation type, so copy says "snow", not "rain". */
  precip: PrecipType;
  /** Coldest forecast hour in the window (°C). */
  minTempC: number;
}

export interface Conditions {
  windMs: number;
  windFromDeg: number;
  gustMs: number;
  tempC: number;
  feelsC?: number;
  precipProb: number;
  sunset: string;
  sunrise: string;
}

export type PlanProgress =
  | { phase: 'candidates'; done: number; total: number }
  | { phase: 'weather' }
  | { phase: 'scoring' };

export interface PlanOutput {
  ranked: ScoredCandidate[];
  rejected: RejectedCandidate[];
  conditions: Conditions;
  /** False when the exposure grid isn't generated / the ride is outside its region (WR-019). */
  shelterDataAvailable: boolean;
  /** Candidate × departure-hour score matrix + the joint recommendation (WR-020). */
  startMatrix: StartTimeMatrix;
  startMessage: string;
  /** Clock label per hour index (e.g. "17:00"), aligned to startMatrix.hours. */
  hourLabels: string[];
  /** Winter-mode advisory (WR-027); null when winter mode is off. */
  winter: WinterInfo | null;
}

export interface RunPlanOpts {
  /** Current epoch ms (injected; the engine is clock-free, the pipeline may read the clock). */
  now: number;
  onProgress?: (p: PlanProgress) => void;
  /** Injectable shelter-grid loader (tests supply a synthetic grid; default loads the asset). */
  loadGrid?: () => Promise<DecodedGrid | null>;
}

function forecastHours(distanceKm: number): number {
  // Enough hours to cover even a slow, headwind-heavy ride (~12 km/h worst case) plus margin.
  return Math.max(6, Math.min(24, Math.ceil(distanceKm / 12) + 2));
}

export async function runPlan(
  providers: Providers,
  inputs: PlanInputs,
  opts: RunPlanOpts,
): Promise<PlanOutput> {
  const lengthM = inputs.distanceKm * 1000;
  const profile = inputs.surface === 'road' ? 'cycling-road' : 'cycling-regular';

  opts.onProgress?.({ phase: 'candidates', done: 0, total: 0 });
  const genOpts =
    inputs.routeType === 'out-and-back'
      ? { seeds: [], bearings: [0, 90, 180, 270] }
      : // loop mode: round trips only (4 seeds x 2 points => 8 candidates, PRODUCT_SPEC §3 "6-8")
        { seeds: [10, 20, 30, 40], bearings: [] };
  const raw = await generateCandidates(providers.routing, inputs.start, lengthM, profile, {
    ...genOpts,
    onSettled: (done, total) => opts.onProgress?.({ phase: 'candidates', done, total }),
  });
  // Ensure every candidate is segmented (ARCHITECTURE §5). The ORS adapter already resamples;
  // the mock returns bare polylines, so resample those here from geometry.
  const candidates = raw.map((c) =>
    c.segments.length > 0 ? c : { ...c, segments: resample({ polyline: c.polyline }) },
  );

  // Fill each segment's exposure factor from the shelter grid (midpoint lookup, WR-019). The grid
  // is a local static asset; when it's absent every lookup is neutral 1.0 (matches the default).
  const grid = await (opts.loadGrid ?? loadExposureGrid)();
  let shelterDataAvailable = false;
  for (const c of candidates) {
    for (const s of c.segments) {
      const mid = segmentMidpoint(s);
      const { factor, inRegion } = exposureAt(grid, mid.lat, mid.lon);
      s.exposure = factor;
      if (inRegion) shelterDataAvailable = true;
    }
  }

  opts.onProgress?.({ phase: 'weather' });
  const hours = forecastHours(inputs.distanceKm);
  const hourly = (await providers.weather.windAlong([inputs.start], hours))[0] ?? [];
  const daylight = await providers.weather.daylight(inputs.start);
  const current = hourly[0];

  const conditions: Conditions = {
    windMs: current?.windMs ?? 0,
    windFromDeg: current?.windFromDeg ?? 0,
    gustMs: current?.gustMs ?? 0,
    tempC: current?.tempC ?? 0,
    feelsC: current?.feelsC,
    precipProb: current?.precipProb ?? 0,
    sunset: daylight.sunset,
    sunrise: daylight.sunrise,
  };

  opts.onProgress?.({ phase: 'scoring' });
  const departureHour = inputs.departureHour ?? 0;
  // Winter mode (WR-027): daylight defaults ON (Nordic winters are short), and the speed model uses
  // studded-tyre offsets so ETAs stay honest on ice.
  const winterActive = !!inputs.winter;
  const homeBeforeDark = inputs.homeBeforeDark || winterActive;
  const speed = winterActive ? winterSpeedSettings(activeSpeedSettings()) : activeSpeedSettings();
  // Sunset margin from NOW; each departure hour eats 60 min of it (handled per-hour by scoreMatrix).
  const minutesUntilSunsetNow = (Date.parse(daylight.sunset) - opts.now) / 60000;
  const minutesUntilSunset = homeBeforeDark
    ? minutesUntilSunsetNow - departureHour * 60
    : undefined;
  const weights: ScoringWeights = inputs.avoidBusy
    ? { ...DEFAULT_WEIGHTS, traffic: DEFAULT_WEIGHTS.traffic * 2 }
    : DEFAULT_WEIGHTS;

  const windInputs = candidates.map((candidate) => ({
    candidate,
    windBySegment: candidate.segments.map(() => hourly),
  }));
  const baseOpts = {
    targetDistanceM: lengthM,
    prefersSurface: (inputs.surface === 'gravel' ? 'gravel' : 'paved') as 'gravel' | 'paved',
    weights,
    hasShelterData: shelterDataAvailable,
    // Winter studded speeds, else the owner's calibrated model / default (WR-024, WR-027).
    speed,
  };

  const { ranked, rejected } = scoreCandidates(windInputs, {
    ...baseOpts,
    homeBeforeDark,
    minutesUntilSunset,
    startHourIndex: departureHour,
  });

  // Start-time matrix over the whole window (WR-020). Daylight follows the ranking's toggle so we
  // never show "no ride before dark" next to offered routes (or vice-versa).
  const windowHours = Array.from({ length: Math.max(1, hourly.length) }, (_v, i) => i);
  const startMatrix = scoreMatrix(windInputs, windowHours, {
    ...baseOpts,
    homeBeforeDark,
    minutesUntilSunset: homeBeforeDark ? minutesUntilSunsetNow : undefined,
  });
  const hourLabels = windowHours.map((h) => {
    const d = new Date(opts.now + h * 3_600_000);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  });
  // Label EVERY matrix candidate (ranked first as Route A/B/C, then any rejected-by-daylight ones)
  // so the recommendation copy never degrades to a generic "a route".
  const labelByRank = new Map<string, string>();
  ranked.forEach((r, i) => labelByRank.set(r.candidate.id, `Route ${String.fromCharCode(65 + i)}`));
  let nextLetter = ranked.length;
  for (const row of startMatrix.rows) {
    if (!labelByRank.has(row.candidate.id)) {
      labelByRank.set(row.candidate.id, `Route ${String.fromCharCode(65 + nextLetter++)}`);
    }
  }
  const startMessage = startTimeMessage(startMatrix, {
    label: (id) => labelByRank.get(id) ?? 'a route',
    hourLabel: (h) => hourLabels[h] ?? `+${h}h`,
  });

  // Ice-risk caution (WR-027): coldest hour in the window + whether it precipitated in the prior 24 h.
  let winter: WinterInfo | null = null;
  if (winterActive) {
    const minTempC = hourly.length
      ? Math.min(...hourly.map((s) => s.tempC))
      : (current?.tempC ?? 0);
    const precipPrior24hMm = (await providers.weather.recentPrecipMm?.(inputs.start, 24)) ?? 0;
    const risk = iceRisk({ minTempC, precipPrior24hMm });
    // Infer precip TYPE at the DEPARTURE hour (not hour 0) — an evening ride's snow-vs-rain copy
    // must reflect the evening, not now.
    const departSample = hourly[Math.min(departureHour, Math.max(0, hourly.length - 1))] ?? current;
    winter = {
      iceRisk: risk,
      message: risk ? iceRiskMessage(ranked[0] ? shadedKm(ranked[0].analysis) : 0) : '',
      precip: precipType(departSample?.tempC ?? minTempC, departSample?.precipProb ?? 0),
      minTempC,
    };
  }

  return {
    ranked,
    rejected,
    conditions,
    shelterDataAvailable,
    startMatrix,
    startMessage,
    hourLabels,
    winter,
  };
}
