// state/keychainStore.ts — bring-your-own API keys + a live-APIs override (task #33).
//
// idb is the source of truth; this store mirrors it in memory and pushes a snapshot into the
// adapter registry (setRuntimeConfig) so getProviders()/liveApisEnabled() read keys synchronously.
// This is the bridge that keeps adapters self-contained: the registry never imports state/data — the
// state layer hydrates the keychain and hands it down. Keys live only in the local browser (idb),
// never in the shipped bundle (mirrors the Strava-secret rule, DEC-027).
import { create } from 'zustand';
import { getConfig, setConfigValue, deleteConfigValue } from '../data/db';
import { type ApiKeyName, liveApisEnabled, setRuntimeConfig } from '../adapters/registry';

// Re-exported so UI can name key types without importing adapters (ARCHITECTURE §3 boundary).
export type { ApiKeyName };

/** The keys a user can supply. `ai` is reserved — stored + managed, but nothing consumes it yet. */
export const API_KEY_NAMES: ApiKeyName[] = ['ors', 'digitransit', 'ai'];
const LIVE_APIS = 'liveApis'; // config key for the live-APIs override

interface KeychainState {
  keys: Partial<Record<ApiKeyName, string>>;
  /** null = follow the build-time default; true/false = explicit owner override. */
  liveApis: boolean | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Save a key (empty/whitespace clears it). Returns false if the idb write failed (kept in memory
   *  for this session either way) so the UI can report an honest outcome. */
  saveKey: (name: ApiKeyName, value: string) => Promise<boolean>;
  /** Override the live-APIs switch (null clears the override, reverting to the build default). */
  setLiveApis: (on: boolean | null) => Promise<void>;
}

/** Push the current keys + live override into the adapter registry (synchronous read source). */
function pushToRegistry(state: Pick<KeychainState, 'keys' | 'liveApis'>): void {
  setRuntimeConfig({ keys: state.keys, liveApis: state.liveApis });
}

// De-dupes concurrent hydrate() calls (App mount + a deep-linked Settings screen) into one idb read.
let hydrating: Promise<void> | null = null;

export const useKeychainStore = create<KeychainState>((set, get) => ({
  keys: {},
  liveApis: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydrating) return hydrating; // an in-flight hydrate is already loading from idb
    hydrating = (async () => {
      try {
        const config = await getConfig();
        const fromIdb: Partial<Record<ApiKeyName, string>> = {};
        for (const name of API_KEY_NAMES) if (config[name]) fromIdb[name] = config[name];
        const idbLive = LIVE_APIS in config ? config[LIVE_APIS] === 'true' : null;
        // Merge UNDER anything the user changed while idb was loading (their edit wins), so a save
        // landing mid-hydrate is never clobbered by the resolving snapshot.
        const s = get();
        const keys = { ...fromIdb, ...s.keys };
        const liveApis = s.liveApis ?? idbLive; // an explicit in-flight override wins
        set({ keys, liveApis, hydrated: true });
        pushToRegistry({ keys, liveApis });
      } catch {
        // idb unavailable (tests/SSR): keys stay empty, live-APIs follows the build default. No crash.
        set({ hydrated: true });
      } finally {
        hydrating = null;
      }
    })();
    return hydrating;
  },

  saveKey: async (name, value) => {
    const trimmed = value.trim();
    let persisted = true;
    try {
      if (trimmed) await setConfigValue(name, trimmed);
      else await deleteConfigValue(name);
    } catch {
      persisted = false; // in-memory update below still drives this session; UI reports the failure
    }
    const keys = { ...get().keys };
    if (trimmed) keys[name] = trimmed;
    else delete keys[name];
    set({ keys });
    pushToRegistry({ keys, liveApis: get().liveApis });
    return persisted;
  },

  setLiveApis: async (on) => {
    try {
      if (on === null) await deleteConfigValue(LIVE_APIS);
      else await setConfigValue(LIVE_APIS, String(on));
    } catch {
      /* best-effort persist; the in-memory override below still drives this session */
    }
    set({ liveApis: on });
    pushToRegistry({ keys: get().keys, liveApis: on });
  },
}));

/** The effective live-APIs state right now (override if set, else the build default). */
export function effectiveLiveApis(): boolean {
  return liveApisEnabled();
}
