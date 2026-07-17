/**
 * engine/downwind.ts — downwind point-to-point endpoints + return-service ranking (WR-026,
 * PRODUCT_SPEC §1 lever 5). Pure.
 *
 * The ONE geometry where tailwind is unbounded: ride one way toward a downwind station and take
 * transit back. We select stations inside the target distance band AND the downwind arc, then rank
 * by how much of the ride is tailwind × how good the return service is. All arc math lives here
 * (per the story's technical note); network I/O (route + Digitransit) stays in adapters/state.
 */
import type { LatLon } from '../domain';
import { bearingDeg, haversineM, smallestAngle } from './geometry';
import type { CandidateAnalysis } from './scoring';

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Transit modes served, e.g. ['rail'] or ['rail','bus']. */
  modes: string[];
}

export interface DownwindEndpoint {
  station: Station;
  distanceM: number;
  bearingDeg: number;
  /** Angular offset of the straight-line bearing from dead downwind (0 = pure tailwind heading). */
  offWindDeg: number;
}

export interface DownwindArcOptions {
  targetM: number;
  /** Downwind travel direction (wind_to = wind_from + 180). */
  windToDeg: number;
  /** Distance-band tolerance (default 0.20 = ±20%). */
  distTolPct?: number;
  /** Half-angle of the downwind arc (default 35°). */
  arcDeg?: number;
}

export const DOWNWIND_DIST_TOL = 0.2;
export const DOWNWIND_ARC_DEG = 35;

/** Stations inside target±tol distance AND the downwind ±arc, nearest-to-dead-downwind first. */
export function downwindEndpoints(
  start: LatLon,
  stations: Station[],
  opts: DownwindArcOptions,
): DownwindEndpoint[] {
  const distTol = opts.distTolPct ?? DOWNWIND_DIST_TOL;
  const arc = opts.arcDeg ?? DOWNWIND_ARC_DEG;
  const minM = opts.targetM * (1 - distTol);
  const maxM = opts.targetM * (1 + distTol);

  const out: DownwindEndpoint[] = [];
  for (const station of stations) {
    const to = { lat: station.lat, lon: station.lon };
    const distanceM = haversineM(start, to);
    if (distanceM < minM || distanceM > maxM) continue;
    const bDeg = bearingDeg(start, to);
    const offWindDeg = smallestAngle(bDeg, opts.windToDeg);
    if (offWindDeg > arc) continue;
    out.push({ station, distanceM, bearingDeg: bDeg, offWindDeg });
  }
  // Closest to dead-downwind first; ties broken by station id for determinism.
  return out.sort(
    (a, b) => a.offWindDeg - b.offWindDeg || a.station.id.localeCompare(b.station.id),
  );
}

/** Fraction of ride TIME spent with a tailwind (v_par > 0) — the one-way payoff (weight by time). */
export function tailwindTimeShare(analysis: CandidateAnalysis): number {
  const total = analysis.totalTimeS;
  if (total <= 0) return 0;
  let tail = 0;
  for (const sa of analysis.segments) if (sa.wind.vParMs > 0) tail += sa.timeS;
  return tail / total;
}

/**
 * Return-service frequency factor 0..1 from the median return headway (minutes). Frequent service
 * approaches 1, sparse service decays toward 0; unknown / no service ⇒ 0. `60/(60+headway)`:
 * 10 min ≈ 0.86, 30 min ≈ 0.67, 60 min ≈ 0.50, 120 min ≈ 0.33.
 */
export function frequencyFactor(headwayMin: number | null): number {
  if (headwayMin === null || headwayMin <= 0) return 0;
  return 60 / (60 + headwayMin);
}

/** Downwind rank: tailwind share of the ride × how good the return service is (both 0..1). */
export function rankDownwind(tailwindShare: number, freqFactor: number): number {
  return tailwindShare * freqFactor;
}
