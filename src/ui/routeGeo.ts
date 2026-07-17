/**
 * ui/routeGeo.ts — pure helpers turning a scored candidate into map/ribbon data (WR-009).
 */
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
  return {
    type: 'FeatureCollection',
    features: scored.analysis.segments.map((sa) => {
      const kind = classifyWindKind(sa.wind.deltaDeg);
      return {
        type: 'Feature',
        properties: { kind, color: windColor(kind) },
        geometry: {
          type: 'LineString',
          coordinates: [
            [sa.seg.a.lon, sa.seg.a.lat],
            [sa.seg.b.lon, sa.seg.b.lat],
          ],
        },
      };
    }),
  };
}

/** Time-weighted wind story bar segments in route order (feeds WindRibbon). */
export function routeToRibbon(scored: ScoredCandidate): RibbonSegment[] {
  const total = scored.analysis.totalTimeS || 1;
  return scored.analysis.segments.map((sa) => ({
    fraction: sa.timeS / total,
    kind: classifyWindKind(sa.wind.deltaDeg),
  }));
}
