import { describe, expect, it } from 'vitest';
import type { CuratedRoute, LatLon } from '../domain';
import {
  CURATED_DEFAULTS,
  curatedCoverage,
  curatedDistanceTolerancePct,
  curationLabel,
  distanceToPolylineM,
  selectCuratedRoutes,
} from './curated';

const M_PER_DEG_LAT = 110574;
const kx = (lat: number) => M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/** A north–south line of `lengthKm` starting at (lat, lon). */
function line(lat: number, lon: number, lengthKm: number, n = 20): LatLon[] {
  return Array.from({ length: n + 1 }, (_, i) => ({
    lat: lat + ((i / n) * lengthKm * 1000) / M_PER_DEG_LAT,
    lon,
  }));
}

function route(id: string, polyline: LatLon[], lengthKm: number): CuratedRoute {
  return {
    id,
    name: id,
    source: 'osm',
    tier: 'rcn',
    kind: 'linear',
    lengthKm,
    bbox: {
      minLat: Math.min(...polyline.map((p) => p.lat)),
      minLon: Math.min(...polyline.map((p) => p.lon)),
      maxLat: Math.max(...polyline.map((p) => p.lat)),
      maxLon: Math.max(...polyline.map((p) => p.lon)),
    },
    attribution: '© OpenStreetMap contributors (ODbL)',
    partial: false,
    polyline,
  };
}

const START: LatLon = { lat: 60.17, lon: 24.65 };

describe('distanceToPolylineM', () => {
  it('measures to the nearest point ON the line, not to its vertices', () => {
    // A 2 km east–west line 500 m north of the start; the perpendicular foot is between vertices.
    const north = 500 / M_PER_DEG_LAT;
    const seg: LatLon[] = [
      { lat: START.lat + north, lon: START.lon - 1000 / kx(START.lat) },
      { lat: START.lat + north, lon: START.lon + 1000 / kx(START.lat) },
    ];
    expect(distanceToPolylineM(START, seg)).toBeCloseTo(500, -1);
  });

  it('clamps to the endpoints when the foot falls outside the segment', () => {
    const far: LatLon[] = [
      { lat: START.lat, lon: START.lon + 2000 / kx(START.lat) },
      { lat: START.lat, lon: START.lon + 4000 / kx(START.lat) },
    ];
    expect(distanceToPolylineM(START, far)).toBeCloseTo(2000, -1);
  });

  it('is infinite for an empty line', () => {
    expect(distanceToPolylineM(START, [])).toBe(Infinity);
  });
});

describe('selectCuratedRoutes', () => {
  const near = route('near-40', line(START.lat, START.lon, 40), 40);
  const far = route('far-40', line(65.0, 25.5, 40), 40); // ~530 km away
  const tooShort = route('near-10', line(START.lat, START.lon, 10), 10);
  const tooLong = route('near-90', line(START.lat, START.lon, 90), 90);
  const all = [near, far, tooShort, tooLong];

  it('keeps routes near the start inside the length band and drops the rest', () => {
    const picks = selectCuratedRoutes(all, { start: START, targetKm: 40 });
    expect(picks.map((p) => p.route.id)).toEqual(['near-40']);
    expect(picks[0].startDistanceM).toBeLessThan(50);
  });

  it('drops a route whose line never comes within the start radius', () => {
    const picks = selectCuratedRoutes([far], { start: START, targetKm: 40 });
    expect(picks).toEqual([]);
  });

  it('respects the 0.6–1.6x length band from DEC-060', () => {
    const ids = (targetKm: number) =>
      selectCuratedRoutes([tooShort, near, tooLong], { start: START, targetKm }).map(
        (p) => p.route.id,
      );
    expect(ids(15)).toEqual(['near-10']); // 10/15 = 0.67 in band; 40/15 = 2.7 and 90/15 = 6 out
    // At 60 km both survive the band; 40 km (−33 %) is a closer fit than 90 km (+50 %).
    expect(ids(60)).toEqual(['near-40', 'near-90']);
  });

  it('caps the shortlist at 3 and prefers the closer start on an equal length fit', () => {
    const offsets = [0, 1500, 3000, 4500];
    const many = offsets.map((m, i) =>
      route(`c${i}`, line(START.lat, START.lon + m / kx(START.lat), 40), 40),
    );
    const picks = selectCuratedRoutes(many, { start: START, targetKm: 40 });
    expect(picks.map((p) => p.route.id)).toEqual(['c0', 'c1', 'c2']);
    expect(picks.length).toBe(CURATED_DEFAULTS.limit);
  });

  it('returns nothing for a non-positive target distance', () => {
    expect(selectCuratedRoutes(all, { start: START, targetKm: 0 })).toEqual([]);
  });
});

describe('curatedCoverage', () => {
  const near = route('near-40', line(START.lat, START.lon, 40), 40);
  const nearShort = route('near-10', line(START.lat, START.lon, 10), 10);
  const far = route('far-40', line(65.0, 25.5, 40), 40);

  it('separates "nothing mapped here" from "nothing at this distance"', () => {
    const nothingHere = curatedCoverage([far], { start: START, targetKm: 40 });
    expect(nothingHere.withinRadius).toBe(0);
    expect(nothingHere.nearest?.route.id).toBe('far-40');
    expect(nothingHere.nearest?.startDistanceM).toBeGreaterThan(400_000);

    const wrongLength = curatedCoverage([nearShort, far], { start: START, targetKm: 40 });
    expect(wrongLength.withinRadius).toBe(1);
    expect(wrongLength.closestFit?.route.id).toBe('near-10');
  });

  it('names the best near-miss by length, not by proximity', () => {
    const coverage = curatedCoverage([nearShort, near], { start: START, targetKm: 42 });
    expect(coverage.closestFit?.route.id).toBe('near-40');
  });

  it('reports an empty catalog as having no nearest route at all', () => {
    expect(curatedCoverage([], { start: START, targetKm: 40 })).toEqual({
      nearest: null,
      withinRadius: 0,
      closestFit: null,
    });
  });
});

describe('curated provenance helpers', () => {
  it('relaxes the distance hard filter to cover the whole selection band', () => {
    // 0.6–1.6x ⇒ 0.6 tolerance, so a selected route is never rejected for its length alone.
    expect(curatedDistanceTolerancePct()).toBeCloseTo(0.6, 10);
    expect(curatedDistanceTolerancePct({ minLengthRatio: 0.9, maxLengthRatio: 1.1 })).toBeCloseTo(
      0.1,
      10,
    );
  });

  it('labels the curation tier for display', () => {
    const withTier = (tier: CuratedRoute['tier']) => curationLabel({ ...route('x', [], 1), tier });
    expect(withTier('icn')).toBe('International cycle route · signed on OpenStreetMap');
    expect(withTier('ncn')).toBe('National cycle route · signed on OpenStreetMap');
    expect(withTier('rcn')).toBe('Regional cycle route · signed on OpenStreetMap');
    expect(curationLabel({ ...route('x', [], 1), tier: 'curated', source: 'bikeland' })).toBe(
      'Curated route · Bikeland',
    );
  });
});
