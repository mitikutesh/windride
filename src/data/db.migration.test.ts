import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { describe, expect, it } from 'vitest';
import { listRoutes, openWindrideDb, type SavedRoute } from './db';

// Isolated module → openWindrideDb's dbPromise starts fresh, so we can create the DB at v1 first
// and prove the real v1→v2 upgrade in db.ts preserves existing routes and adds the ride stores.
describe('windride idb v1 → v2 migration', () => {
  it('keeps v1 routes data and adds the ride stores on upgrade', async () => {
    // A genuine v1 database with one saved route.
    const v1 = await openDB('windride', 1, {
      upgrade(db) {
        db.createObjectStore('routes', { keyPath: 'id' });
      },
    });
    const route: SavedRoute = {
      id: 'legacy',
      name: 'Legacy route',
      savedAt: 1000,
      distanceKm: 42,
      ascentM: 100,
      track: { name: 'legacy', points: [{ lat: 60, lon: 24 }] },
    };
    await v1.put('routes', route);
    v1.close();

    // The app's own open triggers the real db.ts upgrade to v2.
    const db = await openWindrideDb();
    expect(db.objectStoreNames.contains('rides')).toBe(true);
    expect(db.objectStoreNames.contains('ridePoints')).toBe(true);
    // The pre-existing route survived the migration.
    const routes = await listRoutes();
    expect(routes.map((r) => r.id)).toContain('legacy');
  });
});
