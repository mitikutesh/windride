import { describe, expect, it } from 'vitest';
import type { RoundTripParams } from '../../domain';
import { describeRouteProviderContract } from '../providerContract';
import { MockRouteProvider } from './mock';

describeRouteProviderContract(
  'MockRouteProvider',
  () => new MockRouteProvider(),
  (kind) => new MockRouteProvider({ failWith: kind }),
);

const params: RoundTripParams = {
  start: { lat: 60.15, lon: 24.65 },
  lengthM: 50_000,
  seed: 3,
  points: 4,
  profile: 'cycling-regular',
};

describe('MockRouteProvider', () => {
  it('honours the requested round-trip length', async () => {
    const r = await new MockRouteProvider().roundTrip(params);
    expect(r.distanceM).toBe(50_000);
  });

  it('keeps the provider turn steps for later navigation', async () => {
    const r = await new MockRouteProvider().roundTrip(params);
    expect(r.steps?.length).toBeGreaterThan(0);
    expect(r.steps?.[0].instruction).toBeTypeOf('string');
  });

  it('encodes the seed in the candidate id', async () => {
    const r = await new MockRouteProvider().roundTrip(params);
    expect(r.id).toContain('3');
  });
});
