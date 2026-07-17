/**
 * engine/geometry.ts — pure geometry toolbox (WR-006).
 *
 * Polyline -> ~300 m Segments (SCORING_SPEC §1) plus angle helpers and a symmetric overlap
 * ratio for candidate dedupe (WR-005). Pure: no I/O, no DOM, no Date, no randomness
 * (CLAUDE.md rule 4). turf is used internally for distance/bearing but never leaks into the
 * public API — callers pass/receive plain LatLon and numbers.
 */
import { bearing as turfBearing, distance as turfDistance } from '@turf/turf';
import type { CandidateRoute, LatLon, Segment, Surface, TurnStep } from '../domain';
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
  /** Per-point elevation in metres (length MUST equal polyline.length). Absent => grade 0. */
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
 * Length-weighted circular mean of the edge bearings within [d0, d1]. This beats a chord
 * (start->end) bearing on curves, and on a fold (out-and-back turnaround) where the chord
 * collapses to ~0 it falls back to the dominant (longest) edge's bearing instead of garbage.
 */
function segmentBearing(edgeBearings: number[], cum: number[], d0: number, d1: number): number {
  let sumSin = 0;
  let sumCos = 0;
  let longestLen = 0;
  let longestBearing = 0;
  for (let e = 0; e < edgeBearings.length; e++) {
    const overlap = Math.min(cum[e + 1], d1) - Math.max(cum[e], d0);
    if (overlap <= 0) continue;
    const br = edgeBearings[e];
    sumSin += Math.sin(deg2rad(br)) * overlap;
    sumCos += Math.cos(deg2rad(br)) * overlap;
    if (overlap > longestLen) {
      longestLen = overlap;
      longestBearing = br;
    }
  }
  if (Math.hypot(sumSin, sumCos) < 1e-6) return normalizeDeg(longestBearing);
  return normalizeDeg(rad2deg(Math.atan2(sumSin, sumCos)));
}

/**
 * Resample a route to segments of ~targetM. Lengths are within [200, 500] when the route is
 * at least 200 m long (else a single segment of the whole length); Σ lengths == route distance.
 * Bearings 0..360 (circular-mean of edge bearings, fold-safe); grade % from elevation deltas
 * smoothed over a 3-segment window; surface/wayClass majority-carried by distance from edges.
 */
export function resample(geo: RouteGeometry, targetM: number = SEGMENT_TARGET_M): Segment[] {
  const pts = geo.polyline;
  if (pts.length < 2) return [];
  if (geo.elevations && geo.elevations.length !== pts.length) {
    // Corrupt input (e.g. an adapter off-by-one) must be loud, not silently graded 0.
    throw new Error(
      `resample: elevations length ${geo.elevations.length} != polyline length ${pts.length}`,
    );
  }

  // Cumulative distance and per-edge bearing.
  const cum: number[] = [0];
  const edgeBearings: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
    edgeBearings.push(bearingDeg(pts[i - 1], pts[i]));
  }
  const total = cum[cum.length - 1];
  if (total <= 0) return [];

  // Choose a segment count keeping each length within [MIN, MAX] (when total >= MIN).
  let n = Math.max(1, Math.round(total / targetM));
  if (total / n > SEGMENT_MAX_M) n = Math.ceil(total / SEGMENT_MAX_M);
  if (n > 1 && total / n < SEGMENT_MIN_M) n = Math.max(1, Math.floor(total / SEGMENT_MIN_M));
  const segLen = total / n;

  const hasEle = Array.isArray(geo.elevations);

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
  return raw.map((r, k) => {
    const lo = Math.max(0, k - 1);
    const hi = Math.min(raw.length - 1, k + 1);
    let g = 0;
    for (let j = lo; j <= hi; j++) g += raw[j].grade;
    return {
      a: r.a,
      b: r.b,
      lengthM: segLen,
      bearingDeg: segmentBearing(edgeBearings, cum, r.d0, r.d1),
      gradePct: g / (hi - lo + 1),
      surface: majorityByDistance(cum, geo.surfaces, r.d0, r.d1),
      wayClass: majorityByDistance(cum, geo.wayClasses, r.d0, r.d1),
      exposure: 1.0, // default until the Epic 3 exposure grid (WR-019)
    };
  });
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

// --- reroute splice (WR-015) ---------------------------------------------------------------
/** ORS "Arrive at destination" maneuver code — stripped from a reroute leg (it ends mid-route). */
const ORS_ARRIVAL_TYPE = 10;

/**
 * Splice a reroute leg into a route at rejoin distance `atM` (NAVIGATION_SPEC §3). Returns the
 * forward route the navigator follows from the leg's start: [leg] + [original route beyond atM].
 * The stretch before atM (the divergence + skipped section) is dropped; everything from atM to the
 * finish is preserved unchanged, so the finish point is guaranteed identical and remaining distance
 * never shortcuts to the finish. Pure.
 *
 * `atM` is the rejoin distance along `route` (progress + 500 m); `leg` runs from the rider's current
 * position to trackPointAt(atM). Cumulative distances and step waypoint indices are recomputed once.
 */
export function spliceRoute(
  route: CandidateRoute,
  atM: number,
  leg: CandidateRoute,
): CandidateRoute {
  const pts = route.polyline;
  if (pts.length < 2) return leg; // degenerate route: nothing downstream to preserve

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversineM(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const at = Math.max(0, Math.min(total, atM));

  // First route point at or beyond the rejoin distance; downstream geometry starts here.
  let idxAfter = pts.length - 1;
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] >= at) {
      idxAfter = i;
      break;
    }
  }

  const polyline = [...leg.polyline, ...pts.slice(idxAfter)];

  // Downstream segments: keep everything from `at` onward. The segment straddling `at` is TRIMMED
  // (not dropped) so Σ segment lengths still equals distanceM — the ETA/wind model tiles the route.
  const downstreamSegs: Segment[] = [];
  let segStart = 0;
  for (const s of route.segments) {
    const segEnd = segStart + s.lengthM;
    if (segEnd > at) {
      if (segStart >= at) {
        downstreamSegs.push(s);
      } else {
        const frac = (at - segStart) / (s.lengthM || 1);
        downstreamSegs.push({
          ...s,
          a: {
            lat: s.a.lat + (s.b.lat - s.a.lat) * frac,
            lon: s.a.lon + (s.b.lon - s.a.lon) * frac,
          },
          lengthM: segEnd - at,
        });
      }
    }
    segStart = segEnd;
  }
  // Drop the leg's own arrival step — the leg ends AT the rejoin, not the finish; announcing
  // "You have arrived" there would be wrong. The original route's arrival is preserved downstream.
  const legSteps = (leg.steps ?? []).filter((st) => st.type !== ORS_ARRIVAL_TYPE);
  const segments = [...leg.segments, ...downstreamSegs];

  // Re-index downstream steps into the new polyline; leg steps keep their 0-based indices.
  const legLen = leg.polyline.length;
  const downstreamSteps = (route.steps ?? [])
    .filter(
      (st): st is TurnStep & { wayPoints: [number, number] } =>
        st.wayPoints !== undefined && st.wayPoints[0] >= idxAfter,
    )
    .map((st) => ({
      ...st,
      wayPoints: [st.wayPoints[0] - idxAfter + legLen, st.wayPoints[1] - idxAfter + legLen] as [
        number,
        number,
      ],
    }));
  const steps = [...legSteps, ...downstreamSteps];

  const downstreamAscent = downstreamSegs.reduce(
    (sum, s) => sum + Math.max(0, (s.gradePct / 100) * s.lengthM),
    0,
  );

  return {
    id: `${route.id}+reroute`,
    polyline,
    segments,
    distanceM: leg.distanceM + (total - at),
    ascentM: leg.ascentM + downstreamAscent,
    steps,
  };
}

// --- overlap -------------------------------------------------------------------------------
export interface OverlapOptions {
  /** A sample point counts as "shared" if within this many metres of the other line. */
  bufferM?: number;
  /** Spacing between sample points along each line. */
  sampleM?: number;
}

/** Emit points along a polyline every `spacingM`, including both endpoints. O(points + samples). */
function sampleAlong(pts: LatLon[], spacingM: number): LatLon[] {
  if (pts.length < 2) return pts.slice();
  const out: LatLon[] = [pts[0]];
  let next = spacingM;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segLen = haversineM(a, b);
    while (segLen > 0 && next <= acc + segLen) {
      const t = (next - acc) / segLen;
      out.push({ lat: lerp(a.lat, b.lat, t), lon: lerp(a.lon, b.lon, t) });
      next += spacingM;
    }
    acc += segLen;
  }
  const last = pts[pts.length - 1];
  if (haversineM(out[out.length - 1], last) > 1e-6) out.push(last);
  return out;
}

/** Local metres-per-degree grid for a fast planar proximity index around a reference latitude. */
function spatialHash(samples: LatLon[], cellM: number, latRef: number) {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos(deg2rad(latRef));
  const buckets = new Map<string, LatLon[]>();
  const cellOf = (p: LatLon) =>
    `${Math.floor((p.lon * mLon) / cellM)},${Math.floor((p.lat * mLat) / cellM)}`;
  for (const p of samples) {
    const key = cellOf(p);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(p);
    else buckets.set(key, [p]);
  }
  return {
    within(p: LatLon, radiusM: number): boolean {
      const cx = Math.floor((p.lon * mLon) / cellM);
      const cy = Math.floor((p.lat * mLat) / cellM);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(`${cx + dx},${cy + dy}`);
          if (!bucket) continue;
          for (const q of bucket) {
            const ex = (p.lon - q.lon) * mLon;
            const ey = (p.lat - q.lat) * mLat;
            if (Math.hypot(ex, ey) <= radiusM) return true;
          }
        }
      }
      return false;
    },
  };
}

function fractionWithin(a: LatLon[], b: LatLon[], bufferM: number, sampleM: number): number {
  if (a.length < 2 || b.length < 2) return 0;
  const aSamples = sampleAlong(a, sampleM);
  // Sample B at least as densely as the buffer so "near a B sample" ≈ "near line B".
  const bSamples = sampleAlong(b, Math.min(sampleM, bufferM));
  const hash = spatialHash(bSamples, bufferM, a[0].lat);
  let inside = 0;
  for (const p of aSamples) if (hash.within(p, bufferM)) inside++;
  return aSamples.length === 0 ? 0 : inside / aSamples.length;
}

/**
 * Symmetric shared-geometry ratio in 0..1 (WR-005 dedupe). 1 = (near) identical, 0 = disjoint.
 * Averages "fraction of A within buffer of B" and vice versa so it is order-independent.
 * O(|A| + |B| + samples) via a spatial hash — fast enough for pairwise candidate comparison.
 * Note: direction-blind — a reversed loop scores ~1, so WR-005 dedupes geometry, not heading.
 */
export function overlapRatio(a: LatLon[], b: LatLon[], opts: OverlapOptions = {}): number {
  const bufferM = opts.bufferM ?? 30;
  const sampleM = opts.sampleM ?? 50;
  const ab = fractionWithin(a, b, bufferM, sampleM);
  const ba = fractionWithin(b, a, bufferM, sampleM);
  return (ab + ba) / 2;
}
