/**
 * nav/mapBearing.ts — the bearing the RIDE MAP is rotated to in heading-up mode (WR-053,
 * NAVIGATION_SPEC §9). Position-driven: no clock, no speed, no compass.
 *
 * Why this is not just `RideState.headingDeg`: that value is `blendHeading()` output, which below
 * `HEADING_GPS_TRUST_LOW_MS` is *pure device compass* — and `compass.ts` documents that the Android
 * alpha→heading conversion assumes a roughly-flat phone with no tilt compensation. Rotating the
 * whole map from it would spin the world while the rider stands still with the phone in a pocket.
 * Worse, around the crossfade midpoint (~1.9 m/s) `circularBlend` returns the dominant-weight
 * endpoint, so a slow climb with the phone facing backwards flips `headingDeg` by 180° between
 * fixes — as a map bearing that reads as an endless slow rotate-and-rotate-back.
 *
 * So the map consumes the GPS TRAVEL bearing only (`HeadingSmoother`, already circular-EMA
 * smoothed) and holds whenever it can't be trusted. The rider puck still uses the blended heading —
 * that is exactly what DEC-033 is for; only the map ignores the compass.
 *
 * Why displacement and not speed: `RideController.speedOf` falls back to `haversine/dt` when the
 * platform gives no `coords.speed`, so a few metres of GPS wander at a standstill reads as several
 * m/s — a speed gate would open in the very case it exists to block. Net displacement from the last
 * committed position does not accumulate under wander, so it is the honest signal here.
 *
 * There is deliberately no EMA and no slew limit: fixes arrive at ~1 Hz, where an EMA needs ~10 s to
 * finish a 90° corner (far too slow to fix the left/right confusion this story exists for) and a
 * per-second slew cap never binds. MapLibre's `easeTo` is the smoother, and it already rotates the
 * short way round.
 */
import type { LatLon } from '../domain';
import { haversineM, normalizeDeg, smallestAngle } from '../engine/geometry';

/** Net movement since the last committed bearing before the map is re-oriented. */
export const MAP_BEARING_COMMIT_M = 10;
/**
 * A single-fix position jump beyond this is an outage or a teleport, never riding (60 m in ~1 s is
 * 216 km/h). The straight-line chord bearing across a GPS gap is meaningless on a loop or a
 * switchback (DEC-058), so such a fix re-anchors without ever reaching the map.
 */
export const MAP_BEARING_JUMP_M = 60;
/** Below this change the map is left alone — stops micro-rotation on a straight road. */
export const MAP_BEARING_DEADBAND_DEG = 5;

/**
 * Gates the travel bearing into a map bearing. Stateful like `HeadingSmoother`: feed it every fix,
 * it returns the bearing the map should hold right now, or null before the first commit (the map
 * simply stays north-up until the rider has actually moved).
 */
export class MapBearingGate {
  private bearingDeg: number | null = null;
  /** Position of the last commit — the origin the commit distance is measured from. */
  private anchor: LatLon | null = null;
  /** Previous fix, for jump detection (which is about fix-to-fix distance, not distance to anchor). */
  private lastPos: LatLon | null = null;

  /**
   * @param p the raw fix position
   * @param travelHeadingDeg the GPS-only travel bearing (`HeadingSmoother.update`), null until known
   * @returns the map bearing to hold, or null while none has been established
   */
  update(p: LatLon, travelHeadingDeg: number | null): number | null {
    const jumped = this.lastPos !== null && haversineM(this.lastPos, p) > MAP_BEARING_JUMP_M;
    this.lastPos = p;
    // Re-anchor on a jump/first fix without committing: the next fixes measure their 10 m from
    // here, so a post-outage bearing is only accepted once real riding has resumed.
    if (jumped || this.anchor === null) {
      this.anchor = p;
      return this.bearingDeg;
    }
    if (travelHeadingDeg === null) return this.bearingDeg;
    if (haversineM(this.anchor, p) < MAP_BEARING_COMMIT_M) return this.bearingDeg;
    // Far enough to re-evaluate: advance the anchor even if the deadband keeps the bearing, so a
    // stationary-ish rider can't bank distance and lurch later.
    this.anchor = p;
    // The deadband compares against the COMMITTED bearing, never the previous heading, so the map
    // can never drift more than MAP_BEARING_DEADBAND_DEG away from the true travel direction.
    if (
      this.bearingDeg !== null &&
      smallestAngle(this.bearingDeg, travelHeadingDeg) < MAP_BEARING_DEADBAND_DEG
    ) {
      return this.bearingDeg;
    }
    this.bearingDeg = normalizeDeg(travelHeadingDeg);
    return this.bearingDeg;
  }

  get current(): number | null {
    return this.bearingDeg;
  }
}
