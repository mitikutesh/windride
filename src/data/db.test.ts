import 'fake-indexeddb/auto';
import { openDB } from 'idb';
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

  it('reopening v1 keeps the store and its data (migration smoke)', async () => {
    await saveRoute(route('smoke', 3000));
    await openWindrideDb(); // first open (via the app helper)
    // A genuinely separate second connection at v1 sees the store and the persisted record.
    const again = await openDB('windride', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('routes'))
          db.createObjectStore('routes', { keyPath: 'id' });
      },
    });
    expect(again.objectStoreNames.contains('routes')).toBe(true);
    expect(((await again.get('routes', 'smoke')) as SavedRoute).id).toBe('smoke');
    again.close();
  });
});
