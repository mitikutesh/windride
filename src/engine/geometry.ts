/**
 * engine/geometry.ts — pure geometry toolbox (WR-006).
 *
 * Polyline -> ~300 m Segments (SCORING_SPEC §1) plus angle helpers and a symmetric overlap
 * ratio for candidate dedupe (WR-005). Pure: no I/O, no DOM, no Date, no randomness
 * (CLAUDE.md rule 4). turf is used internally but never leaks into the public API — callers
 * pass/receive plain LatLon and numbers.
 */
import {
  along,
  bearing as turfBearing,
  distance as turfDistance,
  length as turfLength,
  lineString,
  pointToLineDistance,
} from '@turf/turf';
import type { LatLon, Segment, Surface } from '../domain';
import { SEGMENT_MAX_M, SEGMENT_MIN_M, SEGMENT_TARGET_M } from './constants';

// --- angle helpers -------------------------------------------------------------------------
export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}
export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}
/** Normalise any degree value to [0, 360). */
export function normalizeDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}
/** Smallest absolute angular difference between two bearings, 0..180. */
export function smallestAngle(a: number, b: number): number {
  const diff = Math.abs(normalizeDeg(a) - normalizeDeg(b)) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// --- distance / bearing (turf-wrapped) -----------------------------------------------------
const toCoord = (p: LatLon): [number, number] => [p.lon, p.lat];

/** Great-circle distance in metres. */
export function haversineM(a: LatLon, b: LatLon): number {
  return turfDistance(toCoord(a), toCoord(b), { units: 'meters' });
}

/** Initial bearing a->b, 0..360 clockwise from true north. */
export function bearingDeg(a: LatLon, b: LatLon): number {
  return normalizeDeg(turfBearing(toCoord(a), toCoord(b)));
}

/** Total polyline length in metres. */
export function polylineLengthM(pts: LatLon[]): number {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += haversineM(pts[i - 1], pts[i]);
  return sum;
}

// --- resampling ----------------------------------------------------------------------------
export interface RouteGeometry {
  polyline: LatLon[];
  /** Per-point elevation in metres (length == polyline.length). Missing => grade 0. */
  elevations?: number[];
  /** Per-EDGE surface (length == polyline.length - 1). */
  surfaces?: Array<Surface | undefined>;
  /** Per-EDGE wayClass label (length == polyline.length - 1). */
  wayClasses?: Array<string | undefined>;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Pick the value covering the most distance within [d0, d1] over per-edge values. */
function majorityByDistance<T>(
  cum: number[],
  values: Array<T | undefined> | undefined,
  d0: number,
  d1: number,
): T | undefined {
  if (!values) return undefined;
  const acc = new Map<T, number>();
  for (let e = 0; e < values.length; e++) {
    const v = values[e];
    if (v === undefined) continue;
    const overlap = Math.min(cum[e + 1], d1) - Math.max(cum[e], d0);
    if (overlap > 0) acc.set(v, (acc.get(v) ?? 0) + overlap);
  }
  let best: T | undefined;
  let bestLen = 0;
  for (const [v, len] of acc) {
    if (len > bestLen) {
      best = v;
      bestLen = len;
    }
  }
  return best;
}

/**
 * Resample a route to segments of ~targetM (clamped to [200, 500]). Σ lengths == route distance.
 * Bearings 0..360 from north; grade % from elevation deltas smoothed over a 3-segment window;
 * surface/wayClass majority-carried (by distance) from the source edges.
 */
export function resample(geo: RouteGeometry, targetM: number = SEGMENT_TARGET_M): Segment[] {
  const pts = geo.polyline;
  if (pts.length < 2) return [];

  // Cumulative distance at each point.
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  if (total <= 0) return [];

  // Choose a segment count keeping each length within [MIN, MAX].
  let n = Math.max(1, Math.round(total / targetM));
  if (total / n > SEGMENT_MAX_M) n = Math.ceil(total / SEGMENT_MAX_M);
  if (n > 1 && total / n < SEGMENT_MIN_M) n = Math.max(1, Math.floor(total / SEGMENT_MIN_M));
  const segLen = total / n;

  const hasEle = Array.isArray(geo.elevations) && geo.elevations.length === pts.length;

  const interp = (d: number): { p: LatLon; ele: number | undefined } => {
    if (d <= 0) return { p: pts[0], ele: hasEle ? geo.elevations![0] : undefined };
    if (d >= total)
      return { p: pts[pts.length - 1], ele: hasEle ? geo.elevations![pts.length - 1] : undefined };
    let i = 0;
    while (i < cum.length - 1 && cum[i + 1] < d) i++;
    const span = cum[i + 1] - cum[i] || 1;
    const t = (d - cum[i]) / span;
    return {
      p: { lat: lerp(pts[i].lat, pts[i + 1].lat, t), lon: lerp(pts[i].lon, pts[i + 1].lon, t) },
      ele: hasEle ? lerp(geo.elevations![i], geo.elevations![i + 1], t) : undefined,
    };
  };

  // First pass: raw grade per segment.
  const raw: Array<{ a: LatLon; b: LatLon; d0: number; d1: number; grade: number }> = [];
  for (let k = 0; k < n; k++) {
    const d0 = k * segLen;
    const d1 = (k + 1) * segLen;
    const a = interp(d0);
    const b = interp(d1);
    let grade = 0;
    if (a.ele !== undefined && b.ele !== undefined) grade = ((b.ele - a.ele) / segLen) * 100;
    raw.push({ a: a.p, b: b.p, d0, d1, grade });
  }

  // Second pass: smooth grade over a 3-segment window (kills single-point elevation spikes).
  const segments: Segment[] = raw.map((r, k) => {
    const lo = Math.max(0, k - 1);
    const hi = Math.min(raw.length - 1, k + 1);
    let g = 0;
    for (let j = lo; j <= hi; j++) g += raw[j].grade;
    const gradePct = g / (hi - lo + 1);
    return {
      a: r.a,
      b: r.b,
      lengthM: segLen,
      bearingDeg: bearingDeg(r.a, r.b),
      gradePct,
      surface: majorityByDistance(cum, geo.surfaces, r.d0, r.d1),
      wayClass: majorityByDistance(cum, geo.wayClasses, r.d0, r.d1),
      exposure: 1.0, // default until the Epic 3 exposure grid (WR-019)
    };
  });
  return segments;
}

// --- extras expansion (for WR-005) ---------------------------------------------------------
/** ORS extra_info range [startPointIdx, endPointIdx, code]. */
export type ExtraRange = readonly [start: number, end: number, code: number];

/**
 * Expand ORS extra_info ranges (over point indices) into a per-EDGE array of length
 * pointCount-1. Edge e (point e -> e+1) takes the code of the range with start <= e < end.
 * This is the off-by-one trap ORS warns about: ranges are point-indexed but apply to edges.
 */
export function expandRangesToEdges<T>(
  ranges: readonly ExtraRange[],
  pointCount: number,
  map: (code: number) => T,
  fallback: T,
): T[] {
  const edges = Math.max(0, pointCount - 1);
  const out: T[] = new Array(edges).fill(fallback);
  for (const [start, end, code] of ranges) {
    for (let e = Math.max(0, start); e < Math.min(edges, end); e++) out[e] = map(code);
  }
  return out;
}

// --- overlap -------------------------------------------------------------------------------
export interface OverlapOptions {
  /** A sample point counts as "shared" if within this many metres of the other line. */
  bufferM?: number;
  /** Spacing between sample points along each line. */
  sampleM?: number;
}

function fractionWithin(a: LatLon[], b: LatLon[], bufferM: number, sampleM: number): number {
  if (a.length < 2 || b.length < 2) return 0;
  const lineA = lineString(a.map(toCoord));
  const lineB = lineString(b.map(toCoord));
  const lenA = turfLength(lineA, { units: 'meters' });
  if (lenA <= 0) return 0;
  let total = 0;
  let inside = 0;
  for (let d = 0; d <= lenA; d += sampleM) {
    const pt = along(lineA, d, { units: 'meters' });
    total++;
    if (pointToLineDistance(pt, lineB, { units: 'meters' }) <= bufferM) inside++;
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Symmetric shared-geometry ratio in 0..1 (WR-005 dedupe). 1 = (near) identical, 0 = disjoint.
 * Averages "fraction of A within buffer of B" and vice versa so it is order-independent.
 */
export function overlapRatio(a: LatLon[], b: LatLon[], opts: OverlapOptions = {}): number {
  const bufferM = opts.bufferM ?? 30;
  const sampleM = opts.sampleM ?? 50;
  const ab = fractionWithin(a, b, bufferM, sampleM);
  const ba = fractionWithin(b, a, bufferM, sampleM);
  return (ab + ba) / 2;
}
