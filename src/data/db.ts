// data/db.ts — IndexedDB schema for WindRide (WR-010, ARCHITECTURE §6).
// v1 holds the `routes` store (planned routes). v2 adds `rides` + `ridePoints` (WR-017 recorder).
// v3 adds `strava` (owner OAuth creds, WR-023). v4 adds `riddenEdges` (WR-028). v5 adds `config`
// (bring-your-own API keys + live-APIs override, task #33).
import { openDB, type IDBPDatabase } from 'idb';
import type { RideSummary } from '../domain';
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

/** A recorded ride's metadata (points live in `ridePoints`, appended incrementally). */
export interface RecordedRide {
  id: string;
  name: string;
  /** Planned route linkage — WR-024 calibration / WR-028 novelty need it. */
  routeId?: string;
  startedAt: number;
  status: 'recording' | 'finished';
  finishedAt?: number;
  summary?: RideSummary;
  /** Strava activity id once uploaded (WR-023) — makes re-send a no-op. */
  stravaActivityId?: number;
}

/** Owner Strava OAuth credentials (WR-023). Stored in idb at runtime, NEVER bundled in Vite env. */
export interface StravaCredsRecord {
  key: 'creds';
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** One recorded fix, keyed [rideId, seq] so appends never rewrite the whole ride. */
export interface RidePointRecord {
  rideId: string;
  seq: number;
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

const DB_NAME = 'windride';
const ROUTES = 'routes';
const RIDES = 'rides';
const RIDE_POINTS = 'ridePoints';
const STRAVA = 'strava';
const RIDDEN_EDGES = 'riddenEdges';
const CONFIG = 'config';

let dbPromise: Promise<IDBPDatabase> | undefined;
export function openWindrideDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 5, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ROUTES)) db.createObjectStore(ROUTES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(RIDES)) db.createObjectStore(RIDES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(RIDE_POINTS)) {
          const store = db.createObjectStore(RIDE_POINTS, { keyPath: ['rideId', 'seq'] });
          store.createIndex('byRide', 'rideId');
        }
        if (!db.objectStoreNames.contains(STRAVA)) db.createObjectStore(STRAVA, { keyPath: 'key' });
        // v4: ridden-road geohash cells for the Novelty sub-score (WR-028). The edge string IS the
        // key, so re-saving a ride is idempotent (a put on an existing key is a no-op change).
        if (!db.objectStoreNames.contains(RIDDEN_EDGES)) db.createObjectStore(RIDDEN_EDGES);
        // v5: runtime config — bring-your-own API keys + a live-APIs override (task #33). Values are
        // strings keyed by name; keys live here (local browser only), never in the shipped bundle.
        if (!db.objectStoreNames.contains(CONFIG)) db.createObjectStore(CONFIG);
      },
    }).catch((e) => {
      dbPromise = undefined; // don't cache a rejection — allow a later retry
      throw e;
    });
  }
  return dbPromise;
}

// --- ridden edges (WR-028) -----------------------------------------------------------------
/** Merge a batch of geohash cells into the ridden set (one transaction). Idempotent by key. */
export async function addRiddenEdges(edges: Iterable<string>): Promise<void> {
  const db = await openWindrideDb();
  const tx = db.transaction(RIDDEN_EDGES, 'readwrite');
  for (const e of edges) void tx.store.put(1, e);
  await tx.done;
}

/** Hydrate the whole ridden-edge set once (kept in memory as a Set for scoring). */
export async function loadRiddenEdges(): Promise<Set<string>> {
  const keys = (await (await openWindrideDb()).getAllKeys(RIDDEN_EDGES)) as string[];
  return new Set(keys);
}

export async function clearRiddenEdges(): Promise<void> {
  await (await openWindrideDb()).clear(RIDDEN_EDGES);
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

// --- rides (WR-017) ------------------------------------------------------------------------
export async function createRide(ride: RecordedRide): Promise<void> {
  await (await openWindrideDb()).put(RIDES, ride);
}

/** Append a batch of points in one transaction (crash-safe incremental record). */
export async function appendRidePoints(points: RidePointRecord[]): Promise<void> {
  if (points.length === 0) return;
  const db = await openWindrideDb();
  const tx = db.transaction(RIDE_POINTS, 'readwrite');
  for (const p of points) void tx.store.put(p);
  await tx.done;
}

/** Merge a status/summary patch into a ride record (e.g. on finish). */
export async function updateRide(
  id: string,
  patch: Partial<Omit<RecordedRide, 'id'>>,
): Promise<void> {
  const db = await openWindrideDb();
  const existing = (await db.get(RIDES, id)) as RecordedRide | undefined;
  if (!existing) return;
  await db.put(RIDES, { ...existing, ...patch });
}

/** The unfinished ride, if any — drives the resume/save prompt on app start. */
export async function getRecordingRide(): Promise<RecordedRide | undefined> {
  const all = (await (await openWindrideDb()).getAll(RIDES)) as RecordedRide[];
  return all.filter((r) => r.status === 'recording').sort((a, b) => b.startedAt - a.startedAt)[0];
}

export async function listRides(): Promise<RecordedRide[]> {
  const all = (await (await openWindrideDb()).getAll(RIDES)) as RecordedRide[];
  return all.sort((a, b) => b.startedAt - a.startedAt); // newest first
}

export async function getRidePoints(rideId: string): Promise<RidePointRecord[]> {
  const points = (await (
    await openWindrideDb()
  ).getAllFromIndex(RIDE_POINTS, 'byRide', rideId)) as RidePointRecord[];
  return points.sort((a, b) => a.seq - b.seq);
}

export async function deleteRide(id: string): Promise<void> {
  const db = await openWindrideDb();
  const tx = db.transaction([RIDES, RIDE_POINTS], 'readwrite');
  void tx.objectStore(RIDES).delete(id);
  const idx = tx.objectStore(RIDE_POINTS).index('byRide');
  for (const key of await idx.getAllKeys(id)) void tx.objectStore(RIDE_POINTS).delete(key);
  await tx.done;
}

// --- Strava creds (WR-023) -----------------------------------------------------------------
export async function getStravaCreds(): Promise<StravaCredsRecord | undefined> {
  return (await openWindrideDb()).get(STRAVA, 'creds') as Promise<StravaCredsRecord | undefined>;
}

export async function setStravaCreds(creds: Omit<StravaCredsRecord, 'key'>): Promise<void> {
  await (await openWindrideDb()).put(STRAVA, { key: 'creds', ...creds });
}

// --- runtime config: BYO API keys + live-APIs override (task #33) ---------------------------
/** Load the whole config map (name → string value). Empty when nothing has been set. */
export async function getConfig(): Promise<Record<string, string>> {
  const db = await openWindrideDb();
  // One pass each for keys and values (getAll preserves key order), not a get() per key.
  const [names, values] = await Promise.all([db.getAllKeys(CONFIG), db.getAll(CONFIG)]);
  return Object.fromEntries((names as string[]).map((n, i) => [n, values[i] as string]));
}

export async function setConfigValue(name: string, value: string): Promise<void> {
  await (await openWindrideDb()).put(CONFIG, value, name);
}

export async function deleteConfigValue(name: string): Promise<void> {
  await (await openWindrideDb()).delete(CONFIG, name);
}
