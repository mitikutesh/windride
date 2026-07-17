// state/persist.ts — idb-backed storage for zustand persist (WR-008). Falls back to a no-op when
// IndexedDB is unavailable (node/SSR/tests) so hydration never throws.
import { openDB, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'windride-state';
const STORE = 'kv';

let dbPromise: Promise<IDBPDatabase> | undefined;
function db(): Promise<IDBPDatabase> {
  return (dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore(STORE);
    },
  }));
}

const hasIdb = typeof indexedDB !== 'undefined';

export const idbStateStorage: StateStorage = {
  async getItem(name) {
    if (!hasIdb) return null;
    try {
      return (await (await db()).get(STORE, name)) ?? null;
    } catch {
      return null;
    }
  },
  async setItem(name, value) {
    if (!hasIdb) return;
    try {
      await (await db()).put(STORE, value, name);
    } catch {
      /* best-effort */
    }
  },
  async removeItem(name) {
    if (!hasIdb) return;
    try {
      await (await db()).delete(STORE, name);
    } catch {
      /* best-effort */
    }
  },
};
