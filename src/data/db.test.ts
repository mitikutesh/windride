import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteRoute, listRoutes, openWindrideDb, saveRoute, type SavedRoute } from './db';

function route(id: string, savedAt: number): SavedRoute {
  return {
    id,
    name: `WindRide ${id}`,
    savedAt,
    distanceKm: 50,
    ascentM: 300,
    track: { name: id, creator: 'WindRide', points: [{ lat: 60, lon: 24, ele: 10 }] },
  };
}

describe('routes store (idb)', () => {
  it('saves, lists newest-first, and deletes', async () => {
    await saveRoute(route('a', 1000));
    await saveRoute(route('b', 2000));
    let all = await listRoutes();
    expect(all.map((r) => r.id)).toEqual(['b', 'a']); // newest first
    await deleteRoute('a');
    all = await listRoutes();
    expect(all.map((r) => r.id)).toEqual(['b']);
  });

  it('opening v1 twice is stable (migration smoke)', async () => {
    const a = await openWindrideDb();
    const b = await openWindrideDb();
    expect(a).toBe(b); // memoised single connection
    expect(a.objectStoreNames.contains('routes')).toBe(true);
  });
});
