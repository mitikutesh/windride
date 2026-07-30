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

// ORS cycling profiles. NB: 'cycling-road' is the RACING profile — it prefers main/state roads and
// shuns cycleways (~17% state road in Helsinki), so the app maps "Road" to 'cycling-regular'
// (bike-friendly: ~57% cycleways) and "Gravel" to 'cycling-mountain' (prefers tracks/unpaved).
export type RouteProfile = 'cycling-regular' | 'cycling-road' | 'cycling-mountain';

export type RoundTripParams = {
  start: LatLon;
  lengthM: number;
  seed: number;
  points: 3 | 4 | 5;
  profile: RouteProfile;
};

export type Daylight = { sunrise: string; sunset: string };

/**
 * How a curated route earned its place in the catalog (WR-052): an OSM signed-network tier
 * (international / national / regional cycle network) or a hand-curated publisher route.
 * PROVENANCE ONLY — the engine never reads this, so a tier can never nudge a score.
 */
export type CurationTier = 'icn' | 'ncn' | 'rcn' | 'curated';

/**
 * One officially curated, signed route from the static catalog built by
 * `tools/fetch_curated_routes.mjs` (WR-052, DEC-060). Geometry is simplified to ~15 m with exact
 * endpoints; `lengthKm` is measured on that same simplified line, so km, map and ETA agree.
 */
export type CuratedRoute = {
  /** Stable across rebuilds: `osm-r-<relationId>` or `bikeland-<slug>`. */
  id: string;
  name: string;
  source: 'bikeland' | 'osm';
  tier: CurationTier;
  kind: 'loop' | 'linear';
  lengthKm: number;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  /** Required credit for this entry's source (ODbL for OSM, publisher credit for Bikeland). */
  attribution: string;
  /**
   * True when the signed route is mapped in disconnected pieces and this entry holds only its
   * longest continuous section — so the UI can say so instead of implying the whole route.
   */
  partial: boolean;
  polyline: LatLon[];
};

/** Summary of a recorded ride (WR-017). Times in seconds, distance in metres. */
export type RideSummary = {
  distanceM: number;
  elapsedS: number;
  movingS: number;
  avgSpeedMs: number;
  /** Seconds spent in each wind relationship, from the planned segments (when a plan is linked). */
  windByKindS?: { tail: number; cross: number; head: number };
  /** Headwind-km avoided vs the plan session's median candidate, when that data exists. */
  headwindAvoidedKm?: number;
};
