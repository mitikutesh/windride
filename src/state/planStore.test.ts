import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../adapters/errors';
import { DEFAULT_START, planFailureReason, usePlanStore } from './planStore';

// generate() must fail fast AFTER the locate gate — these tests assert the gate, not the pipeline.
vi.mock('../adapters/registry', () => ({
  getProviders: () => {
    throw new Error('no providers in this test');
  },
  getTransitProvider: () => null,
}));

type GeoSuccess = (pos: GeolocationPosition) => void;
type GeoError = (err: GeolocationPositionError) => void;

function stubGeolocation(impl: (ok: GeoSuccess, fail: GeoError) => void) {
  const getCurrentPosition = vi.fn(impl);
  // stubGlobal, not Object.defineProperty(navigator, …): these tests run in the plain `node`
  // environment, and Node 20 (the CI pin) has no global `navigator` to define properties on.
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

const at = (lat: number, lon: number) =>
  ({ coords: { latitude: lat, longitude: lon } }) as GeolocationPosition;

beforeEach(() => {
  usePlanStore.setState((s) => ({
    inputs: { ...s.inputs, start: DEFAULT_START },
    startSource: 'default',
    status: 'idle',
  }));
});

describe('planStore start location (WR-051 stale-start fix)', () => {
  it('locate() adopts the current position and marks the start as geo', async () => {
    stubGeolocation((ok) => ok(at(61.5, 23.75)));
    await usePlanStore.getState().locate();
    const s = usePlanStore.getState();
    expect(s.inputs.start).toEqual({ lat: 61.5, lon: 23.75 });
    expect(s.startSource).toBe('geo');
    expect(s.status).toBe('idle');
  });

  it('locate() failure keeps the previous start (and its source)', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1 } as GeolocationPositionError));
    await usePlanStore.getState().locate();
    const s = usePlanStore.getState();
    expect(s.inputs.start).toEqual(DEFAULT_START);
    expect(s.startSource).toBe('default');
  });

  it('setInput touching start marks it manual; other patches leave the source alone', () => {
    usePlanStore.getState().setInput({ distanceKm: 60 });
    expect(usePlanStore.getState().startSource).toBe('default');
    usePlanStore.getState().setInput({ start: { lat: 60.2, lon: 24.9 } });
    expect(usePlanStore.getState().startSource).toBe('manual');
  });

  it('generate() re-fetches the location first — every new plan starts from where the rider IS', async () => {
    const geo = stubGeolocation((ok) => ok(at(62.6, 29.76))); // moved to Joensuu since last plan
    usePlanStore.setState((s) => ({
      inputs: { ...s.inputs, start: { lat: 60.17, lon: 24.65 } }, // stale persisted location
      startSource: 'geo',
    }));
    await usePlanStore.getState().generate(); // pipeline itself errors (mocked registry) — fine
    expect(geo).toHaveBeenCalled();
    expect(usePlanStore.getState().inputs.start).toEqual({ lat: 62.6, lon: 29.76 });
  });

  it('generate() never clobbers a hand-set (manual) start', async () => {
    const geo = stubGeolocation((ok) => ok(at(62.6, 29.76)));
    usePlanStore.setState((s) => ({
      inputs: { ...s.inputs, start: { lat: 59.33, lon: 18.07 } },
      startSource: 'manual',
    }));
    await usePlanStore.getState().generate();
    expect(geo).not.toHaveBeenCalled();
    expect(usePlanStore.getState().inputs.start).toEqual({ lat: 59.33, lon: 18.07 });
  });
});

// The "/goal" fix: a bad or missing ORS key must be named as a key problem — the blanket
// "You appear to be offline" is reserved for when the browser is actually offline.
describe('planFailureReason (explanatory failure copy)', () => {
  it('blames the key, not the connection, when the provider rejected it', () => {
    const msg = planFailureReason(new ProviderError('badResponse', 'rejected', 'auth'));
    expect(msg).toMatch(/API key/i);
    expect(msg).not.toMatch(/offline/i);
  });

  it('points at Kit → API keys when no key is configured', () => {
    expect(planFailureReason(new ProviderError('badResponse', 'missing', 'no-key'))).toMatch(
      /Kit → API keys/,
    );
  });

  it("never claims offline for an 'unreachable' failure (online but blocked — e.g. bad key)", () => {
    const msg = planFailureReason(new ProviderError('network', 'blocked', 'unreachable'));
    expect(msg).not.toMatch(/appear to be offline/i);
    expect(msg).toMatch(/API key/i);
  });

  it("keeps the offline copy for an 'offline'-coded failure", () => {
    expect(planFailureReason(new ProviderError('network', 'down', 'offline'))).toMatch(
      /appear to be offline/i,
    );
  });

  it("surfaces a timeout as a timeout, not as 'offline'", () => {
    expect(planFailureReason(new ProviderError('network', 'slow', 'timeout'))).toMatch(/too long/i);
  });

  it('includes the provider detail for unexpected responses', () => {
    expect(planFailureReason(new ProviderError('badResponse', 'no route feature'))).toMatch(
      /no route feature/,
    );
  });
});
