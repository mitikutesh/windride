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
  let swept = false;

  async function db(): Promise<IDBPDatabase | undefined> {
    if (!idbUsable) return undefined;
    try {
      dbPromise ??= openDB(dbName, 1, {
        upgrade(d) {
          d.createObjectStore(store);
        },
      });
      const conn = await dbPromise;
      if (!swept) {
        swept = true;
        // One-time sweep so never-read expired rows can't accumulate forever.
        void pruneExpired(conn);
      }
      return conn;
    } catch {
      idbUsable = false;
      dbPromise = undefined;
      return undefined;
    }
  }

  async function pruneExpired(conn: IDBPDatabase): Promise<void> {
    try {
      const keys = await conn.getAllKeys(store);
      for (const key of keys) {
        const rec = (await conn.get(store, key)) as Entry<T> | undefined;
        if (rec && rec.expiresAt <= now()) await conn.delete(store, key);
      }
    } catch {
      /* best-effort */
    }
  }

  return {
    async get(key) {
      // Clone on return so a caller mutating the result can never corrupt the cached copy.
      const hit = mem.get(key);
      if (hit) {
        if (hit.expiresAt > now()) return structuredClone(hit.value);
        mem.delete(key);
      }
      const conn = await db();
      if (!conn) return undefined;
      try {
        const rec = (await conn.get(store, key)) as Entry<T> | undefined;
        if (!rec) return undefined;
        if (rec.expiresAt > now()) {
          mem.set(key, rec);
          return structuredClone(rec.value);
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
