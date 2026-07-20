// state/syncStore.ts — cross-device sync of NON-SECRET data (WR-041). Offline-first: local idb is
// always authoritative; sync pulls → merges (union routes, tombstone-aware) → applies locally →
// pushes. API keys are never part of the doc (DEC-040 — see syncDoc.buildSyncDoc). The UI never
// touches adapters; this store owns the calls, and all I/O is injectable so tests never hit network.
import { create } from 'zustand';
import { HttpApiClient } from '../adapters/api/client';
import type { ApiClient } from '../adapters/api/types';
import {
  deleteRoute,
  getRouteTombstones,
  listRoutes,
  saveRoute,
  setRouteTombstones,
} from '../data/db';
import { useAuthStore } from './authStore';
import { usePlanStore } from './planStore';
import { useSavedRoutesStore } from './savedRoutesStore';
import { buildSyncDoc, isSyncDoc, mergeSyncDocs, type SyncDoc } from './sync/syncDoc';

type Status = 'idle' | 'syncing' | 'ready' | 'error';

interface SyncDeps {
  api?: ApiClient;
  getToken?: () => Promise<string | null>;
  /** Read the local doc from idb (async so it never depends on an unhydrated store mirror). */
  readLocal?: () => Promise<SyncDoc>;
  /** Reconcile local idb to the merged doc (add pulled routes, delete tombstoned ones). */
  apply?: (merged: SyncDoc) => Promise<void>;
}

interface SyncState {
  status: Status;
  lastSyncedAt: string | null;
  error: string | null;
  syncNow: (deps?: SyncDeps) => Promise<void>;
}

// Read from idb directly (not the zustand mirror, which is [] until PlanScreen mounts) so a sync
// triggered from Kit still uploads every saved route.
async function defaultReadLocal(): Promise<SyncDoc> {
  const [routes, tombstones] = await Promise.all([listRoutes(), getRouteTombstones()]);
  return buildSyncDoc(routes, usePlanStore.getState().inputs, tombstones);
}

async function defaultApply(merged: SyncDoc): Promise<void> {
  const current = await listRoutes();
  const mergedIds = new Set(merged.savedRoutes.map((r) => r.id));
  for (const r of merged.savedRoutes) await saveRoute(r); // add/update routes from other devices
  for (const r of current) if (!mergedIds.has(r.id)) await deleteRoute(r.id); // apply remote deletions
  await setRouteTombstones(merged.tombstones); // keep suppressing deleted ids on future syncs
  await useSavedRoutesStore.getState().refresh();
}

export const useSyncStore = create<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  error: null,

  syncNow: async (deps = {}) => {
    const getToken = deps.getToken ?? (() => useAuthStore.getState().ensureFreshToken());
    const token = await getToken();
    if (!token) {
      set({ status: 'error', error: 'Sign in to sync.' });
      return;
    }
    const api = deps.api ?? new HttpApiClient();
    const readLocal = deps.readLocal ?? defaultReadLocal;
    const apply = deps.apply ?? defaultApply;
    set({ status: 'syncing', error: null });
    try {
      const remote = await api.getSync(token);
      const local = await readLocal();
      const merged = mergeSyncDocs(local, isSyncDoc(remote.doc) ? remote.doc : null);
      await apply(merged); // apply locally BEFORE push, so a failed push never loses pulled data
      const { updatedAt } = await api.putSync(token, merged);
      set({ status: 'ready', lastSyncedAt: updatedAt, error: null });
    } catch {
      set({
        status: 'error',
        error: 'Couldn’t sync right now — your data is safe on this device.',
      });
    }
  },
}));
