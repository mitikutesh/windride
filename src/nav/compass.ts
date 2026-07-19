/**
 * nav/compass.ts — device-compass heading source (task #32): the "which way the phone points"
 * signal that complements the GPS travel bearing (see nav/heading.ts `blendHeading`).
 *
 * Wraps DeviceOrientation the way locationService wraps geolocation — an injectable, swappable sensor
 * so nav stays testable without a real phone (nav tests run under node, with no `window`).
 *
 * Two platform shapes, one reading:
 *  - iOS Safari fires `deviceorientation` carrying `webkitCompassHeading` — already true-north and
 *    clockwise, exactly the heading we want — but gates the sensor behind a user-gesture permission
 *    (`DeviceOrientationEvent.requestPermission`).
 *  - Other browsers fire `deviceorientationabsolute` with `alpha` (counter-clockwise from north);
 *    the compass heading is `(360 - alpha) % 360`.
 * Relative-only orientation (`absolute === false`, no webkit heading) is not a compass and is dropped.
 *
 * Limitation (documented follow-up): the alpha→heading conversion assumes the phone is held flat-ish
 * in the default screen orientation. Full tilt/screen-orientation compensation (what Maps does) is a
 * later refinement; the GPS bearing already carries the load whenever the rider is actually moving.
 */
import { circularEma, HEADING_EMA_ALPHA } from './heading';
import { normalizeDeg } from '../engine/geometry';

/** Whether the device exposes a usable compass, and if so whether the owner allowed it. */
export type CompassPermission = 'granted' | 'denied' | 'unsupported';

/** The non-standard fields our two supported platforms add to a DeviceOrientationEvent. */
interface OrientationReading {
  alpha: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
}

/** Minimal event-target surface (window in the app; a fake in tests). */
export interface OrientationTarget {
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
}

/** iOS-style permission gate; resolves to the platform's permission state. */
export type OrientationPermissionRequester = () => Promise<'granted' | 'denied' | string>;

/**
 * Extract a true-north, clockwise compass heading (0..360) from an orientation event, or null when
 * the event carries no absolute heading (e.g. relative-only orientation on Android). Pure.
 *
 * `fromAbsoluteEvent` says the reading arrived on the `deviceorientationabsolute` event, which is
 * absolute by definition — so we honour its alpha even if the browser omits the `absolute` field
 * (some do), rather than silently dropping every reading.
 */
export function compassHeadingOf(
  reading: OrientationReading,
  fromAbsoluteEvent = false,
): number | null {
  const webkit = reading.webkitCompassHeading;
  if (typeof webkit === 'number' && Number.isFinite(webkit)) {
    return normalizeDeg(webkit); // iOS: already the heading the device points, clockwise from north
  }
  const isAbsolute = reading.absolute || fromAbsoluteEvent;
  if (isAbsolute && typeof reading.alpha === 'number' && Number.isFinite(reading.alpha)) {
    return normalizeDeg(360 - reading.alpha); // absolute alpha is CCW from north → CW heading
  }
  return null;
}

function defaultTarget(): OrientationTarget | undefined {
  return typeof window !== 'undefined' ? (window as unknown as OrientationTarget) : undefined;
}

/** The platform's permission requester, or null when there is no gate (Android/desktop). */
function nativeRequester(): OrientationPermissionRequester | null {
  if (typeof window === 'undefined') return null;
  const ctor = (window as { DeviceOrientationEvent?: { requestPermission?: unknown } })
    .DeviceOrientationEvent;
  return ctor && typeof ctor.requestPermission === 'function'
    ? () => (ctor.requestPermission as OrientationPermissionRequester)()
    : null;
}

/**
 * DeviceOrientation-backed compass. `target`/`requester` are injectable so tests need no real sensor.
 * Emitted headings are circular-EMA smoothed to tame magnetometer jitter.
 */
export class CompassHeadingSource {
  private handler: ((e: Event) => void) | null = null;
  private eventName: 'deviceorientationabsolute' | 'deviceorientation' | null = null;
  private smoothed: number | null = null;

  constructor(
    private readonly target: OrientationTarget | undefined = defaultTarget(),
    private readonly alpha: number = HEADING_EMA_ALPHA,
  ) {}

  /**
   * Ask for compass access. On iOS this MUST be called from a user gesture (e.g. the Start button).
   * Where no permission gate exists the sensor is open; where DeviceOrientation is absent entirely,
   * reports 'unsupported'. `requester` is injectable for tests.
   */
  static async requestPermission(
    requester: OrientationPermissionRequester | null = nativeRequester(),
  ): Promise<CompassPermission> {
    if (!requester) {
      // No gate. If orientation events exist at all, treat as granted; otherwise unsupported.
      return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
        ? 'granted'
        : 'unsupported';
    }
    try {
      return (await requester()) === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied'; // a rejected/blocked prompt is a denial, not a crash
    }
  }

  /** Begin emitting smoothed compass headings (deg, 0..360). start() implies stop() of any prior. */
  start(onHeading: (deg: number) => void): void {
    this.stop();
    if (!this.target) return;
    // Prefer the absolute event where it exists (Android/Chrome); fall back to plain
    // deviceorientation (iOS carries webkitCompassHeading there).
    this.eventName =
      'ondeviceorientationabsolute' in this.target
        ? 'deviceorientationabsolute'
        : 'deviceorientation';
    const fromAbsolute = this.eventName === 'deviceorientationabsolute';
    this.handler = (e: Event) => {
      const heading = compassHeadingOf(e as unknown as OrientationReading, fromAbsolute);
      if (heading === null) return; // relative-only / no absolute heading — not a compass reading
      this.smoothed =
        this.smoothed === null ? heading : circularEma(this.smoothed, heading, this.alpha);
      onHeading(this.smoothed);
    };
    this.target.addEventListener(this.eventName, this.handler);
  }

  stop(): void {
    if (this.handler && this.eventName && this.target) {
      this.target.removeEventListener(this.eventName, this.handler);
    }
    this.handler = null;
    this.eventName = null;
    this.smoothed = null;
  }
}
