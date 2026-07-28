import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_START, usePlanStore } from './planStore';

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
  Object.defineProperty(navigator, 'geolocation', {
    value: { getCurrentPosition },
    configurable: true,
  });
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
