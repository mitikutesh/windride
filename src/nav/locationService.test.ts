import { describe, expect, it, vi } from 'vitest';
import type { Fix } from './fixSource';
import { GeolocationError, GeolocationSource } from './locationService';

/** Fake Geolocation that lets a test drive the success/error callbacks. */
function fakeGeo() {
  let success: PositionCallback | undefined;
  let failure: PositionErrorCallback | undefined;
  const clearWatch = vi.fn();
  const geo = {
    watchPosition: (ok: PositionCallback, err?: PositionErrorCallback | null) => {
      success = ok;
      failure = err ?? undefined;
      return 42;
    },
    clearWatch,
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  return {
    geo,
    clearWatch,
    emit: (p: Partial<GeolocationCoordinates>, timestamp = 1_752_744_000_000) =>
      success?.({ coords: p as GeolocationCoordinates, timestamp } as GeolocationPosition),
    fail: (code: number, message = 'x') => failure?.({ code, message } as GeolocationPositionError),
  };
}

describe('GeolocationSource', () => {
  it('maps a position into a Fix', () => {
    const f = fakeGeo();
    const src = new GeolocationSource(f.geo);
    const got: Fix[] = [];
    src.start((fix) => got.push(fix));
    f.emit({ latitude: 60.1, longitude: 24.9, altitude: 12, accuracy: 5, speed: 4.2, heading: 90 });
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      lat: 60.1,
      lon: 24.9,
      ele: 12,
      accuracy: 5,
      speed: 4.2,
      heading: 90,
    });
    expect(got[0].time).toBe(new Date(1_752_744_000_000).toISOString());
  });

  it('leaves optional fields undefined when the platform omits them', () => {
    const f = fakeGeo();
    const src = new GeolocationSource(f.geo);
    const got: Fix[] = [];
    src.start((fix) => got.push(fix));
    f.emit({
      latitude: 60,
      longitude: 24,
      altitude: null,
      accuracy: 8,
      speed: null,
      heading: null,
    });
    expect(got[0].ele).toBeUndefined();
    expect(got[0].speed).toBeUndefined();
    expect(got[0].heading).toBeUndefined();
    expect(got[0].accuracy).toBe(8);
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'timeout'],
  ] as const)('maps geolocation error code %i to kind %s', (code, kind) => {
    const f = fakeGeo();
    const src = new GeolocationSource(f.geo);
    let err: Error | undefined;
    src.start(
      () => {},
      (e) => (err = e),
    );
    f.fail(code);
    expect(err).toBeInstanceOf(GeolocationError);
    expect((err as GeolocationError).kind).toBe(kind);
  });

  it('reports unsupported when no geolocation is available', () => {
    const src = new GeolocationSource(undefined);
    let err: Error | undefined;
    src.start(
      () => {},
      (e) => (err = e),
    );
    expect((err as GeolocationError).kind).toBe('unsupported');
  });

  it('clears the watch on stop', () => {
    const f = fakeGeo();
    const src = new GeolocationSource(f.geo);
    src.start(() => {});
    src.stop();
    expect(f.clearWatch).toHaveBeenCalledWith(42);
  });
});
