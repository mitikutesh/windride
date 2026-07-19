import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProviders, getTransitProvider, liveApisEnabled, setRuntimeConfig } from './registry';

afterEach(() => {
  vi.unstubAllEnvs();
  setRuntimeConfig({ keys: {}, liveApis: null }); // clear runtime overrides between tests
});

describe('getProviders', () => {
  it('returns mock providers when live APIs are off', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    expect(liveApisEnabled()).toBe(false);
    const providers = getProviders();
    expect(providers.weather).toBeDefined();
    expect(providers.routing).toBeDefined();
  });

  it('returns the live weather + ORS routing adapters when live APIs are on', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'true');
    expect(liveApisEnabled()).toBe(true);
    const providers = getProviders();
    // FMI HARMONIE (decorating Open-Meteo) is the live weather source; ORS the live router.
    expect(providers.weather.constructor.name).toBe('FmiWeatherProvider');
    expect(providers.routing.constructor.name).toBe('OrsRouteProvider');
  });
});

describe('runtime config (bring-your-own keys, task #33)', () => {
  it('a runtime liveApis override wins over the build-time env default', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'false');
    setRuntimeConfig({ keys: {}, liveApis: true }); // user turned live on in Settings
    expect(liveApisEnabled()).toBe(true);
    expect(getProviders().routing.constructor.name).toBe('OrsRouteProvider');
    setRuntimeConfig({ keys: {}, liveApis: false });
    expect(liveApisEnabled()).toBe(false);
    expect(getProviders().routing.constructor.name).toBe('MockRouteProvider');
  });

  it('liveApis:null follows the env default (no override set)', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'true');
    setRuntimeConfig({ keys: {}, liveApis: null });
    expect(liveApisEnabled()).toBe(true);
  });

  it('rebuilds the transit singleton only when the runtime Digitransit key changes', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'true');
    setRuntimeConfig({ keys: { digitransit: 'k1' }, liveApis: true });
    const a = getTransitProvider();
    expect(getTransitProvider()).toBe(a); // same key → same instance (its fetch cache survives)
    setRuntimeConfig({ keys: { digitransit: 'k2' }, liveApis: true });
    expect(getTransitProvider()).not.toBe(a); // key changed → rebuilt
  });
});
