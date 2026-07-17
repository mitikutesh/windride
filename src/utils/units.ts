/**
 * utils/units.ts — SI -> display conversions at the UI edge (DEC-008). Pure.
 */
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 8-point compass label for a bearing (0 = north, clockwise). */
export function compass8(deg: number): (typeof COMPASS)[number] {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return COMPASS[idx];
}

/**
 * SVG rotation (deg) for a wind arrow that should point where the wind BLOWS TO — users read
 * arrows as flow. Given the meteorological wind_from, the arrow points to wind_from + 180.
 * Assumes the base glyph points up (north = 0deg).
 */
export function windArrowRotationDeg(windFromDeg: number): number {
  return (((windFromDeg + 180) % 360) + 360) % 360;
}

export function metresToKm(m: number, digits = 1): string {
  return (m / 1000).toFixed(digits);
}

export function msToKmh(ms: number, digits = 0): string {
  return (ms * 3.6).toFixed(digits);
}

/** Seconds -> "h:mm". */
export function formatDurationHM(totalS: number): string {
  const totalMin = Math.round(totalS / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** "2026-07-17T22:27" -> "22:27". */
export function timeOfDay(iso: string): string {
  const t = iso.split('T')[1] ?? iso;
  return t.slice(0, 5);
}
