import { describe, expect, it } from 'vitest';
import {
  bucketObservations,
  bucketsToObservations,
  etaErrorForModel,
  etaErrorPct,
  fitSpeedModel,
  mergeBuckets,
  nearFlatBuckets,
  toSpeedSettings,
  type RideObservation,
} from './calibration';
import { DEFAULT_SPEED_SETTINGS, segmentSpeedKmh } from './speedModel';

const BASE = DEFAULT_SPEED_SETTINGS;
const gradeTerm = (g: number) =>
  -BASE.upGradeCoef * Math.max(g, 0) + BASE.downGradeCoef * Math.min(g, 0);

// Ground-truth params (deliberately different from the DEFAULT base the fit starts from).
const TRUE = { v0Paved: 30, v0Gravel: 23, kTail: 0.5, kHead: 0.8 };

function synth(surface: 'paved' | 'gravel', vParKmh: number, gradePct: number): RideObservation {
  const v0 = surface === 'paved' ? TRUE.v0Paved : TRUE.v0Gravel;
  const wind = vParKmh >= 0 ? TRUE.kTail * vParKmh : TRUE.kHead * vParKmh;
  return {
    surface,
    vParKmh,
    gradePct,
    observedSpeedKmh: v0 + wind + gradeTerm(gradePct),
    weightS: 100,
  };
}

function grid(surfaces: Array<'paved' | 'gravel'>, winds: number[], grades: number[]) {
  const obs: RideObservation[] = [];
  for (const s of surfaces) for (const w of winds) for (const g of grades) obs.push(synth(s, w, g));
  return obs;
}

describe('fitSpeedModel', () => {
  it('recovers known ground-truth params within 10%', () => {
    const obs = grid(['paved', 'gravel'], [-20, -10, 0, 10, 20], [-3, 0, 3]);
    const { model, fitted } = fitSpeedModel(obs, BASE);
    expect(fitted).toEqual(['v0Paved', 'v0Gravel', 'kTail', 'kHead']);
    expect(model.v0Paved).toBeCloseTo(TRUE.v0Paved, 0);
    expect(model.v0Gravel).toBeCloseTo(TRUE.v0Gravel, 0);
    expect(Math.abs(model.kTail - TRUE.kTail) / TRUE.kTail).toBeLessThan(0.1);
    expect(Math.abs(model.kHead - TRUE.kHead) / TRUE.kHead).toBeLessThan(0.1);
  });

  it('all-tailwind data: kHead is not fitted (partial fit), others recovered', () => {
    const { model, fitted } = fitSpeedModel(grid(['paved', 'gravel'], [0, 10, 20], [0]), BASE);
    expect(fitted).not.toContain('kHead');
    expect(fitted).toContain('kTail');
    expect(model.kHead).toBe(BASE.headCoef); // held at base
    expect(model.v0Paved).toBeCloseTo(TRUE.v0Paved, 0);
  });

  it('one-surface data: the other surface v0 is held', () => {
    const { model, fitted } = fitSpeedModel(grid(['paved'], [-10, 0, 10], [0]), BASE);
    expect(fitted).not.toContain('v0Gravel');
    expect(model.v0Gravel).toBe(BASE.baseKmh.gravel);
    expect(model.v0Paved).toBeCloseTo(TRUE.v0Paved, 0);
  });

  it('enforces bounds k_head ≥ k_tail ≥ 0', () => {
    // Data implying a negative tail coefficient still yields k_tail ≥ 0 and k_head ≥ k_tail.
    const weird: RideObservation[] = [
      { surface: 'paved', vParKmh: 10, gradePct: 0, observedSpeedKmh: 20, weightS: 100 },
      { surface: 'paved', vParKmh: 20, gradePct: 0, observedSpeedKmh: 10, weightS: 100 },
      { surface: 'paved', vParKmh: 0, gradePct: 0, observedSpeedKmh: 27, weightS: 100 },
    ];
    const { model } = fitSpeedModel(weird, BASE);
    expect(model.kTail).toBeGreaterThanOrEqual(0);
    expect(model.kHead).toBeGreaterThanOrEqual(model.kTail);
  });

  it('empty data returns the base model untouched', () => {
    const { model, fitted } = fitSpeedModel([], BASE);
    expect(fitted).toEqual([]);
    expect(model.v0Paved).toBe(BASE.baseKmh.paved);
  });

  it('tail-only data never bumps the held headwind coefficient (honest partial fit)', () => {
    // A strong tailwind gain fits kTail > base.headCoef. kHead has NO supporting data, so it MUST
    // stay at base — the bound is honoured by clamping the fitted kTail, not by asserting headwind
    // data we never saw (otherwise the "kept defaults" claim would be a lie).
    const strongTail: RideObservation[] = [0, 10, 20].map((v) => ({
      surface: 'paved',
      vParKmh: v,
      gradePct: 0,
      observedSpeedKmh: 27 + 0.9 * v,
      weightS: 100,
    }));
    const { model, fitted } = fitSpeedModel(strongTail, BASE);
    expect(fitted).not.toContain('kHead');
    expect(model.kHead).toBe(BASE.headCoef); // untouched
    expect(model.kTail).toBeLessThanOrEqual(BASE.headCoef); // clamped by the held bound
    expect(model.kHead).toBeGreaterThanOrEqual(model.kTail); // k_head ≥ k_tail still holds
  });
});

describe('nearFlatBuckets', () => {
  it('excludes steep buckets so descent error cannot leak into v0', () => {
    const flat = grid(['paved'], [-10, 0, 10], [0]); // clean, TRUE-generated
    // Steep descents ridden fast (55 km/h) — unrelated to the model's crude downhill term.
    const steep: RideObservation[] = [-10, 0, 10].map((v) => ({
      surface: 'paved',
      vParKmh: v,
      gradePct: -10,
      observedSpeedKmh: 55,
      weightS: 100,
    }));
    const all = bucketObservations([...flat, ...steep]);
    expect(nearFlatBuckets(all).length).toBeLessThan(all.length);

    // Fitting near-flat only recovers v0 cleanly...
    const clean = fitSpeedModel(bucketsToObservations(nearFlatBuckets(all)), BASE);
    expect(clean.model.v0Paved).toBeCloseTo(TRUE.v0Paved, 0);
    // ...while fitting everything is pulled well off by the descent contamination.
    const contaminated = fitSpeedModel(bucketsToObservations(all), BASE);
    expect(Math.abs(contaminated.model.v0Paved - TRUE.v0Paved)).toBeGreaterThan(
      Math.abs(clean.model.v0Paved - TRUE.v0Paved),
    );
  });
});

describe('bucketing', () => {
  it('bucketing to weighted-mean observations preserves the fit (bands sit on the kinks)', () => {
    const obs = grid(['paved', 'gravel'], [-20, -10, 0, 10, 20], [-3, 0, 3]);
    const viaBuckets = bucketsToObservations(bucketObservations(obs));
    const { model } = fitSpeedModel(viaBuckets, BASE);
    expect(model.v0Paved).toBeCloseTo(TRUE.v0Paved, 0);
    expect(model.v0Gravel).toBeCloseTo(TRUE.v0Gravel, 0);
    expect(Math.abs(model.kTail - TRUE.kTail) / TRUE.kTail).toBeLessThan(0.1);
    expect(Math.abs(model.kHead - TRUE.kHead) / TRUE.kHead).toBeLessThan(0.1);
  });

  it('never mixes headwind with tailwind (0 is a band boundary)', () => {
    const buckets = bucketObservations([
      { surface: 'paved', vParKmh: 2, gradePct: 0, observedSpeedKmh: 28, weightS: 100 },
      { surface: 'paved', vParKmh: -2, gradePct: 0, observedSpeedKmh: 26, weightS: 100 },
    ]);
    expect(buckets).toHaveLength(2); // separate buckets despite both |v_par| < band width
  });

  it('merging bucket sets sums their weighted aggregates', () => {
    const a = bucketObservations([synth('paved', 10, 0)]);
    const b = bucketObservations([synth('paved', 10, 0)]);
    const merged = mergeBuckets(a, b);
    expect(merged).toHaveLength(1);
    expect(merged[0].weightS).toBe(a[0].weightS + b[0].weightS);
    expect(merged[0].count).toBe(2);
    // The weighted-mean speed is unchanged (same observation twice).
    expect(bucketsToObservations(merged)[0].observedSpeedKmh).toBeCloseTo(
      bucketsToObservations(a)[0].observedSpeedKmh,
      6,
    );
  });
});

describe('etaErrorForModel', () => {
  it('is lower for the fitted model than for the wrong default when the rider is faster', () => {
    // Observations generated from TRUE (faster than DEFAULT) ⇒ the default under-predicts speed
    // (over-predicts time), so the fitted model must score a smaller ETA error.
    const buckets = bucketObservations(grid(['paved', 'gravel'], [-20, 0, 20], [0]));
    const { model } = fitSpeedModel(bucketsToObservations(buckets), BASE);
    const before = etaErrorForModel(
      buckets,
      {
        v0Paved: BASE.baseKmh.paved,
        v0Gravel: BASE.baseKmh.gravel,
        kTail: BASE.tailCoef,
        kHead: BASE.headCoef,
      },
      BASE,
    );
    const after = etaErrorForModel(buckets, model, BASE);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(2); // fitted model reproduces the data closely
  });
});

describe('toSpeedSettings', () => {
  it('overlays the calibrated params so segmentSpeedKmh reflects them', () => {
    const s = toSpeedSettings(TRUE, BASE);
    expect(s.baseKmh.paved).toBe(TRUE.v0Paved);
    expect(s.baseKmh.gravel).toBe(TRUE.v0Gravel);
    // Grade + physics params are untouched.
    expect(s.upGradeCoef).toBe(BASE.upGradeCoef);
    // A flat, still-air paved segment now rides at the calibrated base speed.
    expect(segmentSpeedKmh('paved', 0, 0, s)).toBeCloseTo(TRUE.v0Paved, 6);
  });
});

describe('etaErrorPct', () => {
  it('reports the moving-time error percentage', () => {
    expect(etaErrorPct(120, 100)).toBeCloseTo(20, 6);
    expect(etaErrorPct(90, 100)).toBeCloseTo(10, 6);
    expect(etaErrorPct(100, 0)).toBe(0); // guard
  });
});
