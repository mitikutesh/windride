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
  it('produces a closed loop roughly the requested length', async () => {
    const r = await new MockRouteProvider().roundTrip(params);
    expect(r.distanceM).toBeGreaterThan(params.lengthM * 0.6);
    expect(r.distanceM).toBeLessThan(params.lengthM * 1.3);
    expect(r.polyline[0]).toEqual(r.polyline.at(-1));
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
