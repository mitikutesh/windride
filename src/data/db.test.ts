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

  it('v4 schema smoke: a second connection sees every store (incl. riddenEdges) and the record', async () => {
    await saveRoute(route('smoke', 3000));
    await openWindrideDb(); // first open (via the app helper) creates v4
    // A genuinely separate second connection at v4 sees every store and the persisted record.
    const again = await openDB('windride', 4, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('routes'))
          db.createObjectStore('routes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('rides'))
          db.createObjectStore('rides', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('ridePoints')) {
          const s = db.createObjectStore('ridePoints', { keyPath: ['rideId', 'seq'] });
          s.createIndex('byRide', 'rideId');
        }
        if (!db.objectStoreNames.contains('strava'))
          db.createObjectStore('strava', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('riddenEdges')) db.createObjectStore('riddenEdges');
      },
    });
    expect(again.objectStoreNames.contains('routes')).toBe(true);
    expect(again.objectStoreNames.contains('rides')).toBe(true);
    expect(again.objectStoreNames.contains('ridePoints')).toBe(true);
    expect(again.objectStoreNames.contains('strava')).toBe(true);
    expect(again.objectStoreNames.contains('riddenEdges')).toBe(true);
    expect(((await again.get('routes', 'smoke')) as SavedRoute).id).toBe('smoke');
    again.close();
  });
});

describe('ridden edges store (WR-028)', () => {
  it('merges edges idempotently and hydrates them back as a set', async () => {
    const { addRiddenEdges, loadRiddenEdges, clearRiddenEdges } = await import('./db');
    await clearRiddenEdges();
    await addRiddenEdges(['ud9wr0k', 'ud9wr0m']);
    await addRiddenEdges(['ud9wr0m', 'ud9wr0q']); // one repeat, one new
    const set = await loadRiddenEdges();
    expect(set).toEqual(new Set(['ud9wr0k', 'ud9wr0m', 'ud9wr0q'])); // no duplicate from the repeat
    await clearRiddenEdges();
    expect((await loadRiddenEdges()).size).toBe(0);
  });
});
