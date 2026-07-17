/**
 * engine/feelsProfile.ts — the wind-equivalent elevation profile (WR-022, PRODUCT_SPEC §5). Pure.
 *
 * "The most honest chart in cycling": alongside the real elevation profile, a wind-adjusted profile
 * that renders headwind as the climb it really feels like. For each segment the equivalent grade is
 *   grade' = grade + FEEL_K_PCT · (−v_par) / FEEL_REF_WIND_MS
 * so a direct headwind of FEEL_REF_WIND_MS (8 m/s) adds FEEL_K_PCT (+2.5 %) of "feel"; a tailwind
 * subtracts. Feels-grade is smoothed over a 3-segment window, then integrated into a virtual profile.
 */
import type { SegmentAnalysis } from './scoring';
import { classifyWindKind, type WindKind } from './wind';

/** Equivalent-grade feel added by a direct headwind of the reference speed (percentage points). */
export const FEEL_K_PCT = 2.5;
/** Reference headwind speed (m/s) at which the feel equals FEEL_K_PCT. */
export const FEEL_REF_WIND_MS = 8;

/** Wind-equivalent grade: actual grade plus a headwind penalty (tailwind ⇒ negative). */
export function equivalentGrade(gradePct: number, vParMs: number): number {
  return gradePct + (FEEL_K_PCT * -vParMs) / FEEL_REF_WIND_MS;
}

export interface FeelsPoint {
  distanceM: number;
  /** Actual cumulative elevation (relative to the start, m). */
  eleM: number;
  /** Wind-equivalent cumulative elevation (m). */
  feelsEleM: number;
  gradePct: number;
  feelsGradePct: number;
  kind: WindKind;
}

/**
 * Build the actual + wind-equivalent profiles as ≤ maxPoints points (boundary points, downsampled).
 * Point 0 is the start (both elevations 0); each later point sits at a segment boundary.
 */
export function buildFeelsProfile(segments: SegmentAnalysis[], maxPoints = 200): FeelsPoint[] {
  if (segments.length === 0) return [];

  // Smooth ONLY the wind contribution over a 3-segment window (kills single-segment spikes) — not
  // the base grade, so still air yields a feels-like profile identical to the actual one.
  const windExtra = segments.map((sa) => (FEEL_K_PCT * -sa.wind.vParMs) / FEEL_REF_WIND_MS);
  const feelsGrade = segments.map((sa, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(windExtra.length - 1, i + 1);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += windExtra[j];
    return sa.seg.gradePct + sum / (hi - lo + 1);
  });

  const points: FeelsPoint[] = [
    { distanceM: 0, eleM: 0, feelsEleM: 0, gradePct: 0, feelsGradePct: 0, kind: 'cross' },
  ];
  let dist = 0;
  let ele = 0;
  let feels = 0;
  segments.forEach((sa, i) => {
    dist += sa.seg.lengthM;
    ele += (sa.seg.gradePct / 100) * sa.seg.lengthM;
    feels += (feelsGrade[i] / 100) * sa.seg.lengthM;
    points.push({
      distanceM: dist,
      eleM: ele,
      feelsEleM: feels,
      gradePct: sa.seg.gradePct,
      feelsGradePct: feelsGrade[i],
      kind: classifyWindKind(sa.wind.deltaDeg),
    });
  });

  return downsample(points, maxPoints);
}

/** Keep the first + last points and an evenly-strided subset in between, ≤ maxPoints total. */
function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const stride = Math.ceil((arr.length - 1) / (maxPoints - 1));
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}
