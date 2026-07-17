// adapters/weather/cache.ts — weather grid cache (WR-004).
// In-memory always; persisted to IndexedDB when available. Any idb failure degrades to
// memory-only (never surfaces as a provider error), and expired rows are pruned on read.
import { openDB, type IDBPDatabase } from 'idb';
import type { WindGrid } from '../../domain';

export interface WeatherCache {
  get(key: string): Promise<WindGrid | undefined>;
  set(key: string, value: WindGrid, expiresAt: number): Promise<void>;
}

type CachedGrid = { value: WindGrid; expiresAt: number };

const DB_NAME = 'windride-weather';
const STORE = 'grids';

/**
 * @param now injectable clock (ms) so TTL is deterministic in tests. Defaults to the wall clock;
 *            this is an adapter (Date is allowed here, unlike engine/).
 */
export function createWeatherCache(now: () => number = () => Date.now()): WeatherCache {
  const mem = new Map<string, CachedGrid>();
  let idbUsable = typeof indexedDB !== 'undefined';
  let dbPromise: Promise<IDBPDatabase> | undefined;

  async function db(): Promise<IDBPDatabase | undefined> {
    if (!idbUsable) return undefined;
    try {
      dbPromise ??= openDB(DB_NAME, 1, {
        upgrade(d) {
          d.createObjectStore(STORE);
        },
      });
      return await dbPromise;
    } catch {
      // Private mode / storage eviction: disable idb permanently, keep serving from memory.
      idbUsable = false;
      dbPromise = undefined;
      return undefined;
    }
  }

  return {
    async get(key) {
      const hit = mem.get(key);
      if (hit) {
        if (hit.expiresAt > now()) return hit.value;
        mem.delete(key);
      }
      const conn = await db();
      if (!conn) return undefined;
      try {
        const rec = (await conn.get(STORE, key)) as CachedGrid | undefined;
        if (!rec) return undefined;
        if (rec.expiresAt > now()) {
          mem.set(key, rec);
          return rec.value;
        }
        await conn.delete(STORE, key); // prune stale row so the store can't grow unbounded
        return undefined;
      } catch {
        idbUsable = false;
        return undefined;
      }
    },

    async set(key, value, expiresAt) {
      mem.set(key, { value, expiresAt });
      const conn = await db();
      if (!conn) return;
      try {
        await conn.put(STORE, { value, expiresAt }, key);
      } catch {
        idbUsable = false;
      }
    },
  };
}
