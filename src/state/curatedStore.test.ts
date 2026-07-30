import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import catalogFixture from '../../fixtures/curated/catalog-sample.json';
import { parseCuratedCatalog } from '../adapters/curatedRoutes';
import { ProviderError } from '../adapters/errors';
import type { Providers } from '../adapters/registry';
import { MockRouteProvider } from '../adapters/routing/mock';
import { MockWeatherProvider } from '../adapters/weather/mock';
import { useCuratedStore } from './curatedStore';
import type { PlanInputs } from './plan/runPlan';
import { useResultsStore } from './resultsStore';

const inputs: PlanInputs = {
  distanceKm: 40,
  routeType: 'loop',
  surface: 'road',
  homeBeforeDark: false,
  avoidBusy: false,
  start: { lat: 60.17, lon: 24.65 },
};

const catalog = () => parseCuratedCatalog(catalogFixture);

const deps = () => ({
  providers: { routing: new MockRouteProvider(), weather: new MockWeatherProvider() } as Providers,
  now: Date.parse('2026-07-20T09:00:00Z'),
  loadGrid: async () => null, // no shelter asset fetch in tests
  loadCatalog: async () => catalog(),
  navigate: () => {},
});

beforeEach(() => {
  useCuratedStore.getState().reset();
  useResultsStore.getState().clear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('curatedStore.findNearby', () => {
  it('scores catalog routes near the start and publishes them with provenance', async () => {
    let navigated = false;
    await useCuratedStore
      .getState()
      .findNearby(inputs, { ...deps(), navigate: () => (navigated = true) });

    const s = useCuratedStore.getState();
    expect(s.status).toBe('ready');
    expect(s.error).toBeNull();
    expect(navigated).toBe(true);

    const ranked = useResultsStore.getState().ranked;
    expect(ranked.length).toBeGreaterThan(0);
    // Curated ids are `cur-`-prefixed, so a badge can never show against an ordinary plan's card.
    expect(ranked.every((r) => r.candidate.id.startsWith('cur-'))).toBe(true);
    for (const r of ranked) expect(s.badges[r.candidate.id]).toBeTruthy();
    const badge = s.badges[ranked[0].candidate.id];
    expect(badge.name.length).toBeGreaterThan(0);
    expect(badge.label).toMatch(/route ·/);
    expect(s.attributions.length).toBeGreaterThan(0);
  });

  it('keeps only near-enough routes inside the length band, capped at 3', async () => {
    await useCuratedStore.getState().findNearby(inputs, deps());
    const ids = useResultsStore.getState().ranked.map((r) => r.candidate.id);
    expect(ids.length).toBeLessThanOrEqual(3);
    // 40.2 km loop, 46.1 km line and 30.2 km loop are all near the Espoo start and in band.
    expect(ids).toContain('cur-bikeland-nuuksio-gravel-loop');
    // ~530 km away, and an 8 km loop against a 40 km target: both must be out.
    expect(ids).not.toContain('cur-osm-r-2222222');
    expect(ids).not.toContain('cur-osm-r-3333333');
  });

  it('scores routes the ±15% plan filter would have rejected, because their length is a fact', async () => {
    // 25 km target: the 30.2 km loop is +21 % — outside the plan's ±15 % hard filter, inside the
    // 0.6–1.6x curated band, so it must be shown rather than silently rejected.
    await useCuratedStore.getState().findNearby({ ...inputs, distanceKm: 25 }, deps());
    expect(useCuratedStore.getState().status).toBe('ready');
    expect(useResultsStore.getState().ranked.map((r) => r.candidate.id)).toContain(
      'cur-osm-r-4444444',
    );
  });

  it('names the coverage gap when nothing is mapped near the start', async () => {
    await useCuratedStore
      .getState()
      .findNearby({ ...inputs, start: { lat: 62.5, lon: 27.5 } }, deps());
    const s = useCuratedStore.getState();
    expect(s.status).toBe('error');
    // Nothing nearby is a data fact, not a slider problem — so say how far the nearest one is.
    expect(s.error).toMatch(/No curated route passes within 5 km of your start/);
    expect(s.error).toMatch(/The nearest is “.+”, \d+(\.\d)? km away/);
    expect(useResultsStore.getState().ranked).toHaveLength(0);
  });

  it('names the distance band when routes are nearby but none fits', async () => {
    await useCuratedStore.getState().findNearby({ ...inputs, distanceKm: 200 }, deps());
    const s = useCuratedStore.getState();
    expect(s.status).toBe('error');
    // 0.6–1.6x of 200 km, and the best near-miss named so the rider knows what to dial in.
    expect(s.error).toMatch(/curated routes pass near you, but none is 120–320 km/);
    expect(s.error).toMatch(/The closest is “.+” at \d+(\.\d)? km/);
    expect(useResultsStore.getState().ranked).toHaveLength(0);
  });

  it('names a missing catalog instead of a generic failure', async () => {
    await useCuratedStore.getState().findNearby(inputs, {
      ...deps(),
      loadCatalog: async () => {
        throw new ProviderError('badResponse', 'not deployed', 'no-catalog');
      },
    });
    const s = useCuratedStore.getState();
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/isn’t in this build yet/);
    expect(s.badges).toEqual({});
    expect(s.attributions).toEqual([]);
  });

  it('reuses the shared offline copy for a network failure', async () => {
    await useCuratedStore.getState().findNearby(inputs, {
      ...deps(),
      loadCatalog: async () => {
        throw new ProviderError('network', 'fetch failed', 'offline');
      },
    });
    expect(useCuratedStore.getState().error).toMatch(/offline/i);
  });

  it('resets provenance so curated badges never outlive their results', async () => {
    await useCuratedStore.getState().findNearby(inputs, deps());
    expect(Object.keys(useCuratedStore.getState().badges).length).toBeGreaterThan(0);
    useCuratedStore.getState().reset();
    expect(useCuratedStore.getState()).toMatchObject({
      status: 'idle',
      badges: {},
      attributions: [],
      error: null,
    });
  });
});
