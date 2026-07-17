/**
 * ui/routeGeo.ts — pure helpers turning a scored candidate into map/ribbon data (WR-009).
 */
import { haversineM } from '../engine/geometry';
import type { ScoredCandidate } from '../engine/scoring';
import type { RibbonSegment, WindKind } from './components/ribbon';
import { windColor } from './windColors';

/** Classify a segment's wind relationship from the along/cross angle (delta 0..180). */
export function classifyWindKind(deltaDeg: number): WindKind {
  if (deltaDeg <= 60) return 'tail';
  if (deltaDeg >= 120) return 'head';
  return 'cross';
}

export interface WindLineFeature {
  type: 'Feature';
  properties: { kind: WindKind; color: string };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}
export interface WindFeatureCollection {
  type: 'FeatureCollection';
  features: WindLineFeature[];
}

/**
 * One LineString feature per segment, coloured by wind relationship (per-feature colour so the
 * whole route is a single GeoJSON source, not N layers — WR-009 perf requirement).
 */
export function routeToWindGeoJSON(scored: ScoredCandidate): WindFeatureCollection {
  const poly = scored.candidate.polyline;
  // Cumulative distance along the source polyline, so each segment feature can include the
  // ORIGINAL intermediate vertices between its boundaries (a straight a->b chord cuts corners).
  const cum: number[] = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + haversineM(poly[i - 1], poly[i]));

  let d0 = 0;
  const features = scored.analysis.segments.map((sa) => {
    const d1 = d0 + sa.seg.lengthM;
    const mid: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      if (cum[i] > d0 + 1e-6 && cum[i] < d1 - 1e-6) mid.push([poly[i].lon, poly[i].lat]);
    }
    d0 = d1;
    const kind = classifyWindKind(sa.wind.deltaDeg);
    return {
      type: 'Feature' as const,
      properties: { kind, color: windColor(kind) },
      geometry: {
        type: 'LineString' as const,
        coordinates: [[sa.seg.a.lon, sa.seg.a.lat], ...mid, [sa.seg.b.lon, sa.seg.b.lat]] as [
          number,
          number,
        ][],
      },
    };
  });
  return { type: 'FeatureCollection', features };
}

/** Time-weighted wind story bar segments in route order (feeds WindRibbon). */
export function routeToRibbon(scored: ScoredCandidate): RibbonSegment[] {
  const total = scored.analysis.totalTimeS || 1;
  return scored.analysis.segments.map((sa) => ({
    fraction: sa.timeS / total,
    kind: classifyWindKind(sa.wind.deltaDeg),
  }));
}
