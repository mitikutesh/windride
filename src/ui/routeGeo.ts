/**
 * ui/routeGeo.ts — pure helpers turning a scored candidate into map/ribbon data (WR-009).
 */
import { haversineM } from '../engine/geometry';
import {
  SHELTER_EXPOSURE_MAX,
  type SegmentAnalysis,
  type ScoredCandidate,
} from '../engine/scoring';
import { classifyWindKind } from '../engine/wind';
import type { GpxPoint, GpxTrack } from '../utils/gpx';
import type { RibbonSegment, WindKind } from './components/ribbon';
import { windColor } from './windColors';

// classifyWindKind now lives in engine/wind (shared with the WR-016 wind HUD); re-export for
// existing WR-009 importers.
export { classifyWindKind };

/** A segment's display kind: shelter when it's inside cover, else its wind relationship. */
export function segmentKind(sa: SegmentAnalysis): WindKind {
  return sa.seg.exposure <= SHELTER_EXPOSURE_MAX ? 'shelter' : classifyWindKind(sa.wind.deltaDeg);
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
    const kind = segmentKind(sa);
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
    kind: segmentKind(sa),
  }));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Build a GPX track from a scored candidate (WR-010). Emits EVERY source polyline vertex (a bike
 * computer following coarse ~300 m chords would sit off the road) with elevation sampled from the
 * grade-integrated profile at each vertex's cumulative distance. Elevation is relative (from 0)
 * since CandidateRoute carries grade, not absolute per-point elevation (DEC-019).
 */
export function candidateToGpxTrack(scored: ScoredCandidate, name: string): GpxTrack {
  const poly = scored.candidate.polyline;
  const segs = scored.analysis.segments;
  if (poly.length === 0) return { name, creator: 'WindRide', points: [] };
  if (segs.length === 0) {
    return { name, creator: 'WindRide', points: poly.map((p) => ({ lat: p.lat, lon: p.lon })) };
  }

  // Piecewise-linear elevation profile: boundary elevations at each segment's start distance.
  const segLen = segs[0].seg.lengthM;
  const boundaryEle = [0];
  for (const sa of segs) {
    boundaryEle.push(
      boundaryEle[boundaryEle.length - 1] + (sa.seg.gradePct / 100) * sa.seg.lengthM,
    );
  }
  const total = segLen * segs.length;
  const eleAt = (dist: number): number => {
    const d = Math.max(0, Math.min(total, dist));
    const k = Math.min(segs.length - 1, Math.floor(d / segLen));
    return boundaryEle[k] + (segs[k].seg.gradePct / 100) * (d - k * segLen);
  };

  const points: GpxPoint[] = [];
  let cum = 0;
  for (let i = 0; i < poly.length; i++) {
    if (i > 0) cum += haversineM(poly[i - 1], poly[i]);
    points.push({ lat: poly[i].lat, lon: poly[i].lon, ele: round1(eleAt(cum)) });
  }
  return { name, creator: 'WindRide', points };
}
