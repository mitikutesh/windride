import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SavedRoute } from '../data/db';
import { useSavedRoutesStore } from './savedRoutesStore';

const route: SavedRoute = {
  id: 'store-1',
  name: 'WindRide 50 km',
  savedAt: 1000,
  distanceKm: 50,
  ascentM: 200,
  track: { name: 'WindRide 50 km', creator: 'WindRide', points: [{ lat: 60, lon: 24, ele: 5 }] },
};

describe('useSavedRoutesStore', () => {
  it('saves, refreshes into state, and removes', async () => {
    await useSavedRoutesStore.getState().save(route);
    expect(useSavedRoutesStore.getState().routes.map((r) => r.id)).toContain('store-1');
    await useSavedRoutesStore.getState().remove('store-1');
    expect(useSavedRoutesStore.getState().routes.map((r) => r.id)).not.toContain('store-1');
  });
});
