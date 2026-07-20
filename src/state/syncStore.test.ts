import { beforeEach, describe, expect, it } from 'vitest';
import type { ApiClient, SyncPull } from '../adapters/api/types';
import type { SavedRoute } from '../data/db';
import type { SyncDoc } from './sync/syncDoc';
import { useSyncStore } from './syncStore';

const route = (id: string): SavedRoute => ({
  id,
  name: id,
  savedAt: 1000,
  distanceKm: 40,
  ascentM: 300,
  track: { name: id, points: [] },
});
const prefs = {
  distanceKm: 40,
  routeType: 'loop' as const,
  surface: 'gravel' as const,
  avoidBusy: false,
  winter: false,
};
const local: SyncDoc = { savedRoutes: [route('a')], prefs, tombstones: {} };

function api(over: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    getMe: async () => ({ userId: 'u', email: 'e', entitlement: 'free', createdAt: '' }),
    getSync: async (): Promise<SyncPull> => ({ doc: null, updatedAt: null }),
    putSync: async () => ({ updatedAt: 't2' }),
  };
  return { ...base, ...over };
}

beforeEach(() => useSyncStore.setState({ status: 'idle', lastSyncedAt: null, error: null }));

describe('syncStore.syncNow', () => {
  it('pulls, unions remote routes, applies the merge, and pushes it', async () => {
    let pushed: SyncDoc | null = null;
    let appliedIds: string[] = [];
    await useSyncStore.getState().syncNow({
      getToken: async () => 'tok',
      readLocal: async () => local,
      apply: async (merged) => {
        appliedIds = merged.savedRoutes.map((r) => r.id);
      },
      api: api({
        getSync: async () => ({
          doc: { savedRoutes: [route('b')], prefs, tombstones: {} },
          updatedAt: 't1',
        }),
        putSync: async (_t, doc) => {
          pushed = doc as SyncDoc;
          return { updatedAt: 't2' };
        },
      }),
    });
    const s = useSyncStore.getState();
    expect(s.status).toBe('ready');
    expect(s.lastSyncedAt).toBe('t2');
    expect(pushed!.savedRoutes.map((r) => r.id).sort()).toEqual(['a', 'b']); // unioned
    expect(appliedIds.sort()).toEqual(['a', 'b']);
  });

  it('errors (no push) when signed out — data stays safe locally', async () => {
    let pushedCount = 0;
    await useSyncStore.getState().syncNow({
      getToken: async () => null,
      readLocal: async () => local,
      apply: async () => {},
      api: api({
        putSync: async () => {
          pushedCount++;
          return { updatedAt: 't' };
        },
      }),
    });
    expect(useSyncStore.getState().status).toBe('error');
    expect(pushedCount).toBe(0);
  });

  it('errors gracefully when the backend call fails', async () => {
    await useSyncStore.getState().syncNow({
      getToken: async () => 'tok',
      readLocal: async () => local,
      apply: async () => {},
      api: api({
        getSync: async () => {
          throw new Error('offline');
        },
      }),
    });
    expect(useSyncStore.getState().status).toBe('error');
  });
});
