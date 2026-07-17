/**
 * state/plan/runPlan.ts — the v0.1 planning pipeline (WR-008, ARCHITECTURE §5).
 *
 * inputs -> routing.generateCandidates (segmented) -> ONE weather call -> engine scoring ->
 * ranked candidates. Stores call adapters; the engine stays pure. v0.1 treats wind as spatially
 * uniform (exposure 1.0, shelter grid is Epic 3), so every segment shares the start's hourly
 * column — but the two-pass scoring still varies wind by time-of-arrival.
 */
import type { Providers } from '../../adapters/registry';
import { generateCandidates } from '../../adapters/routing/ors';
import { exposureAt, loadExposureGrid } from '../../data/exposureGrid';
import type { LatLon } from '../../domain';
import { resample, segmentMidpoint } from '../../engine/geometry';
import {
  DEFAULT_WEIGHTS,
  scoreCandidates,
  type RejectedCandidate,
  type ScoredCandidate,
  type ScoringWeights,
} from '../../engine/scoring';

export interface PlanInputs {
  distanceKm: number;
  routeType: 'loop' | 'out-and-back';
  surface: 'road' | 'gravel';
  homeBeforeDark: boolean;
  avoidBusy: boolean;
  start: LatLon;
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
}

export interface RunPlanOpts {
  /** Current epoch ms (injected; the engine is clock-free, the pipeline may read the clock). */
  now: number;
  onProgress?: (p: PlanProgress) => void;
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
  const grid = await loadExposureGrid();
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
  const minutesUntilSunset = inputs.homeBeforeDark
    ? (Date.parse(daylight.sunset) - opts.now) / 60000
    : undefined;
  const weights: ScoringWeights = inputs.avoidBusy
    ? { ...DEFAULT_WEIGHTS, traffic: DEFAULT_WEIGHTS.traffic * 2 }
    : DEFAULT_WEIGHTS;

  const { ranked, rejected } = scoreCandidates(
    candidates.map((candidate) => ({
      candidate,
      windBySegment: candidate.segments.map(() => hourly),
    })),
    {
      targetDistanceM: lengthM,
      prefersSurface: inputs.surface === 'gravel' ? 'gravel' : 'paved',
      homeBeforeDark: inputs.homeBeforeDark,
      minutesUntilSunset,
      startHourIndex: 0,
      weights,
    },
  );

  return { ranked, rejected, conditions, shelterDataAvailable };
}
