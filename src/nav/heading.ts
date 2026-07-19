/**
 * nav/heading.ts — travel heading from fix-to-fix bearings (WR-016 technical note). Pure.
 *
 * At cycling speed the GPS track bearing is a better heading than the magnetometer (phone in a bag/
 * pocket points anywhere). We smooth successive bearings with a circular EMA and ignore near-
 * stationary fixes, whose bearing is noise.
 */
import type { LatLon } from '../domain';
import { bearingDeg, deg2rad, normalizeDeg, rad2deg } from '../engine/geometry';

export const HEADING_EMA_ALPHA = 0.3;
/** Below this fix-to-fix distance the bearing is GPS jitter, not travel — hold the last heading. */
export const HEADING_MIN_MOVE_M = 2;

/** Below this ground speed the GPS course is unreliable — lean fully on the device compass. */
export const HEADING_GPS_TRUST_LOW_MS = 0.8; // ~2.9 km/h — barely rolling
/** At/above this ground speed the GPS course is solid — ignore the (bag/pocket) compass entirely. */
export const HEADING_GPS_TRUST_HIGH_MS = 3.0; // ~10.8 km/h — cruising cyclist

export class HeadingSmoother {
  private headingDeg: number | null = null;
  private last: LatLon | null = null;
  private readonly alpha: number;

  constructor(alpha: number = HEADING_EMA_ALPHA) {
    this.alpha = alpha;
  }

  /** Feed the next position; returns the smoothed heading (deg, 0..360) or null until known. */
  update(p: LatLon): number | null {
    if (this.last) {
      const mLon = 111_320 * Math.cos((this.last.lat * Math.PI) / 180);
      const moved = Math.hypot((p.lat - this.last.lat) * 111_320, (p.lon - this.last.lon) * mLon);
      if (moved >= HEADING_MIN_MOVE_M) {
        const b = bearingDeg(this.last, p);
        this.headingDeg =
          this.headingDeg === null ? b : circularEma(this.headingDeg, b, this.alpha);
        this.last = p;
      }
    } else {
      this.last = p;
    }
    return this.headingDeg;
  }

  get current(): number | null {
    return this.headingDeg;
  }
}

/**
 * Below this resultant magnitude the two angles are ~opposite: their vector sum nearly cancels, so
 * the blended direction is ill-defined and `atan2` whips ~180° on tiny input noise. 0.02 covers a
 * ±~2° band around exactly-opposite (magnitude ≈ |cos(Δ/2)|).
 */
const BLEND_DEGENERATE_MAG = 0.02;

/**
 * Blend two angles on the unit circle: `t` is the weight toward `bDeg` (0 → aDeg, 1 → bDeg).
 * Wraps correctly across 0°/360° (350° blended with 10° yields ~0°, not ~180°). When the two angles
 * are ~opposite there is no meaningful average, so it returns the dominant-weight endpoint (stable)
 * rather than an atan2 result that flips on noise.
 */
export function circularBlend(aDeg: number, bDeg: number, t: number): number {
  const w = Math.max(0, Math.min(1, t));
  const sin = (1 - w) * Math.sin(deg2rad(aDeg)) + w * Math.sin(deg2rad(bDeg));
  const cos = (1 - w) * Math.cos(deg2rad(aDeg)) + w * Math.cos(deg2rad(bDeg));
  if (Math.hypot(sin, cos) < BLEND_DEGENERATE_MAG) return normalizeDeg(w >= 0.5 ? bDeg : aDeg);
  return normalizeDeg(rad2deg(Math.atan2(sin, cos)));
}

/** EMA of two angles done on the unit circle so it wraps correctly across 0°/360°. */
export function circularEma(prevDeg: number, sampleDeg: number, alpha: number): number {
  return circularBlend(prevDeg, sampleDeg, alpha);
}

/**
 * Blend the GPS travel bearing with the device-compass heading into one display heading (task #32).
 *
 * At cycling speed the GPS course is the truth (the phone's magnetometer points wherever the phone
 * sits in a bag/pocket); when stopped or barely rolling the GPS course is noise and the compass —
 * "which way the phone points" — is all we have. Speed drives a crossfade between the two so the map
 * arrow behaves like Google Maps: it snaps to travel once moving and swings to the compass at rest.
 * Returns null only when neither source is known yet.
 */
export function blendHeading(
  travelDeg: number | null,
  compassDeg: number | null,
  speedMs: number,
): number | null {
  if (compassDeg === null) return travelDeg;
  if (travelDeg === null) return compassDeg;
  const span = HEADING_GPS_TRUST_HIGH_MS - HEADING_GPS_TRUST_LOW_MS;
  const towardTravel = (speedMs - HEADING_GPS_TRUST_LOW_MS) / span; // 0 at rest → 1 when cruising
  return circularBlend(compassDeg, travelDeg, towardTravel);
}
