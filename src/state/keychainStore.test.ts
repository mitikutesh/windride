import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as db from '../data/db';
import { deleteConfigValue, getConfig, setConfigValue } from '../data/db';
import { aiReady, liveApisEnabled, setRuntimeConfig } from '../adapters/registry';
import { useKeychainStore } from './keychainStore';

beforeEach(async () => {
  for (const n of ['ors', 'digitransit', 'ai', 'liveApis', 'aiProvider'])
    await deleteConfigValue(n);
  useKeychainStore.setState({ keys: {}, liveApis: null, aiProvider: null, hydrated: false });
  setRuntimeConfig({ keys: {}, liveApis: null, aiProvider: null });
});

afterEach(() => vi.unstubAllEnvs());

describe('useKeychainStore', () => {
  it('hydrates keys + live override from idb and pushes them to the registry', async () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    await setConfigValue('ors', 'ORS123');
    await setConfigValue('liveApis', 'true');

    await useKeychainStore.getState().hydrate();

    expect(useKeychainStore.getState().keys.ors).toBe('ORS123');
    expect(useKeychainStore.getState().liveApis).toBe(true);
    expect(liveApisEnabled()).toBe(true); // override reached the registry despite env=false
  });

  it('saveKey trims + persists to idb and clears on empty', async () => {
    await useKeychainStore.getState().saveKey('ors', '  KEY  ');
    expect((await getConfig()).ors).toBe('KEY'); // trimmed + persisted
    expect(useKeychainStore.getState().keys.ors).toBe('KEY');

    await useKeychainStore.getState().saveKey('ors', '   ');
    expect((await getConfig()).ors).toBeUndefined(); // whitespace clears it
    expect(useKeychainStore.getState().keys.ors).toBeUndefined();
  });

  it('setLiveApis overrides the switch, then null reverts to the env default', async () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    await useKeychainStore.getState().setLiveApis(true);
    expect((await getConfig()).liveApis).toBe('true');
    expect(liveApisEnabled()).toBe(true);

    await useKeychainStore.getState().setLiveApis(null);
    expect((await getConfig()).liveApis).toBeUndefined();
    expect(liveApisEnabled()).toBe(false); // back to the build default
  });

  it('stores the AI key like any other', async () => {
    await useKeychainStore.getState().saveKey('ai', 'sk-test');
    expect((await getConfig()).ai).toBe('sk-test');
    expect(useKeychainStore.getState().keys.ai).toBe('sk-test');
  });

  it('persists the AI provider and, with a key, makes AI ready in the registry', async () => {
    await useKeychainStore.getState().setAiProvider('anthropic');
    await useKeychainStore.getState().saveKey('ai', 'sk-test');
    expect((await getConfig()).aiProvider).toBe('anthropic');
    expect(aiReady()).toBe(true); // provider + key both reached the registry

    await useKeychainStore.getState().setAiProvider(null); // clearing it turns AI off
    expect((await getConfig()).aiProvider).toBeUndefined();
    expect(aiReady()).toBe(false);
  });

  it('hydrates a stored AI provider from idb (and ignores a junk value)', async () => {
    await setConfigValue('aiProvider', 'gemini');
    await useKeychainStore.getState().hydrate();
    expect(useKeychainStore.getState().aiProvider).toBe('gemini');

    // A corrupt/unknown value must not become the provider.
    await deleteConfigValue('aiProvider');
    await setConfigValue('aiProvider', 'bogus');
    useKeychainStore.setState({ aiProvider: null, hydrated: false });
    await useKeychainStore.getState().hydrate();
    expect(useKeychainStore.getState().aiProvider).toBeNull();
  });

  it('saveKey returns true on success and false when the idb write fails', async () => {
    expect(await useKeychainStore.getState().saveKey('ors', 'GOOD')).toBe(true);
    const spy = vi.spyOn(db, 'setConfigValue').mockRejectedValueOnce(new Error('quota'));
    const ok = await useKeychainStore.getState().saveKey('ors', 'X');
    expect(ok).toBe(false); // persistence failed…
    expect(useKeychainStore.getState().keys.ors).toBe('X'); // …but still usable this session
    spy.mockRestore();
  });

  it('a save landing mid-hydrate is not clobbered by the resolving snapshot', async () => {
    await setConfigValue('ors', 'FROM_IDB');
    // Simulate a user key set while hydrate()'s getConfig is still pending, then hydrate resolves.
    useKeychainStore.setState({ keys: { digitransit: 'FROM_USER' }, hydrated: false });
    await useKeychainStore.getState().hydrate();
    const { keys } = useKeychainStore.getState();
    expect(keys.digitransit).toBe('FROM_USER'); // the in-flight edit wins
    expect(keys.ors).toBe('FROM_IDB'); // idb value merged in underneath
  });
});
