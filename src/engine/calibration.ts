/**
 * engine/calibration.ts — learn the owner's speed model from recorded rides (WR-024, SCORING_SPEC
 * §3). Pure. Fits {v0_road, v0_gravel, k_tail, k_head} of the LINEAR model by weighted least squares,
 * holding the grade coefficients fixed (the grade term is subtracted from observed speed first).
 * Only parameters with supporting data are fitted (degenerate data ⇒ partial fit, others untouched).
 */
import type { SpeedSettings } from './speedModel';

/** One ridden segment's observation: planned conditions + the speed actually held. */
export interface RideObservation {
  surface: 'paved' | 'gravel';
  /** Along-wind component in km/h (+ tailwind, − headwind), planned. */
  vParKmh: number;
  gradePct: number;
  observedSpeedKmh: number;
  /** Weight (seconds spent) — longer/steadier stretches count more. */
  weightS: number;
}

export interface CalibratedModel {
  v0Paved: number;
  v0Gravel: number;
  kTail: number;
  kHead: number;
}

export type CalibratedParam = keyof CalibratedModel;

export interface CalibrationResult {
  model: CalibratedModel;
  /** Which parameters were actually fitted (the rest kept their base values — partial fit). */
  fitted: CalibratedParam[];
  sampleCount: number;
}

/** Grade contribution to speed (km/h) at the fixed grade coefficients — subtracted before fitting. */
function gradeTerm(gradePct: number, base: SpeedSettings): number {
  return -base.upGradeCoef * Math.max(gradePct, 0) + base.downGradeCoef * Math.min(gradePct, 0);
}

/** Feature row for [v0Paved, v0Gravel, kTail, kHead]. */
function features(o: RideObservation): [number, number, number, number] {
  return [
    o.surface === 'paved' ? 1 : 0,
    o.surface === 'gravel' ? 1 : 0,
    Math.max(o.vParKmh, 0), // tailwind
    Math.min(o.vParKmh, 0), // headwind (negative)
  ];
}

const PARAMS: CalibratedParam[] = ['v0Paved', 'v0Gravel', 'kTail', 'kHead'];

/**
 * Weighted least-squares fit. Columns with no signal (Σ w·x² ≈ 0) are dropped and their parameter
 * keeps its base value. Bounds k_head ≥ k_tail ≥ 0 are enforced by projection after solving.
 */
export function fitSpeedModel(obs: RideObservation[], base: SpeedSettings): CalibrationResult {
  const baseModel: CalibratedModel = {
    v0Paved: base.baseKmh.paved,
    v0Gravel: base.baseKmh.gravel,
    kTail: base.tailCoef,
    kHead: base.headCoef,
  };
  if (obs.length === 0) return { model: baseModel, fitted: [], sampleCount: 0 };

  const rows = obs.map((o) => ({
    x: features(o),
    y: o.observedSpeedKmh - gradeTerm(o.gradePct, base),
    w: o.weightS,
  }));

  // Which of the 4 columns carry signal?
  const active = [0, 1, 2, 3].filter(
    (c) => rows.reduce((s, r) => s + r.w * r.x[c] * r.x[c], 0) > 1e-6,
  );
  if (active.length === 0) return { model: baseModel, fitted: [], sampleCount: obs.length };

  // Weighted normal equations over the active columns: (XᵀWX) β = XᵀWy.
  const n = active.length;
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const b = new Array<number>(n).fill(0);
  for (const r of rows) {
    for (let i = 0; i < n; i++) {
      const xi = r.x[active[i]];
      b[i] += r.w * xi * r.y;
      for (let j = 0; j < n; j++) A[i][j] += r.w * xi * r.x[active[j]];
    }
  }
  const beta = solve(A, b);
  if (!beta) return { model: baseModel, fitted: [], sampleCount: obs.length };

  const model = { ...baseModel };
  const fitted: CalibratedParam[] = [];
  active.forEach((c, i) => {
    model[PARAMS[c]] = beta[i];
    fitted.push(PARAMS[c]);
  });
  // Bounds: k_head ≥ k_tail ≥ 0 (headwind never helps more than tailwind; neither is negative).
  model.kTail = Math.max(0, model.kTail);
  model.kHead = Math.max(model.kHead, model.kTail);
  return { model, fitted, sampleCount: obs.length };
}

/** Gaussian elimination with partial pivoting; null if singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-9) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** ETA-error metric: |predicted − actual| moving time, as a percentage of actual (the scoreboard). */
export function etaErrorPct(predictedMovingS: number, actualMovingS: number): number {
  if (actualMovingS <= 0) return 0;
  return (Math.abs(predictedMovingS - actualMovingS) / actualMovingS) * 100;
}

// --- Persistable aggregates ---------------------------------------------------------------------
// Rides are bucketed by (surface, v_par band, grade band) and stored as weighted sums, so the app
// keeps ~O(bands) numbers instead of every ridden segment. Band edges sit ON the model's kinks
// (0 for wind, 0 for grade) so no bucket ever mixes headwind with tailwind or up with down — that
// keeps the linear model exactly linear within a bucket, so the weighted-mean representative point
// carries the same least-squares information as the raw samples.

export const V_PAR_BAND_KMH = 5;
export const GRADE_BAND_PCT = 1;

export interface CalibrationBucket {
  surface: 'paved' | 'gravel';
  vParBand: number;
  gradeBand: number;
  /** Σ weight, Σ weight·value — representative values are the weighted means. */
  weightS: number;
  sumSpeed: number;
  sumVPar: number;
  sumGrade: number;
  count: number;
}

/** Sign-aware band index: 0 is always a boundary, so a band never straddles a kink. */
function band(value: number, width: number): number {
  return value >= 0 ? Math.floor(value / width) : -1 - Math.floor(-value / width);
}

const bucketKey = (b: Pick<CalibrationBucket, 'surface' | 'vParBand' | 'gradeBand'>) =>
  `${b.surface}|${b.vParBand}|${b.gradeBand}`;

/** Aggregate one ride's observations into buckets keyed by (surface, v_par band, grade band). */
export function bucketObservations(obs: RideObservation[]): CalibrationBucket[] {
  const map = new Map<string, CalibrationBucket>();
  for (const o of obs) {
    const b: CalibrationBucket = {
      surface: o.surface,
      vParBand: band(o.vParKmh, V_PAR_BAND_KMH),
      gradeBand: band(o.gradePct, GRADE_BAND_PCT),
      weightS: 0,
      sumSpeed: 0,
      sumVPar: 0,
      sumGrade: 0,
      count: 0,
    };
    const key = bucketKey(b);
    const cur = map.get(key) ?? b;
    cur.weightS += o.weightS;
    cur.sumSpeed += o.weightS * o.observedSpeedKmh;
    cur.sumVPar += o.weightS * o.vParKmh;
    cur.sumGrade += o.weightS * o.gradePct;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()];
}

/** Merge bucket sets (e.g. the stored accumulator + a freshly finished ride). Pure. */
export function mergeBuckets(...sets: CalibrationBucket[][]): CalibrationBucket[] {
  const map = new Map<string, CalibrationBucket>();
  for (const set of sets)
    for (const b of set) {
      const key = bucketKey(b);
      const cur = map.get(key);
      if (!cur) {
        map.set(key, { ...b });
        continue;
      }
      cur.weightS += b.weightS;
      cur.sumSpeed += b.sumSpeed;
      cur.sumVPar += b.sumVPar;
      cur.sumGrade += b.sumGrade;
      cur.count += b.count;
    }
  return [...map.values()];
}

/** Collapse buckets to one weighted-mean observation each — the input to {@link fitSpeedModel}. */
export function bucketsToObservations(buckets: CalibrationBucket[]): RideObservation[] {
  return buckets
    .filter((b) => b.weightS > 0)
    .map((b) => ({
      surface: b.surface,
      vParKmh: b.sumVPar / b.weightS,
      gradePct: b.sumGrade / b.weightS,
      observedSpeedKmh: b.sumSpeed / b.weightS,
      weightS: b.weightS,
    }));
}

// --- Applying a fit -----------------------------------------------------------------------------

/** Overlay a calibrated model onto the base speed settings (grade + physics params unchanged). */
export function toSpeedSettings(model: CalibratedModel, base: SpeedSettings): SpeedSettings {
  return {
    ...base,
    baseKmh: { ...base.baseKmh, paved: model.v0Paved, gravel: model.v0Gravel },
    tailCoef: model.kTail,
    headCoef: model.kHead,
  };
}

/** Linear speed a model predicts for one condition, clamped to the base min/max (km/h). */
export function predictedSpeedKmh(
  model: CalibratedModel,
  o: Pick<RideObservation, 'surface' | 'vParKmh' | 'gradePct'>,
  base: SpeedSettings,
): number {
  const v0 = o.surface === 'paved' ? model.v0Paved : model.v0Gravel;
  const wind = o.vParKmh >= 0 ? model.kTail * o.vParKmh : model.kHead * o.vParKmh;
  const raw = v0 + wind + gradeTerm(o.gradePct, base);
  return Math.max(base.minKmh, Math.min(base.maxKmh, raw));
}

/**
 * Moving-time ETA error a model would have scored against the recorded buckets — the apples-to-
 * apples number behind the "before / after" comparison in Settings. Runs over the calibrated
 * (paved/gravel) portion only, which is exactly the portion any calibration can change.
 */
export function etaErrorForModel(
  buckets: CalibrationBucket[],
  model: CalibratedModel,
  base: SpeedSettings,
): number {
  let predictedS = 0;
  let actualS = 0;
  for (const o of bucketsToObservations(buckets)) {
    const distM = (o.observedSpeedKmh / 3.6) * o.weightS; // speed·time
    predictedS += distM / (predictedSpeedKmh(model, o, base) / 3.6);
    actualS += o.weightS;
  }
  return etaErrorPct(predictedS, actualS);
}
