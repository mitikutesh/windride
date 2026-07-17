/**
 * WindRide core domain types (WR-003). Authoritative signatures per ARCHITECTURE §4.
 *
 * These live at the src root (NOT under adapters/) on purpose: engine/** must import them, and
 * the module-boundary rule forbids engine importing from adapters/. Everything here is a plain
 * data type — no behaviour, no I/O. Units are SI (metres, m/s, seconds, degrees 0–360 CW from
 * true north); conversion happens at the UI edge only (DEC-008).
 */

export type LatLon = { lat: number; lon: number };

export type Surface = 'paved' | 'gravel' | 'path' | 'unknown';

export type Segment = {
  a: LatLon;
  b: LatLon;
  lengthM: number;
  bearingDeg: number;
  gradePct: number;
  surface?: Surface;
  /** ors waytype label. */
  wayClass?: string;
  /** 0.35–1.15; default 1.0 until the Epic 3 exposure grid lands. */
  exposure: number;
};

export type WindSample = {
  windMs: number;
  /** Meteorological: the direction the wind comes FROM (see CLAUDE.md domain warnings). */
  windFromDeg: number;
  gustMs: number;
  precipProb: number;
  tempC: number;
  /** Apparent ("feels like") temperature in °C, when the provider supplies it. */
  feelsC?: number;
  /** ISO-8601 local hour, e.g. "2026-07-10T17:00". */
  time: string;
};

/**
 * Weather samples indexed [pointIdx][hourIdx] — the OUTER index is the route point, the INNER
 * index is the forecast hour. Encoded as a named type because the transpose is a classic bug
 * (WR-003 technical notes). Use `WindGrid[p][h]`.
 */
export type WindGrid = WindSample[][];

export type TurnStep = {
  instruction: string;
  distanceM: number;
  durationS?: number;
  /** ors maneuver type code. */
  type?: number;
  /** [startIdx, endIdx] into the route polyline. */
  wayPoints?: [number, number];
};

export type CandidateRoute = {
  id: string;
  polyline: LatLon[];
  segments: Segment[];
  distanceM: number;
  ascentM: number;
  /** Provider turn instructions, kept for Epic 2 navigation. */
  steps?: TurnStep[];
};

export type RouteProfile = 'cycling-regular' | 'cycling-road';

export type RoundTripParams = {
  start: LatLon;
  lengthM: number;
  seed: number;
  points: 3 | 4 | 5;
  profile: RouteProfile;
};

export type Daylight = { sunrise: string; sunset: string };
