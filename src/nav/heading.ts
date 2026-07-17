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

/** EMA of two angles done on the unit circle so it wraps correctly across 0°/360°. */
function circularEma(prevDeg: number, sampleDeg: number, alpha: number): number {
  const sin = (1 - alpha) * Math.sin(deg2rad(prevDeg)) + alpha * Math.sin(deg2rad(sampleDeg));
  const cos = (1 - alpha) * Math.cos(deg2rad(prevDeg)) + alpha * Math.cos(deg2rad(sampleDeg));
  return normalizeDeg(rad2deg(Math.atan2(sin, cos)));
}
