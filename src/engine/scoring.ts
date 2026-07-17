/**
 * engine/scoring.ts — time-weighted candidate scoring (WR-007, SCORING_SPEC §1,§3–6). Pure.
 *
 * Everything is weighted by TIME, not distance (headwind km cost more minutes). Two-pass wind
 * sampling: a rough base-speed pass fixes each segment's arrival hour, then a wind-adjusted pass
 * refines speed/time. Every sub-score is a pure value + evidence; the evidence powers explain.ts.
 */
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { explainCandidate } from './explain';
import { detectGustStretches, flaggedSegmentIndices, isGustFlagged } from './gustFlags';
import { decompose, type WindComponents } from './wind';
import {
  DEFAULT_SPEED_SETTINGS,
  segmentSpeedKmh,
  segmentTimeS,
  type SpeedSettings,
} from './speedModel';

export type SubScoreName =
  | 'wind'
  | 'safety'
  | 'shelter'
  | 'surface'
  | 'traffic'
  | 'scenery'
  | 'climb'
  | 'distance'
  | 'rain'
  | 'sequencing';

export type ScoringWeights = Record<SubScoreName, number>;

/** Exposure at/below this counts as shelter (SCORING_SPEC §4; shared with the map/ribbon tint). */
export const SHELTER_EXPOSURE_MAX = 0.6;
/** Along-wind speeds within this of zero are treated as neither head- nor tailwind (float dust). */
const V_PAR_EPS = 1e-6;

// Weights (SCORING_SPEC §6). Shelter (.06) joined in Epic 3 (WR-019); Robustness (.10) is still
// deferred to Epic 4, so the total renormalises over whatever weights are present (sum <1 by design).
export const DEFAULT_WEIGHTS: ScoringWeights = {
  wind: 0.28,
  safety: 0.1,
  shelter: 0.06,
  surface: 0.12,
  traffic: 0.1,
  scenery: 0.07,
  climb: 0.06,
  distance: 0.05,
  rain: 0.04,
  sequencing: 0.02,
};

export interface ScoreOptions {
  targetDistanceM: number;
  targetAscentM?: number;
  prefersSurface?: 'paved' | 'gravel' | 'any';
  homeBeforeDark?: boolean;
  /** Minutes from ride start until sunset — the home-before-dark hard constraint (§5). */
  minutesUntilSunset?: number;
  /** Forecast hour index the ride starts at (0 = first sampled hour). */
  startHourIndex?: number;
  speed?: SpeedSettings;
  weights?: ScoringWeights;
  /** @deprecated superseded by the WR-021 gust-flag detector (gustThresholdMs). */
  crossThresholdMs?: number;
  /** Effective-gust threshold (m/s) for the crosswind safety flag (default 13; settings 10–18). */
  gustThresholdMs?: number;
  distanceTolerancePct?: number;
  /** True only when a real exposure grid covered the routes; else the shelter axis stays uniform
   *  so presence-of-headwind can't masquerade as shelter differentiation (WR-019). */
  hasShelterData?: boolean;
}

export interface SegmentAnalysis {
  seg: Segment;
  wind: WindComponents;
  speedKmh: number;
  timeS: number;
  /** Cumulative arrival time at the segment's start (s). */
  startS: number;
  hourIndex: number;
  precipProb: number;
}

export interface CandidateAnalysis {
  candidate: CandidateRoute;
  segments: SegmentAnalysis[];
  totalTimeS: number;
  distanceM: number;
  ascentM: number;
  hasFerry: boolean;
}

export interface Evidence {
  distanceKm: number;
  timeS: number;
  ascentM: number;
  directHeadwindKm: number;
  headwindKm: number;
  tailwindKm: number;
  tailwindFinishKm: number;
  gravelKm: number;
  greenerKm: number;
  gustyKm: number;
  maxGustMs: number;
  headwindFirstHalfShare: number;
  /** Upwind distance ridden inside shelter (exposure ≤ 0.6) — WR-019. */
  shelteredUpwindKm: number;
  /** Time-weighted effective wind (m/s) over that sheltered upwind — for the explanation. */
  shelteredEffWindMs: number;
}

interface RawMetrics {
  headwindPenalty: number;
  seqShare: number;
  shelterShare: number;
  crossPenalty: number;
  surfaceMatchShare: number;
  trafficPenalty: number;
  sceneryShare: number;
  climbMatch: number;
  distanceMatch: number;
  rainPenalty: number;
  evidence: Evidence;
}

export interface SubScoreResult {
  normalized: number;
  raw: number;
}

export interface ScoredCandidate {
  candidate: CandidateRoute;
  analysis: CandidateAnalysis;
  total: number;
  sub: Record<SubScoreName, SubScoreResult>;
  evidence: Evidence;
  rank: number;
  explanation: string;
}

export interface RejectedCandidate {
  candidate: CandidateRoute;
  reasons: string[];
}

export interface ScoreResult {
  ranked: ScoredCandidate[];
  rejected: RejectedCandidate[];
}

export interface CandidateWindInput {
  candidate: CandidateRoute;
  /** Hourly wind at each segment's location: windBySegment[segIdx][hourIdx]. */
  windBySegment: WindSample[][];
}

const M_PER_KM = 1000;

// wayClass traffic penalty weight (SCORING_SPEC §4: primary/secondary without cycleway = heavy).
const TRAFFIC_WEIGHT: Record<string, number> = {
  'state road': 3,
  road: 2,
  construction: 2,
  steps: 2,
  footway: 1.5,
  street: 1,
  unknown: 1,
  track: 0.3,
  path: 0.3,
  cycleway: 0,
  ferry: 3,
};
function trafficWeight(wayClass: string | undefined): number {
  return wayClass ? (TRAFFIC_WEIGHT[wayClass] ?? 1) : 1;
}
function isGreenerWay(wayClass: string | undefined): boolean {
  return wayClass === 'path' || wayClass === 'track' || wayClass === 'cycleway';
}

/** Headwind emphasis f(delta): 1 up to 150°, ramping to 2 at a direct 180° headwind. */
function headwindEmphasis(deltaDeg: number): number {
  return 1 + Math.max(0, (deltaDeg - 150) / 30);
}

function gaussian(value: number, target: number, sigma: number): number {
  const d = (value - target) / sigma;
  return Math.exp(-0.5 * d * d);
}

export function analyzeCandidate(
  candidate: CandidateRoute,
  windBySegment: WindSample[][],
  opts: ScoreOptions,
): CandidateAnalysis {
  const s = opts.speed ?? DEFAULT_SPEED_SETTINGS;
  const startHour = opts.startHourIndex ?? 0;
  const segs = candidate.segments;

  // Guard the classic transposition / truncation bug (domain.ts): malformed wind input must fail
  // loudly, not silently score as dead calm and emit a confident-but-wrong ETA.
  if (windBySegment.length !== segs.length) {
    throw new Error(
      `scoring: windBySegment has ${windBySegment.length} entries but the route has ${segs.length} segments (transposed WindGrid?)`,
    );
  }

  // Pass 1: rough base-speed times to place each segment on the forecast hour axis.
  const roughStart: number[] = [];
  let acc = 0;
  for (const seg of segs) {
    roughStart.push(acc);
    const roughKmh = segmentSpeedKmh(seg.surface, seg.gradePct, 0, s);
    acc += segmentTimeS(seg.lengthM, roughKmh);
  }

  // Pass 2: sample wind at each segment's rough arrival hour, refine speed/time.
  const analyses: SegmentAnalysis[] = [];
  let cum = 0;
  let hasFerry = false;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg.wayClass === 'ferry') hasFerry = true;
    const hourly = windBySegment[i];
    if (hourly.length === 0) throw new Error(`scoring: no wind samples for segment ${i}`);
    // Midpoint elapsed time of this segment on the rough (base-speed) time axis. The extra parens
    // matter: without them `?? acc - roughStart[i]` mis-groups and inflates the midpoint.
    const midS = roughStart[i] + ((roughStart[i + 1] ?? acc) - roughStart[i]) / 2;
    const hourIndex = Math.max(0, Math.min(hourly.length - 1, startHour + Math.floor(midS / 3600)));
    const sample = hourly[hourIndex];
    const wind = decompose(
      seg.bearingDeg,
      sample.windFromDeg,
      sample.windMs,
      seg.exposure,
      sample.gustMs,
    );
    const speedKmh = segmentSpeedKmh(seg.surface, seg.gradePct, wind.vParMs, s);
    const timeS = segmentTimeS(seg.lengthM, speedKmh);
    analyses.push({
      seg,
      wind,
      speedKmh,
      timeS,
      startS: cum,
      hourIndex,
      precipProb: sample.precipProb,
    });
    cum += timeS;
  }

  return {
    candidate,
    segments: analyses,
    totalTimeS: cum,
    distanceM: candidate.distanceM,
    ascentM: candidate.ascentM,
    hasFerry,
  };
}

function computeMetrics(a: CandidateAnalysis, opts: ScoreOptions): RawMetrics {
  const prefersSurface = opts.prefersSurface ?? 'any';
  const total = a.totalTimeS;
  const half = total / 2;
  let totalDist = 0;

  let headwindPenalty = 0;
  let trafficPenalty = 0;
  let rainPenalty = 0;
  let hwTime = 0;
  let hwFirst = 0;
  let shelteredUpwindTime = 0;
  let shelteredUpwindDist = 0;
  let shelteredEffWindTimeWeighted = 0;
  let matchDist = 0;
  let greenerDist = 0;
  let gravelKm = 0;
  let directHeadwindKm = 0;
  let headwindKm = 0;
  let tailwindKm = 0;
  let tailwindFinishKm = 0;

  for (const sa of a.segments) {
    const km = sa.seg.lengthM / M_PER_KM;
    totalDist += sa.seg.lengthM;
    const headwind = Math.max(0, -sa.wind.vParMs);

    headwindPenalty += sa.timeS * headwindEmphasis(sa.wind.deltaDeg) * headwind;
    trafficPenalty += sa.timeS * trafficWeight(sa.seg.wayClass);
    rainPenalty += sa.timeS * (sa.precipProb / 100);

    if (sa.wind.vParMs < -V_PAR_EPS) {
      headwindKm += km;
      hwTime += sa.timeS;
      if (sa.startS + sa.timeS / 2 < half) hwFirst += sa.timeS;
      if (sa.wind.deltaDeg > 150) directHeadwindKm += km;
      // Shelter (§4): the fraction of upwind time spent hidden in shelter (exposure ≤ 0.6).
      if (sa.seg.exposure <= SHELTER_EXPOSURE_MAX) {
        shelteredUpwindTime += sa.timeS;
        shelteredUpwindDist += sa.seg.lengthM;
        shelteredEffWindTimeWeighted += sa.timeS * sa.wind.effectiveMs;
      }
    } else if (sa.wind.vParMs > V_PAR_EPS) {
      tailwindKm += km;
      if (sa.startS + sa.timeS / 2 >= half) tailwindFinishKm += km;
    }

    if (prefersSurface !== 'any' && sa.seg.surface === prefersSurface) matchDist += sa.seg.lengthM;
    if (isGreenerWay(sa.seg.wayClass)) greenerDist += sa.seg.lengthM;
    if (sa.seg.surface === 'gravel') gravelKm += km;
  }

  // CrosswindSafety penalty + gust evidence, from the SINGLE gust-stretch detector (WR-021):
  // penalise time in flagged exposed-crosswind gust stretches; report their length + peak gust.
  const gustStretches = detectGustStretches(a.segments, { thresholdMs: opts.gustThresholdMs });
  const flagged = flaggedSegmentIndices(gustStretches);
  let crossPenalty = 0;
  a.segments.forEach((sa, i) => {
    // Penalise only genuinely flagged segments — not the calm segments a stretch bridges over —
    // so the time-weighted gust penalty shares one domain with the reported peak gust.
    if (flagged.has(i) && isGustFlagged(sa, opts.gustThresholdMs)) {
      crossPenalty += sa.timeS * sa.wind.gustEffMs;
    }
  });
  const gustyKm = gustStretches.reduce((sum, s) => sum + s.lengthM, 0) / M_PER_KM;
  const maxGustMs = gustStretches.reduce((m, s) => Math.max(m, s.maxGustMs), 0);

  const distGuard = totalDist || 1;
  // Share of headwind time in the first half (0.5 = neutral when there is no headwind to sequence).
  const seqShare = hwTime > 0 ? hwFirst / hwTime : 0.5;
  // Share of upwind time spent sheltered (0.5 = neutral when there is no headwind to shelter).
  const shelterShare = hwTime > 0 ? shelteredUpwindTime / hwTime : 0.5;
  return {
    headwindPenalty,
    seqShare,
    shelterShare,
    crossPenalty,
    surfaceMatchShare: prefersSurface === 'any' ? 0.5 : matchDist / distGuard,
    trafficPenalty,
    sceneryShare: greenerDist / distGuard,
    climbMatch:
      opts.targetAscentM !== undefined
        ? gaussian(a.ascentM, opts.targetAscentM, Math.max(50, opts.targetAscentM * 0.4))
        : 0.5,
    distanceMatch: gaussian(a.distanceM, opts.targetDistanceM, opts.targetDistanceM * 0.15),
    rainPenalty,
    evidence: {
      distanceKm: a.distanceM / M_PER_KM,
      timeS: total,
      ascentM: a.ascentM,
      directHeadwindKm,
      headwindKm,
      tailwindKm,
      tailwindFinishKm,
      gravelKm,
      greenerKm: greenerDist / M_PER_KM,
      gustyKm,
      maxGustMs,
      headwindFirstHalfShare: seqShare,
      shelteredUpwindKm: shelteredUpwindDist / M_PER_KM,
      shelteredEffWindMs:
        shelteredUpwindTime > 0 ? shelteredEffWindTimeWeighted / shelteredUpwindTime : 0,
    },
  };
}

function normalizeHigher(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}
function normalizeLower(values: number[]): number[] {
  return normalizeHigher(values.map((v) => -v));
}

/** Normalise each sub-score 0–1 across a set of metric rows (shared by scoreCandidates + matrix). */
function subScoreNorms(
  metrics: RawMetrics[],
  hasShelterData: boolean,
): Record<SubScoreName, number[]> {
  return {
    wind: normalizeLower(metrics.map((m) => m.headwindPenalty)),
    safety: normalizeLower(metrics.map((m) => m.crossPenalty)),
    shelter: hasShelterData
      ? normalizeHigher(metrics.map((m) => m.shelterShare))
      : metrics.map(() => 0.5),
    surface: normalizeHigher(metrics.map((m) => m.surfaceMatchShare)),
    traffic: normalizeLower(metrics.map((m) => m.trafficPenalty)),
    scenery: normalizeHigher(metrics.map((m) => m.sceneryShare)),
    climb: normalizeHigher(metrics.map((m) => m.climbMatch)),
    distance: normalizeHigher(metrics.map((m) => m.distanceMatch)),
    rain: normalizeLower(metrics.map((m) => m.rainPenalty)),
    sequencing: normalizeHigher(metrics.map((m) => m.seqShare)),
  };
}

/** Total 0–100 for one metric row given pre-normalised sub-scores at index i and the weight vector. */
function weightedTotal(
  norm: Record<SubScoreName, number[]>,
  i: number,
  weights: ScoringWeights,
): number {
  const names = Object.keys(weights) as SubScoreName[];
  const weightSum = names.reduce((sum, n) => sum + weights[n], 0) || 1;
  let total = 0;
  for (const n of names) total += (weights[n] / weightSum) * norm[n][i];
  return total * 100;
}

function hardConstraintReasons(a: CandidateAnalysis, opts: ScoreOptions): string[] {
  const reasons: string[] = [];
  const tol = opts.distanceTolerancePct ?? 0.15;
  if (Math.abs(a.distanceM - opts.targetDistanceM) / opts.targetDistanceM > tol) {
    reasons.push(`distance outside ±${Math.round(tol * 100)}% of target`);
  }
  if (a.hasFerry) reasons.push('route uses a ferry');
  if (opts.homeBeforeDark && opts.minutesUntilSunset !== undefined) {
    if (a.totalTimeS / 60 > opts.minutesUntilSunset - 20)
      reasons.push('would not finish before dark');
  }
  return reasons;
}

export function scoreCandidates(inputs: CandidateWindInput[], opts: ScoreOptions): ScoreResult {
  // Fail loudly rather than silently no-op the safety constraint if the caller forgets sunset.
  if (opts.homeBeforeDark && opts.minutesUntilSunset === undefined) {
    throw new Error('scoring: homeBeforeDark requires minutesUntilSunset');
  }
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const analyses = inputs.map((i) => analyzeCandidate(i.candidate, i.windBySegment, opts));

  // Hard constraints (§5) filter before scoring.
  const rejected: RejectedCandidate[] = [];
  const survivors: CandidateAnalysis[] = [];
  for (const a of analyses) {
    const reasons = hardConstraintReasons(a, opts);
    if (reasons.length > 0) rejected.push({ candidate: a.candidate, reasons });
    else survivors.push(a);
  }
  if (survivors.length === 0) return { ranked: [], rejected };

  const metrics = survivors.map((a) => computeMetrics(a, opts));

  // Each sub-score normalised 0–1 across the surviving set (higher = better).
  const norm = subScoreNorms(metrics, !!opts.hasShelterData);
  const rawByName: Record<SubScoreName, number[]> = {
    wind: metrics.map((m) => m.headwindPenalty),
    safety: metrics.map((m) => m.crossPenalty),
    shelter: metrics.map((m) => m.shelterShare),
    surface: metrics.map((m) => m.surfaceMatchShare),
    traffic: metrics.map((m) => m.trafficPenalty),
    scenery: metrics.map((m) => m.sceneryShare),
    climb: metrics.map((m) => m.climbMatch),
    distance: metrics.map((m) => m.distanceMatch),
    rain: metrics.map((m) => m.rainPenalty),
    sequencing: metrics.map((m) => m.seqShare),
  };

  const names = Object.keys(weights) as SubScoreName[];

  const scored: ScoredCandidate[] = survivors.map((a, i) => {
    const sub = {} as Record<SubScoreName, SubScoreResult>;
    for (const n of names) sub[n] = { normalized: norm[n][i], raw: rawByName[n][i] };
    return {
      candidate: a.candidate,
      analysis: a,
      total: weightedTotal(norm, i, weights),
      sub,
      evidence: metrics[i].evidence,
      rank: 0,
      explanation: '',
    };
  });

  // Deterministic ranking: total desc, ties broken by candidate id.
  scored.sort((x, y) => y.total - x.total || x.candidate.id.localeCompare(y.candidate.id));
  scored.forEach((sc, i) => (sc.rank = i + 1));
  for (const sc of scored) sc.explanation = explainCandidate(sc, scored);

  return { ranked: scored, rejected };
}

// --- start-time matrix (WR-020) ------------------------------------------------------------
export interface StartTimeCell {
  hourIndex: number;
  /** Score 0–100, or null when a hard constraint (e.g. would-not-finish-before-dark) rejects it. */
  total: number | null;
}
export interface StartTimeRow {
  candidate: CandidateRoute;
  cells: StartTimeCell[];
}
export interface StartTimeMatrix {
  hours: number[];
  rows: StartTimeRow[];
}

/**
 * Score every candidate at every departure hour (WR-020). Sub-scores are normalised JOINTLY across
 * ALL (candidate, hour) cells, so totals are comparable across the whole matrix — the joint best
 * cell is meaningful, unlike per-hour scoring which re-anchors normalisation each hour. Geometry is
 * fixed; only the wind sampling (via startHourIndex) and the daylight constraint vary by hour.
 * `opts.minutesUntilSunset` is now-relative and shrinks by 60 per departure hour.
 */
export function scoreMatrix(
  inputs: CandidateWindInput[],
  hours: number[],
  opts: ScoreOptions,
): StartTimeMatrix {
  // Same loud guard as scoreCandidates — never silently skip the daylight safety constraint.
  if (opts.homeBeforeDark && opts.minutesUntilSunset === undefined) {
    throw new Error('scoring: homeBeforeDark requires minutesUntilSunset');
  }
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  interface Cell {
    ci: number;
    hi: number;
    metrics: RawMetrics;
  }
  const cells: Cell[] = [];
  const index = new Map<string, number>(); // `${ci}:${hi}` -> position in `cells`

  inputs.forEach((input, ci) => {
    hours.forEach((h, hi) => {
      const a = analyzeCandidate(input.candidate, input.windBySegment, {
        ...opts,
        startHourIndex: h,
      });
      const perHour: ScoreOptions = {
        ...opts,
        minutesUntilSunset:
          opts.minutesUntilSunset !== undefined ? opts.minutesUntilSunset - h * 60 : undefined,
      };
      if (hardConstraintReasons(a, perHour).length > 0) return; // rejected cell (e.g. dark)
      index.set(`${ci}:${hi}`, cells.length);
      cells.push({ ci, hi, metrics: computeMetrics(a, perHour) });
    });
  });

  const norm = subScoreNorms(
    cells.map((c) => c.metrics),
    !!opts.hasShelterData,
  );
  const totals = cells.map((_, i) => weightedTotal(norm, i, weights));

  const rows: StartTimeRow[] = inputs.map((input, ci) => ({
    candidate: input.candidate,
    cells: hours.map((h, hi) => {
      const pos = index.get(`${ci}:${hi}`);
      return { hourIndex: h, total: pos === undefined ? null : totals[pos] };
    }),
  }));
  return { hours, rows };
}
