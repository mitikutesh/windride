/**
 * engine/novelty.ts — "roads you haven't ridden" scoring (WR-028, SCORING_SPEC §6). Pure.
 *
 * Every ridden road is remembered locally as the geohash-7 of its midpoints (engine/geohash.ts).
 * A candidate's Novelty is the share of its LENGTH whose segment midpoints fall in cells you've
 * never ridden — a small bonus for exploration, from your own recordings only (never planned-but-
 * unridden routes). No social layer, no sharing (out of scope).
 */
import type { LatLon } from '../domain';
import { encodeGeohash, GEOHASH_PRECISION } from './geohash';
import { segmentMidpoint } from './geometry';
import type { CandidateAnalysis } from './scoring';

/** A geohash-7 cell is ≈ 153 m across — the rough km one ridden edge represents. */
export const GEOHASH7_CELL_KM = 0.153;

/** Share of a candidate's length on roads NOT in the ridden set (1 = all new). */
export function noveltyShare(
  analysis: CandidateAnalysis,
  ridden: ReadonlySet<string>,
  precision = GEOHASH_PRECISION,
): number {
  const total = analysis.segments.reduce((s, sa) => s + sa.seg.lengthM, 0);
  if (total <= 0) return 1;
  let newLen = 0;
  for (const sa of analysis.segments) {
    const mid = segmentMidpoint(sa.seg);
    if (!ridden.has(encodeGeohash(mid.lat, mid.lon, precision))) newLen += sa.seg.lengthM;
  }
  return newLen / total;
}

/** The geohash-7 cells a recorded ride touched (consecutive-fix midpoints), for merging into idb. */
export function trackEdges(points: LatLon[], precision = GEOHASH_PRECISION): Set<string> {
  const edges = new Set<string>();
  if (points.length === 1) {
    edges.add(encodeGeohash(points[0].lat, points[0].lon, precision));
    return edges;
  }
  for (let i = 1; i < points.length; i++) {
    const midLat = (points[i - 1].lat + points[i].lat) / 2;
    const midLon = (points[i - 1].lon + points[i].lon) / 2;
    edges.add(encodeGeohash(midLat, midLon, precision));
  }
  return edges;
}

/** Approximate unique km explored from the ridden-edge set (Settings display). */
export function uniqueKm(ridden: ReadonlySet<string>): number {
  return ridden.size * GEOHASH7_CELL_KM;
}
