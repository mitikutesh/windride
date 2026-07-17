import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProviders, liveApisEnabled } from './registry';

afterEach(() => {
  vi.unstubAllEnvs();
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
    expect(providers.weather.constructor.name).toBe('OpenMeteoProvider');
    expect(providers.routing.constructor.name).toBe('OrsRouteProvider');
  });
});
