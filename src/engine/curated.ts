/**
 * engine/curated.ts — pick which curated catalog routes are worth scoring today (WR-052).
 *
 * Pure and I/O-free: catalog entries in, a short shortlist out. This is a FILTER, not a scorer —
 * it decides which real routes are near enough and long enough to be candidates, and the existing
 * wind/shelter/safety engine (scoreCandidates via scoreBuiltRoutes) then ranks them exactly as it
 * ranks generated ones. Curation tier never enters here or there: it is display provenance only.
 */
import type { CuratedRoute, LatLon } from '../domain';
import { deg2rad } from './geometry';

/** Client-side defaults from DEC-060. */
export const CURATED_DEFAULTS = {
  /** A route counts as "near me" when its line passes within this of the start. */
  maxStartDistanceM: 5_000,
  /** Length band around the target distance — a fixed real route can't be reshaped to fit. */
  minLengthRatio: 0.6,
  maxLengthRatio: 1.6,
  /** Never score more than this many (keeps one weather call and a readable top-3). */
  limit: 3,
} as const;

export interface CuratedSelectOptions {
  start: LatLon;
  targetKm: number;
  maxStartDistanceM?: number;
  minLengthRatio?: number;
  maxLengthRatio?: number;
  limit?: number;
}

export interface CuratedPick {
  route: CuratedRoute;
  /** Shortest distance from the start to any point ON the route line, in metres. */
  startDistanceM: number;
}

const M_PER_DEG_LAT = 110574;

/**
 * Perpendicular distance from a point to a polyline, in metres. Uses a local equirectangular
 * projection about the query point: over the ≤5 km radius that matters here the error is far below
 * the metre, and it avoids a great-circle cross-track formula for a strictly local question.
 */
export function distanceToPolylineM(point: LatLon, line: LatLon[]): number {
  if (line.length === 0) return Infinity;
  const kx = M_PER_DEG_LAT * Math.cos(deg2rad(point.lat));
  const x = (p: LatLon) => (p.lon - point.lon) * kx;
  const y = (p: LatLon) => (p.lat - point.lat) * M_PER_DEG_LAT;
  if (line.length === 1) return Math.hypot(x(line[0]), y(line[0]));

  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = x(line[i - 1]);
    const ay = y(line[i - 1]);
    const bx = x(line[i]);
    const by = y(line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    // Project the origin (the query point) onto the segment, clamped to its ends.
    const t = lenSq > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

/** Cheap reject: is the start outside the route's bbox grown by `padM`? */
function outsidePaddedBbox(route: CuratedRoute, start: LatLon, padM: number): boolean {
  const padLat = padM / M_PER_DEG_LAT;
  const padLon = padM / Math.max(1, M_PER_DEG_LAT * Math.cos(deg2rad(start.lat)));
  const b = route.bbox;
  return (
    start.lat < b.minLat - padLat ||
    start.lat > b.maxLat + padLat ||
    start.lon < b.minLon - padLon ||
    start.lon > b.maxLon + padLon
  );
}

/**
 * Shortlist the catalog for one plan: routes whose line passes within `maxStartDistanceM` of the
 * start AND whose length sits inside the ratio band around the target distance.
 *
 * Order: closest length fit first, in 5 % buckets, then the nearer start wins the tie. Bucketing
 * (rather than blending distance and length into one number) keeps the reason a route was picked
 * explainable — "it fits your distance, and of the equally good fits it starts nearest".
 */
export function selectCuratedRoutes(
  routes: CuratedRoute[],
  opts: CuratedSelectOptions,
): CuratedPick[] {
  const maxStartDistanceM = opts.maxStartDistanceM ?? CURATED_DEFAULTS.maxStartDistanceM;
  const minRatio = opts.minLengthRatio ?? CURATED_DEFAULTS.minLengthRatio;
  const maxRatio = opts.maxLengthRatio ?? CURATED_DEFAULTS.maxLengthRatio;
  const limit = opts.limit ?? CURATED_DEFAULTS.limit;
  if (opts.targetKm <= 0) return [];

  const picks: CuratedPick[] = [];
  for (const route of routes) {
    const ratio = route.lengthKm / opts.targetKm;
    if (ratio < minRatio || ratio > maxRatio) continue;
    if (outsidePaddedBbox(route, opts.start, maxStartDistanceM)) continue;
    const startDistanceM = distanceToPolylineM(opts.start, route.polyline);
    if (startDistanceM > maxStartDistanceM) continue;
    picks.push({ route, startDistanceM });
  }

  return picks
    .sort((a, b) => {
      const devA = Math.round(Math.abs(a.route.lengthKm / opts.targetKm - 1) / 0.05);
      const devB = Math.round(Math.abs(b.route.lengthKm / opts.targetKm - 1) / 0.05);
      if (devA !== devB) return devA - devB;
      if (a.startDistanceM !== b.startDistanceM) return a.startDistanceM - b.startDistanceM;
      return a.route.id.localeCompare(b.route.id);
    })
    .slice(0, limit);
}

export interface CuratedCoverage {
  /** Closest catalog route to the start, whatever its length (null on an empty catalog). */
  nearest: CuratedPick | null;
  /** How many catalog routes pass within the radius, whatever their length. */
  withinRadius: number;
  /** Of those, the one whose length is closest to the target — the best near-miss to name. */
  closestFit: CuratedPick | null;
}

/**
 * Why the shortlist came back empty. "No curated routes" is two very different problems — nothing
 * mapped near here, or nothing near here at THIS distance — and the rider can only act on the right
 * one. Pure, so the store can turn it into copy without re-deriving distances.
 */
export function curatedCoverage(
  routes: CuratedRoute[],
  opts: CuratedSelectOptions,
): CuratedCoverage {
  const radiusM = opts.maxStartDistanceM ?? CURATED_DEFAULTS.maxStartDistanceM;
  let nearest: CuratedPick | null = null;
  let closestFit: CuratedPick | null = null;
  let bestFit = Infinity;
  let withinRadius = 0;

  for (const route of routes) {
    const startDistanceM = distanceToPolylineM(opts.start, route.polyline);
    if (!nearest || startDistanceM < nearest.startDistanceM) nearest = { route, startDistanceM };
    if (startDistanceM > radiusM) continue;
    withinRadius++;
    const fit = opts.targetKm > 0 ? Math.abs(route.lengthKm / opts.targetKm - 1) : Infinity;
    if (fit < bestFit) {
      bestFit = fit;
      closestFit = { route, startDistanceM };
    }
  }
  return { nearest, withinRadius, closestFit };
}

/** Provenance label for a curated route — shown, never scored. */
export function curationLabel(route: CuratedRoute): string {
  const tier =
    route.tier === 'icn'
      ? 'International cycle route'
      : route.tier === 'ncn'
        ? 'National cycle route'
        : route.tier === 'rcn'
          ? 'Regional cycle route'
          : 'Curated route';
  const source = route.source === 'osm' ? 'signed on OpenStreetMap' : 'Bikeland';
  return `${tier} · ${source}`;
}

/**
 * Distance tolerance the scorer should use for curated candidates. The default ±15 % hard filter
 * exists because a GENERATED round trip can be re-generated to hit the target; a signed route's
 * length is a fact of the world, so rejecting it outright would silently empty the results after
 * the rider explicitly asked for curated routes. The distance sub-score still ranks by closeness
 * to target, so an off-target route can be shown but never wins on distance.
 */
export function curatedDistanceTolerancePct(
  band: { minLengthRatio?: number; maxLengthRatio?: number } = {},
): number {
  const minRatio = band.minLengthRatio ?? CURATED_DEFAULTS.minLengthRatio;
  const maxRatio = band.maxLengthRatio ?? CURATED_DEFAULTS.maxLengthRatio;
  return Math.max(1 - minRatio, maxRatio - 1);
}
