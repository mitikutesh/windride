// data/db.ts — IndexedDB schema for WindRide (WR-010, ARCHITECTURE §6).
// v1 holds the `routes` store (planned routes). `rides`/`settings`/`riddenEdges` arrive with
// their stories via a version bump. Weather/route response caches live in separate DBs.
import { openDB, type IDBPDatabase } from 'idb';
import type { GpxTrack } from '../utils/gpx';

export interface SavedRoute {
  id: string;
  name: string;
  /** Epoch ms when saved. */
  savedAt: number;
  distanceKm: number;
  ascentM: number;
  track: GpxTrack;
}

const DB_NAME = 'windride';
const ROUTES = 'routes';

let dbPromise: Promise<IDBPDatabase> | undefined;
export function openWindrideDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ROUTES)) db.createObjectStore(ROUTES, { keyPath: 'id' });
      },
    }).catch((e) => {
      dbPromise = undefined; // don't cache a rejection — allow a later retry
      throw e;
    });
  }
  return dbPromise;
}

export async function saveRoute(route: SavedRoute): Promise<void> {
  await (await openWindrideDb()).put(ROUTES, route);
}

export async function listRoutes(): Promise<SavedRoute[]> {
  const all = (await (await openWindrideDb()).getAll(ROUTES)) as SavedRoute[];
  return all.sort((a, b) => b.savedAt - a.savedAt); // newest first
}

export async function deleteRoute(id: string): Promise<void> {
  await (await openWindrideDb()).delete(ROUTES, id);
}
