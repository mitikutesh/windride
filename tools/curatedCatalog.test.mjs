/**
 * tools/curatedCatalog.test.mjs — offline tests for the WR-052 ingest core.
 *
 * Fixtures only, never the network (CLAUDE.md rule 3): the live path of
 * `fetch_curated_routes.mjs` is exercised by hand. Plain .mjs so it tests exactly the module
 * `node tools/fetch_curated_routes.mjs` loads — no transpile in between.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION,
  buildCatalog,
  assertCatalogSize,
  haversineM,
  overpassToRoutes,
  parseGpxTracks,
  polylineLengthM,
  simplifyPoints,
  slug,
  stitchWays,
  tierFromNetwork,
} from './curatedCatalog.mjs';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'curated');
const readFix = (f) => readFileSync(join(FIX, f), 'utf8');
const readJson = (f) => JSON.parse(readFix(f));

const bikelandRaw = () =>
  parseGpxTracks(readFix('bikeland-sample.gpx'), 'fallback').map((t) => ({
    id: `bikeland-${slug(t.name)}`,
    name: t.name,
    source: 'bikeland',
    tier: 'curated',
    attribution: ATTRIBUTION.bikeland,
    points: t.points,
  }));

describe('parseGpxTracks', () => {
  it('reads the track name and every trkpt from a Bikeland-shaped GPX', () => {
    const tracks = parseGpxTracks(readFix('bikeland-sample.gpx'), 'fallback');
    expect(tracks).toHaveLength(1);
    expect(tracks[0].name).toBe('Nuuksio gravel loop');
    expect(tracks[0].points.length).toBeGreaterThan(50);
    expect(polylineLengthM(tracks[0].points) / 1000).toBeCloseTo(11.06, 1);
  });

  it('falls back to the supplied name and ignores point-less documents', () => {
    expect(parseGpxTracks('<gpx></gpx>', 'my file')).toEqual([]);
    const rte =
      '<gpx><rte><rtept lon="24.9" lat="60.1"/><rtept lat="60.2" lon="25.0"/></rte></gpx>';
    const [track] = parseGpxTracks(rte, 'my file');
    // Attribute order is not fixed in GPX exports — lon-first must parse identically.
    expect(track).toEqual({
      name: 'my file',
      points: [
        { lat: 60.1, lon: 24.9 },
        { lat: 60.2, lon: 25.0 },
      ],
    });
  });
});

describe('stitchWays', () => {
  const a = [
    { lat: 60.0, lon: 24.0 },
    { lat: 60.01, lon: 24.0 },
  ];
  const b = [
    { lat: 60.02, lon: 24.0 },
    { lat: 60.01, lon: 24.0 }, // stored BACKWARDS relative to `a`
  ];
  const far = [
    { lat: 61.0, lon: 25.0 },
    { lat: 61.01, lon: 25.0 },
  ];

  it('joins a reversed member into one chain', () => {
    const chains = stitchWays([a, b]);
    expect(chains).toHaveLength(1);
    expect(chains[0][chains[0].length - 1]).toEqual({ lat: 60.02, lon: 24.0 });
  });

  it('starts a new chain instead of bridging a real gap', () => {
    expect(stitchWays([a, far])).toHaveLength(2);
  });
});

describe('overpassToRoutes', () => {
  const routes = overpassToRoutes(readJson('overpass-sample.json'));

  it('stitches member ways (including reversed ones) into the longest continuous chain', () => {
    const ev = routes.find((r) => r.id === 'osm-r-1234567');
    expect(ev.name).toBe('Itämeren rengastie');
    expect(ev.tier).toBe('ncn');
    expect(polylineLengthM(ev.points) / 1000).toBeCloseTo(12.0, 0);
    // The disjoint 2.5 km fragment 40 km away is left out and reported, never bridged.
    expect(ev.fragmentsDropped).toBe(1);
  });

  it('ignores non-way members and alternative spurs', () => {
    const ev = routes.find((r) => r.id === 'osm-r-1234567');
    // The 'alternative' spur heads SW from the start; the kept chain never goes below its start.
    expect(Math.min(...ev.points.map((p) => p.lat))).toBeGreaterThanOrEqual(60.159);
  });

  it('picks the most national tier out of a multi-token network tag', () => {
    expect(tierFromNetwork('rcn;lcn')).toBe('rcn');
    expect(tierFromNetwork('ncn;rcn')).toBe('ncn');
    expect(tierFromNetwork(undefined)).toBe('curated');
  });
});

describe('simplifyPoints', () => {
  it('drops sub-tolerance detail but keeps both endpoints exact', () => {
    const [track] = parseGpxTracks(readFix('bikeland-sample.gpx'), 'fallback');
    const simplified = simplifyPoints(track.points, 15);
    expect(simplified.length).toBeLessThan(track.points.length);
    expect(simplified[0]).toEqual(track.points[0]);
    expect(simplified[simplified.length - 1]).toEqual(track.points[track.points.length - 1]);
    // A 15 m tolerance must not move the line: length is preserved to within a percent.
    const before = polylineLengthM(track.points);
    expect(Math.abs(polylineLengthM(simplified) - before) / before).toBeLessThan(0.01);
  });
});

describe('buildCatalog', () => {
  const result = buildCatalog(
    [...bikelandRaw(), ...overpassToRoutes(readJson('overpass-sample.json'))],
    { generated: '2026-07-30' },
  );

  it('normalises both sources into one catalog', () => {
    expect(result.catalog.version).toBe(1);
    expect(result.catalog.attributions).toEqual([
      'Route data © Bikeland (bikeland.fi)',
      '© OpenStreetMap contributors (ODbL)',
    ]);
    expect(result.report.bySource).toEqual({ bikeland: 1, osm: 1 });
  });

  it('produces the expected entry metadata', () => {
    expect(
      result.catalog.routes.map((r) => ({
        ...r,
        points: `${r.points.length} points`,
      })),
    ).toMatchSnapshot();
  });

  it('classifies a closed track as a loop and an A→B track as linear', () => {
    const loop = result.catalog.routes.find((r) => r.source === 'bikeland');
    const linear = result.catalog.routes.find((r) => r.source === 'osm');
    expect(loop.kind).toBe('loop');
    expect(linear.kind).toBe('linear');
    // The loop's own ends really do close — the classification is not a label we invented.
    const [firstLat, firstLon] = loop.points[0];
    const [lastLat, lastLon] = loop.points[loop.points.length - 1];
    expect(
      haversineM({ lat: firstLat, lon: firstLon }, { lat: lastLat, lon: lastLon }),
    ).toBeLessThan(500);
  });

  it('flags an entry that is only the longest section of a fragmented relation', () => {
    // The EuroVelo relation keeps a 12 km chain out of 14.5 km mapped (83 %) — under the 90 %
    // threshold, so the UI must be able to say "longest mapped section" rather than imply it all.
    expect(result.catalog.routes.find((r) => r.source === 'osm').partial).toBe(true);
    expect(result.catalog.routes.find((r) => r.source === 'bikeland').partial).toBeUndefined();
    expect(result.report.partial).toBe(1);
  });

  it('reports routes under the minimum length instead of hiding them', () => {
    expect(result.report.skippedShort).toEqual(['osm-r-7654321 (2.2 km)']);
    expect(result.catalog.routes.some((r) => r.id === 'osm-r-7654321')).toBe(false);
  });

  it('stores every coordinate as [lat, lon] rounded to 5 dp', () => {
    for (const [lat, lon] of result.catalog.routes[0].points) {
      expect(lat).toBeGreaterThan(59);
      expect(lat).toBeLessThan(71);
      expect(lon).toBeGreaterThan(19);
      expect(lon).toBeLessThan(32);
      expect(String(lat).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(5);
    }
  });
});

describe('size guard', () => {
  // The guard is budget-relative, so the fixture is a single dense 300 km route checked against a
  // deliberately small budget — identical logic to the real 1.5 MB ceiling, without a 5 MB fixture.
  const oversize = () =>
    buildCatalog(overpassToRoutes(readJson('overpass-oversize.json')), {
      generated: '2026-07-30',
      maxBytes: 25_000,
    });

  it('fails loudly rather than trimming the catalog to fit', () => {
    const result = oversize();
    expect(result.report.withinBudget).toBe(false);
    expect(() => assertCatalogSize(result)).toThrow(/over the .* budget/);
    // The over-budget route is still IN the catalog — the tool never silently drops to fit.
    expect(result.catalog.routes).toHaveLength(1);
  });

  it('passes when the catalog fits', () => {
    const result = buildCatalog(bikelandRaw(), { generated: '2026-07-30' });
    expect(result.report.withinBudget).toBe(true);
    expect(() => assertCatalogSize(result)).not.toThrow();
  });
});
