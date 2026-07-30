import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import catalogFixture from '../../fixtures/curated/catalog-sample.json';
import { isProviderError } from './errors';
import {
  loadCuratedCatalog,
  parseCuratedCatalog,
  parseCuratedRoute,
  resetCuratedCatalogCache,
} from './curatedRoutes';

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const statusResponse = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

beforeEach(() => {
  resetCuratedCatalogCache();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseCuratedCatalog', () => {
  it('parses the catalog and turns [lat, lon] pairs into LatLon points', () => {
    const catalog = parseCuratedCatalog(catalogFixture);
    expect(catalog.version).toBe(1);
    expect(catalog.generated).toBe('2026-07-30');
    expect(catalog.attributions).toContain('© OpenStreetMap contributors (ODbL)');
    const loop = catalog.routes.find((r) => r.id === 'bikeland-nuuksio-gravel-loop');
    expect(loop?.source).toBe('bikeland');
    expect(loop?.kind).toBe('loop');
    expect(loop?.polyline[0]).toEqual({ lat: 60.17, lon: 24.65 });
    expect(loop?.polyline.length).toBeGreaterThan(100);
  });

  it('drops a malformed entry with a warning instead of failing the catalog', () => {
    const catalog = parseCuratedCatalog(catalogFixture);
    expect(catalog.dropped).toBe(1);
    expect(catalog.routes.some((r) => r.id === 'osm-r-9999999')).toBe(false);
    expect(catalog.routes).toHaveLength(5);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 malformed'));
  });

  it('rejects a catalog written by a different tool version', () => {
    try {
      parseCuratedCatalog({ ...catalogFixture, version: 2 });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isProviderError(e) && e.code).toBe('stale-catalog');
    }
  });

  it('rejects a file that is not a catalog at all', () => {
    expect(() => parseCuratedCatalog('nope')).toThrow();
    expect(() => parseCuratedCatalog({ version: 1 })).toThrow();
  });

  it('falls back to per-entry credits when the file lists no attributions', () => {
    const catalog = parseCuratedCatalog({ ...catalogFixture, attributions: [] });
    expect(catalog.attributions).toEqual([
      'Route data © Bikeland (bikeland.fi)',
      '© OpenStreetMap contributors (ODbL)',
    ]);
  });
});

describe('parseCuratedRoute', () => {
  const valid = {
    id: 'osm-r-1',
    name: 'Test',
    source: 'osm',
    tier: 'ncn',
    kind: 'loop',
    lengthKm: 30,
    bbox: { minLat: 60, minLon: 24, maxLat: 61, maxLon: 25 },
    attribution: '© OpenStreetMap contributors (ODbL)',
    points: [
      [60.1, 24.5],
      [60.2, 24.6],
    ],
  };

  it('accepts a well-formed entry', () => {
    expect(parseCuratedRoute(valid)?.polyline).toEqual([
      { lat: 60.1, lon: 24.5 },
      { lat: 60.2, lon: 24.6 },
    ]);
  });

  it('carries the partial flag through, defaulting to a whole route', () => {
    expect(parseCuratedRoute(valid)?.partial).toBe(false);
    expect(parseCuratedRoute({ ...valid, partial: true })?.partial).toBe(true);
  });

  it.each([
    ['unknown source', { source: 'strava' }],
    ['unknown tier', { tier: 'lcn' }],
    ['unknown kind', { kind: 'spiral' }],
    ['no length', { lengthKm: 0 }],
    ['inverted bbox', { bbox: { minLat: 61, minLon: 24, maxLat: 60, maxLon: 25 } }],
    ['single point', { points: [[60.1, 24.5]] }],
    [
      'out-of-range coordinate',
      {
        points: [
          [600, 24.5],
          [60.2, 24.6],
        ],
      },
    ],
    [
      'non-numeric coordinate',
      {
        points: [
          ['a', 'b'],
          [60.2, 24.6],
        ],
      },
    ],
    ['missing attribution', { attribution: '' }],
  ])('rejects %s', (_label, patch) => {
    expect(parseCuratedRoute({ ...valid, ...patch })).toBeNull();
  });

  it('rejects non-objects', () => {
    expect(parseCuratedRoute(null)).toBeNull();
    expect(parseCuratedRoute('route')).toBeNull();
  });
});

describe('loadCuratedCatalog', () => {
  it('fetches the same-origin asset once and memoises it', async () => {
    const fetchFn = vi.fn(async () => okResponse(catalogFixture));
    const a = await loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' });
    const b = await loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' });
    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/c');
  });

  it('names a missing catalog rather than reporting a generic failure', async () => {
    const fetchFn = vi.fn(async () => statusResponse(404));
    await expect(
      loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' }),
    ).rejects.toMatchObject({ kind: 'badResponse', code: 'no-catalog' });
  });

  it('maps a rejected fetch onto the DEC-057 network taxonomy', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    try {
      await loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isProviderError(e) && e.kind).toBe('network');
      // Never "offline" unless the browser says so — a blocked same-origin fetch is unreachable.
      expect(isProviderError(e) && e.code).toBe('unreachable');
    }
  });

  it('reports a non-JSON body as a bad response', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    await expect(
      loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' }),
    ).rejects.toMatchObject({ kind: 'badResponse', code: 'bad-catalog' });
  });

  it('does not cache a failure, so pressing the button again really retries', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(statusResponse(500))
      .mockResolvedValueOnce(okResponse(catalogFixture));
    await expect(
      loadCuratedCatalog({ fetchFn: fetchFn as unknown as typeof fetch, url: '/c' }),
    ).rejects.toThrow();
    const catalog = await loadCuratedCatalog({
      fetchFn: fetchFn as unknown as typeof fetch,
      url: '/c',
    });
    expect(catalog.routes).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
