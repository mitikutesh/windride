import { describe, expect, it } from 'vitest';
import type { CandidateRoute, Segment, WindSample } from '../domain';
import { scoreCandidates, type ScoredCandidate } from '../engine/scoring';
import {
  candidateToGpxTrack,
  classifyWindKind,
  routeToRibbon,
  routeToWindGeoJSON,
} from './routeGeo';
import { WIND_COLORS } from './windColors';

function candidate(id: string, bearing: number, n = 10): CandidateRoute {
  const seg: Segment = {
    a: { lat: 60, lon: 24 },
    b: { lat: 60.001, lon: 24.001 },
    lengthM: 1000,
    bearingDeg: bearing,
    gradePct: 0,
    surface: 'paved',
    exposure: 1,
  };
  return {
    id,
    polyline: [
      { lat: 60, lon: 24 },
      { lat: 60.05, lon: 24.05 },
    ],
    segments: Array.from({ length: n }, () => ({ ...seg })),
    distanceM: n * 1000,
    ascentM: 0,
    steps: [],
  };
}
function steady(n: number): WindSample[][] {
  const s: WindSample = {
    windMs: 8,
    windFromDeg: 225,
    gustMs: 12,
    precipProb: 10,
    tempC: 17,
    time: '2026-07-10T17:00',
  };
  return Array.from({ length: n }, () => [s, s, s]);
}
function scoredOne(bearing: number): ScoredCandidate {
  return scoreCandidates([{ candidate: candidate('X', bearing), windBySegment: steady(10) }], {
    targetDistanceM: 10_000,
  }).ranked[0];
}

describe('classifyWindKind', () => {
  it('splits tail / cross / head by delta', () => {
    expect(classifyWindKind(0)).toBe('tail');
    expect(classifyWindKind(60)).toBe('tail');
    expect(classifyWindKind(90)).toBe('cross');
    expect(classifyWindKind(120)).toBe('head');
    expect(classifyWindKind(180)).toBe('head');
  });
});

describe('routeToWindGeoJSON', () => {
  it('emits one feature per segment with a colour matching its kind', () => {
    const sc = scoredOne(45); // tailwind (from SW)
    const fc = routeToWindGeoJSON(sc);
    expect(fc.features).toHaveLength(sc.analysis.segments.length);
    for (const f of fc.features) {
      expect(f.properties.color).toBe(WIND_COLORS[f.properties.kind]);
      expect(f.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    }
    // Coordinates are [lon, lat] (GeoJSON order), not transposed.
    expect(fc.features[0].geometry.coordinates[0]).toEqual([24, 60]);
    expect(fc.features[0].properties.kind).toBe('tail');
  });

  it('colours a headwind route head and a crosswind route cross', () => {
    expect(routeToWindGeoJSON(scoredOne(225)).features[0].properties.kind).toBe('head');
    expect(routeToWindGeoJSON(scoredOne(135)).features[0].properties.kind).toBe('cross');
  });
});

describe('routeToRibbon', () => {
  it('produces one ordered segment per route segment, fractions summing to ~1', () => {
    const sc = scoredOne(45);
    const ribbon = routeToRibbon(sc);
    expect(ribbon).toHaveLength(sc.analysis.segments.length);
    const sum = ribbon.reduce((acc, r) => acc + r.fraction, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
});

describe('candidateToGpxTrack', () => {
  it('emits segment endpoints (n+1 points) with elevation and a WindRide creator', () => {
    const sc = scoredOne(45);
    const track = candidateToGpxTrack(sc, 'My route');
    expect(track.creator).toBe('WindRide');
    expect(track.name).toBe('My route');
    expect(track.points).toHaveLength(sc.analysis.segments.length + 1);
    expect(track.points[0].ele).toBe(0);
    expect(track.points.every((p) => p.ele !== undefined)).toBe(true);
  });
});
