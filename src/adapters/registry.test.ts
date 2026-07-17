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

  it('throws when live APIs are requested (adapters land in WR-004/WR-005)', () => {
    vi.stubEnv('VITE_LIVE_APIS', 'true');
    expect(liveApisEnabled()).toBe(true);
    expect(() => getProviders()).toThrow(/Live providers/);
  });
});
