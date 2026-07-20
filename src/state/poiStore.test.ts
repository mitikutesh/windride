import { beforeEach, describe, expect, it } from 'vitest';
import type { Poi, PoiProvider } from '../adapters/poi/wikimedia';
import type { LatLon } from '../domain';
import { samplePolyline, usePoiStore } from './poiStore';

const poly: LatLon[] = Array.from({ length: 10 }, (_v, i) => ({ lat: 60 + i * 0.01, lon: 24 }));
const route = { id: 'r1', polyline: poly };

const POI = (t: string): Poi => ({
  title: t,
  thumbUrl: `http://x/${t}.jpg`,
  pageUrl: `http://x/${t}`, // unique per file page (the dedupe key)
  artist: null,
  license: null,
  licenseUrl: null,
  lat: null,
  lon: null,
});

function fakeProvider(pois: Poi[]): PoiProvider {
  return {
    async nearbyPhotos() {
      return pois;
    },
  };
}

beforeEach(() => usePoiStore.getState().reset());

describe('samplePolyline', () => {
  it('returns endpoints + evenly spaced interior points', () => {
    const s = samplePolyline(poly, 4);
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual(poly[0]);
    expect(s[3]).toEqual(poly[9]);
  });

  it('returns the whole polyline when it is shorter than n', () => {
    expect(samplePolyline(poly.slice(0, 2), 4)).toHaveLength(2);
  });
});

describe('poiStore.loadForRoute', () => {
  it('collects + dedupes POIs across the sampled points', async () => {
    await usePoiStore
      .getState()
      .loadForRoute(route, { provider: fakeProvider([POI('A'), POI('B')]) });
    const s = usePoiStore.getState();
    expect(s.status).toBe('ready');
    expect(s.pois.map((p) => p.title)).toEqual(['A', 'B']); // deduped across 4 sample points
  });

  it('reports an error (not an empty "nothing here") when every point fails', async () => {
    const dead: PoiProvider = {
      async nearbyPhotos() {
        throw new Error('offline');
      },
    };
    await usePoiStore.getState().loadForRoute(route, { provider: dead });
    const s = usePoiStore.getState();
    expect(s.status).toBe('error');
    expect(s.pois).toEqual([]);
  });

  it('drops a stale result when the route changed mid-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow: PoiProvider = {
      async nearbyPhotos() {
        await gate;
        return [POI('A')];
      },
    };
    const p1 = usePoiStore.getState().loadForRoute(route, { provider: slow });
    await usePoiStore
      .getState()
      .loadForRoute({ id: 'r2', polyline: poly }, { provider: fakeProvider([POI('Z')]) });
    expect(usePoiStore.getState().routeId).toBe('r2');
    release();
    await p1; // r1's slow result resolves last — it must not overwrite r2
    expect(usePoiStore.getState().routeId).toBe('r2');
    expect(usePoiStore.getState().pois.map((p) => p.title)).toEqual(['Z']);
  });
});
