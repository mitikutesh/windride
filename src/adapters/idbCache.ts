// adapters/idbCache.ts — generic TTL cache: in-memory + IndexedDB when available (WR-005).
// Any idb failure degrades to memory-only (never surfaces as a provider error); expired rows
// are pruned on read. Structurally the same resilience as the weather cache (WR-004).
import { openDB, type IDBPDatabase } from 'idb';

export interface TtlCache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, expiresAt: number): Promise<void>;
}

type Entry<T> = { value: T; expiresAt: number };

export function createIdbCache<T>(
  dbName: string,
  store: string,
  now: () => number = () => Date.now(),
): TtlCache<T> {
  const mem = new Map<string, Entry<T>>();
  let idbUsable = typeof indexedDB !== 'undefined';
  let dbPromise: Promise<IDBPDatabase> | undefined;

  async function db(): Promise<IDBPDatabase | undefined> {
    if (!idbUsable) return undefined;
    try {
      dbPromise ??= openDB(dbName, 1, {
        upgrade(d) {
          d.createObjectStore(store);
        },
      });
      return await dbPromise;
    } catch {
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
        const rec = (await conn.get(store, key)) as Entry<T> | undefined;
        if (!rec) return undefined;
        if (rec.expiresAt > now()) {
          mem.set(key, rec);
          return rec.value;
        }
        await conn.delete(store, key);
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
        await conn.put(store, { value, expiresAt }, key);
      } catch {
        idbUsable = false;
      }
    },
  };
}
