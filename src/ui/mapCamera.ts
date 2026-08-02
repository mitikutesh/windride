/**
 * ui/mapCamera.ts — the follow-the-rider camera, as pure maths (WR-053, NAVIGATION_SPEC §9).
 *
 * Kept out of RideMap because jsdom has no WebGL: `new maplibregl.Map()` throws in tests and the
 * component renders its fallback, so anything computed inside it is untestable. RideMap's job is
 * reduced to "call cameraTargetFor, hand the result to easeTo".
 */
import { smallestAngle, normalizeDeg } from '../engine/geometry';
import type { LatLon } from '../domain';

/** Metres across the view when the caller has no preference. */
export const DEFAULT_ACROSS_M = 600;

/**
 * Cruise zoom is a LOOK-AHEAD TIME policy, not a speed offset (WR-055).
 *
 * The old rule was `250 + speedKmh × 40`, which nobody had measured: at 25 km/h it put 1250 m across
 * the view, and with the rider 72% down the visible band that is ~1190 m — **171 seconds** — of road
 * ahead. Navigation convention is 25–40 s, and it is why a 20 m junction rendered as ~6 px.
 *
 * Derivation of the coefficient: the unobstructed band ahead of the rider is ~0.95 × the view width
 * at the live layout, so showing `T` seconds of road at `v` m/s needs `v × T / 0.95` metres across.
 * With T = 30 s that is `8.75 × speedKmh` — 219 m at 25 km/h (a 20 m junction ≈ 36 px).
 */
export const ZOOM_LOOKAHEAD_S = 30;
export const ZOOM_ACROSS_PER_KMH = 8.75;
/** Stopped or crawling, still show enough context to place yourself. */
export const ZOOM_MIN_ACROSS_M = 200;
/** Descending fast is not a reason to lose all detail. */
export const ZOOM_MAX_ACROSS_M = 900;

/**
 * Junction approach (WR-055). Deliberately a function of DISTANCE ONLY — the tempting rule is to
 * reuse the cue trigger (`scaledTriggerDistanceM(CUE_PREPARE_M, speed)`) so voice and camera agree,
 * but that threshold shrinks as the rider brakes for the corner, faster than the remaining distance
 * does, so the zoom would pop back out exactly when they slow down. The cue engine gets away with it
 * because it latches fired cues; a camera re-evaluates every fix.
 *
 * These are NOT `CUE_PREPARE_M` / `CUE_TURN_M` despite sharing their values: those are speed-scaled
 * and these are not, so they must not be "unified" later.
 */
export const ZOOM_APPROACH_M = 200;
export const ZOOM_PLATEAU_M = 40;
export const ZOOM_JUNCTION_ACROSS_M = 140;
/** A zoom change bigger than this many levels gets the long ease (see CAMERA_LONG_EASE_MS). */
export const CAMERA_LONG_ZOOM_DELTA = 1.5;
/**
 * Where the rider sits in the usable map band in heading-up mode, 0 = top, 1 = bottom. 0.72 leaves
 * roughly three-quarters of the visible map showing the road AHEAD, which is the point of rotating.
 */
export const PUCK_FRACTION = 0.72;
/** A rotation bigger than this gets the longer ease — see CAMERA_LONG_EASE_MS. */
export const CAMERA_LONG_ROTATION_DEG = 90;
export const CAMERA_EASE_MS = 500;
/**
 * Recentring after free-look (or a just-accepted reroute) can ask for a near-180° turn in one go;
 * snapping that round in 500 ms is unpleasant, so big rotations get longer.
 */
export const CAMERA_LONG_EASE_MS = 900;

/** Map chrome covering the top/bottom of the map container, in CSS pixels. */
export interface CameraInsets {
  top: number;
  bottom: number;
}

export interface CameraInput {
  /**
   * What the camera centres on. NOT necessarily the rider marker's position: at junction zoom 1 m is
   * ~2.8 px, so following the raw fix slides the whole basemap ~14 px per second under a stationary
   * chevron on ordinary standing GPS wander. On-track the caller passes the SNAPPED point (steady);
   * off-track it passes the raw fix, because then where the rider truly is matters more than a calm
   * map. The marker itself always shows the raw fix — that is WR-051, and it is about the marker.
   */
  anchor: LatLon;
  containerW: number;
  containerH: number;
  /** Metres across the view; falls back to DEFAULT_ACROSS_M when absent or non-positive. */
  zoomM: number | null | undefined;
  /** Whether the rider has chosen heading-up. */
  headingUp: boolean;
  /** Gated travel bearing (RideState.mapBearingDeg); null ⇒ nothing to rotate to yet. */
  mapBearingDeg: number | null;
  /** The map's live bearing — `map.getBearing()`, which returns −180..180. */
  currentBearingDeg: number;
  /** The map's live zoom level — `map.getZoom()`. Only used to size the ease. */
  currentZoom: number;
  insets: CameraInsets;
  /** Battery saver: jump instead of easing. */
  snap: boolean;
}

export interface CameraTarget {
  center: [number, number];
  zoom: number;
  bearing: number;
  /** Screen-space [x, y] shift of the rider from the container centre; +y draws them lower. */
  offset: [number, number];
  duration: number;
  /** Ask MapLibre to ease even under prefers-reduced-motion. */
  essential: boolean;
}

/** Metres across the view at cruise: a constant ~30 s of road ahead, clamped at both ends. */
export function cruiseZoomM(speedKmh: number): number {
  const across = Math.max(0, speedKmh) * ZOOM_ACROSS_PER_KMH;
  return Math.round(Math.max(ZOOM_MIN_ACROSS_M, Math.min(ZOOM_MAX_ACROSS_M, across)));
}

/**
 * Metres across the view given how close the next maneuver is (`RideState.turnProximityM`).
 * Full cruise beyond ZOOM_APPROACH_M, tightest inside ZOOM_PLATEAU_M — a plateau rather than a point,
 * so the view is already tight when the rider reaches the junction and stays tight through it — and a
 * straight ramp between. Never wider than cruise, so a slow rider never gets zoomed OUT by a turn.
 */
export function turnApproachZoomM(proximityM: number | null, cruiseM: number): number {
  if (proximityM === null || proximityM > ZOOM_APPROACH_M) return cruiseM;
  if (proximityM <= ZOOM_PLATEAU_M) return Math.min(cruiseM, ZOOM_JUNCTION_ACROSS_M);
  const t = (proximityM - ZOOM_PLATEAU_M) / (ZOOM_APPROACH_M - ZOOM_PLATEAU_M); // 0 at the node
  const across = ZOOM_JUNCTION_ACROSS_M + t * (cruiseM - ZOOM_JUNCTION_ACROSS_M);
  return Math.round(Math.min(cruiseM, across));
}

/** MapLibre zoom level that shows ~`metres` across a `widthPx`-wide viewport at latitude `lat`. */
export function zoomForMetres(metres: number, lat: number, widthPx: number): number {
  const C = 40075016.686; // equatorial circumference (m)
  const mpp = metres / Math.max(1, widthPx); // target metres per pixel across the width
  const z = Math.log2((C * Math.cos((lat * Math.PI) / 180)) / (512 * mpp)); // 512px tiles (MapLibre)
  return Math.min(20, Math.max(1, z));
}

/**
 * The camera to ease to for one fix.
 *
 * `offset` rather than `padding`: MapLibre's EdgeInsets PERSIST any inset not re-supplied, and
 * `fitBounds` ADDS transform padding to its own — so a heading-up padding would leak into north-up
 * forever and corrupt the whole-route fit. `offset` is per-call, screen-space, never stored, and is
 * not rotated by bearing, so "lower on the screen" stays lower whichever way the map faces.
 */
export function cameraTargetFor(input: CameraInput): CameraTarget {
  const { anchor, containerW, containerH, zoomM, headingUp, mapBearingDeg, insets, snap } = input;
  // Heading-up only takes effect once a bearing exists: until then "up" is not yet known, so
  // biasing the rider down the screen would push them away from nothing in particular.
  const active = headingUp && mapBearingDeg !== null;
  const bearing = active ? normalizeDeg(mapBearingDeg) : 0;

  const across = zoomM && zoomM > 0 ? zoomM : DEFAULT_ACROSS_M;
  const zoom = zoomForMetres(across, anchor.lat, Math.max(1, containerW));

  let offset: [number, number] = [0, 0];
  if (active) {
    const height = Math.max(1, containerH);
    // Measured inside the band the chrome actually leaves visible (turn card above, stats panel
    // below), not as a flat fraction of the container — a flat fraction lands the rider under the
    // panel on a live ride.
    const usableH = Math.max(1, height - insets.top - insets.bottom);
    const targetY = insets.top + PUCK_FRACTION * usableH;
    offset = [0, Math.round(targetY - height / 2)];
  }

  // Size the ease by how far the camera actually has to move. Rotation alone is not enough: an Auto
  // tap or an accepted reroute can move several zoom levels with no rotation at all.
  const turning = smallestAngle(input.currentBearingDeg, bearing) > CAMERA_LONG_ROTATION_DEG;
  const zooming = Math.abs(zoom - input.currentZoom) > CAMERA_LONG_ZOOM_DELTA;
  return {
    center: [anchor.lon, anchor.lat],
    zoom,
    bearing,
    offset,
    duration: snap ? 0 : turning || zooming ? CAMERA_LONG_EASE_MS : CAMERA_EASE_MS,
    // MapLibre zeroes ease durations under prefers-reduced-motion. A rider who explicitly turned
    // heading-up ON is better served by a smooth rotation than by the map snapping round, so this
    // opts that one case back into easing; north-up keeps the platform default untouched.
    essential: active,
  };
}
