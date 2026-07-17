// adapters/weather/cache.ts — weather grid cache (WR-004).
// In-memory always; persisted to IndexedDB when available (skipped under node/tests).
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
  const hasIdb = typeof indexedDB !== 'undefined';
  let dbPromise: Promise<IDBPDatabase> | undefined;
  const db = () =>
    (dbPromise ??= openDB(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore(STORE);
      },
    }));

  return {
    async get(key) {
      const hit = mem.get(key);
      if (hit) {
        if (hit.expiresAt > now()) return hit.value;
        mem.delete(key);
      }
      if (hasIdb) {
        const rec = (await (await db()).get(STORE, key)) as CachedGrid | undefined;
        if (rec && rec.expiresAt > now()) {
          mem.set(key, rec);
          return rec.value;
        }
      }
      return undefined;
    },

    async set(key, value, expiresAt) {
      mem.set(key, { value, expiresAt });
      if (hasIdb) await (await db()).put(STORE, { value, expiresAt }, key);
    },
  };
}
