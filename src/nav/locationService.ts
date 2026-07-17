/**
 * nav/locationService.ts — browser geolocation wrapped as a FixSource (WR-013, NAVIGATION_SPEC §1).
 *
 * Interchangeable with ReplaySource: the Ride screen (WR-016) depends only on FixSource, so desk
 * replay and a real phone GPS are swapped without touching nav logic. Permission/timeout errors are
 * mapped to the onError channel; the caller renders the denial/acquiring UX.
 */
import type { Fix, FixSource } from './fixSource';

/** Human-readable, UX-facing reason a geolocation source stopped producing fixes. */
export type GeoErrorKind = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeolocationError extends Error {
  constructor(
    readonly kind: GeoErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GeolocationError';
  }
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 1000,
  timeout: 15_000,
};

function mapPosition(pos: GeolocationPosition): Fix {
  const c = pos.coords;
  return {
    lat: c.latitude,
    lon: c.longitude,
    ele: c.altitude ?? undefined,
    time: new Date(pos.timestamp).toISOString(),
    speed: c.speed ?? undefined,
    accuracy: c.accuracy,
    heading: c.heading ?? undefined,
  };
}

function mapError(err: GeolocationPositionError): GeolocationError {
  // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  const kind: GeoErrorKind = err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable';
  return new GeolocationError(kind, err.message || kind);
}

/** watchPosition-backed FixSource. `geo` is injectable so tests need no real geolocation. */
export class GeolocationSource implements FixSource {
  private watchId: number | undefined;

  constructor(
    private readonly geo: Geolocation | undefined = typeof navigator !== 'undefined'
      ? navigator.geolocation
      : undefined,
    private readonly options: PositionOptions = DEFAULT_OPTIONS,
  ) {}

  start(onFix: (fix: Fix) => void, onError?: (err: Error) => void): void {
    if (!this.geo) {
      onError?.(
        new GeolocationError('unsupported', 'Geolocation is not available in this browser'),
      );
      return;
    }
    this.watchId = this.geo.watchPosition(
      (pos) => onFix(mapPosition(pos)),
      (err) => onError?.(mapError(err)),
      this.options,
    );
  }

  stop(): void {
    if (this.watchId !== undefined && this.geo) {
      this.geo.clearWatch(this.watchId);
      this.watchId = undefined;
    }
  }
}
