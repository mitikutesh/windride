/**
 * engine/wind.ts — wind decomposition (WR-007, SCORING_SPEC §2). Pure.
 *
 * Sign convention (the bug this guards): forecast wind_direction is METEOROLOGICAL — the
 * direction the wind blows FROM. Travel frame uses wind_to = (wind_from + 180) mod 360.
 * v_par is + for tailwind, − for headwind. The three §2 must-pass cases are unit-tested.
 */
import { deg2rad, normalizeDeg, smallestAngle } from './geometry';

export interface WindComponents {
  /** Direction the wind blows TO (travel frame), 0..360. */
  windToDeg: number;
  /** Angle between travel bearing and wind_to, 0..180. */
  deltaDeg: number;
  /** Exposure-adjusted wind speed (m/s). */
  effectiveMs: number;
  /** Along-track component (m/s): + tailwind, − headwind. */
  vParMs: number;
  /** Cross-track component magnitude (m/s), always >= 0. */
  vCrossMs: number;
  /** Exposure-adjusted gust (m/s). */
  gustEffMs: number;
}

export function decompose(
  bearingDeg: number,
  windFromDeg: number,
  windMs: number,
  exposure = 1,
  gustMs = 0,
): WindComponents {
  const windToDeg = normalizeDeg(windFromDeg + 180);
  const deltaDeg = smallestAngle(bearingDeg, windToDeg);
  const effectiveMs = windMs * exposure;
  const delta = deg2rad(deltaDeg);
  return {
    windToDeg,
    deltaDeg,
    effectiveMs,
    vParMs: effectiveMs * Math.cos(delta),
    vCrossMs: Math.abs(effectiveMs * Math.sin(delta)),
    gustEffMs: gustMs * exposure,
  };
}
