/**
 * engine/nlPlan.ts — natural-language → validated plan settings (WR-046).
 *
 * PURE (engine rules): the model turns free text ("a 2h gravel loop, quiet roads, home before
 * dark") into a JSON object; parseNlPlan then CLAMPS every field to WindRide's real input ranges
 * and drops anything unrecognised, so the AI can only ever fill controls the user can already set —
 * never invent a value out of range or a field the app doesn't have. The user still reviews the
 * filled controls and taps Plan; nothing runs automatically (DEC-043, engine stays authoritative).
 *
 * Only fields that exist on PlanInputs are handled: distance, shape, surface, home-before-dark,
 * avoid-busy, winter, departure hour. Via-points and an explicit climb preference are NOT plan
 * inputs today, so they're intentionally out of scope here.
 */

/** A subset of PlanInputs the parser may fill — every field optional and pre-clamped. */
export interface NlPlanPatch {
  distanceKm?: number;
  routeType?: 'loop' | 'out-and-back' | 'downwind';
  surface?: 'road' | 'gravel';
  homeBeforeDark?: boolean;
  avoidBusy?: boolean;
  winter?: boolean;
  departureHour?: 0 | 3 | 6;
}

export interface NlPlan {
  patch: NlPlanPatch;
  /** A short human sentence describing what was understood, shown to the user before they Plan. */
  summary: string;
}

const ROUTE_TYPES = ['loop', 'out-and-back', 'downwind'] as const;
const SURFACES = ['road', 'gravel'] as const;
const DEPARTURE_HOURS: Array<0 | 3 | 6> = [0, 3, 6];

const DIST_MIN = 20;
const DIST_MAX = 100;
const DIST_STEP = 5;

function clampDistance(n: number): number {
  const snapped = Math.round(n / DIST_STEP) * DIST_STEP;
  return Math.min(DIST_MAX, Math.max(DIST_MIN, snapped));
}
function snapDeparture(n: number): 0 | 3 | 6 {
  return DEPARTURE_HOURS.reduce((best, h) => (Math.abs(h - n) < Math.abs(best - n) ? h : best), 0);
}

const SYSTEM = [
  "You convert a cyclist's free-text ride request into WindRide plan settings.",
  'Extract ONLY fields you are confident about; omit anything not stated or clearly implied.',
  'Allowed fields and values —',
  'distanceKm: a number from 20 to 100 km;',
  'durationMin: if the ride is described by TIME rather than distance, put the minutes here instead',
  'of distanceKm and do NOT convert it yourself (the app converts using the rider speed model);',
  'routeType: "loop" | "out-and-back" | "downwind";',
  'surface: "road" | "gravel";',
  'homeBeforeDark: boolean; avoidBusy: boolean; winter: boolean;',
  'departureHour: 0, 3, or 6 (hours from now).',
  'Also include "summary": one short sentence describing the settings you chose.',
  'Return ONLY a JSON object with those keys and nothing else.',
].join(' ');

/** The AI request for NL planning — a plain object (structurally an adapters/ai AiRequest). */
export function nlPlanRequest(text: string): { system: string; prompt: string; maxTokens: number } {
  return {
    system: SYSTEM,
    prompt: `Ride request: ${JSON.stringify(text.slice(0, 500))}`,
    maxTokens: 300,
  };
}

/** Flat, still-air base speeds (km/h) for duration→distance (DEC-004 defaults; callers pass the
 *  rider's calibrated values from the speed model). Wind + climb are applied later at plan time. */
export interface NlPlanSpeeds {
  roadKmh: number;
  gravelKmh: number;
}
const DEFAULT_SPEEDS: NlPlanSpeeds = { roadKmh: 27, gravelKmh: 21 };

/**
 * Validate + clamp a model response into an NlPlan, or null to reject it. Every field is checked
 * against its real range/enum; unrecognised or out-of-type fields are silently ignored (a partial
 * fill is fine), but a response with NO usable field at all is a rejection (the feature no-ops).
 * A stated duration is converted to distance via the speed model's base speed for the chosen
 * surface — never naive generic math (CLAUDE.md), and an explicit distance always wins.
 */
export function parseNlPlan(raw: unknown, speeds: NlPlanSpeeds = DEFAULT_SPEEDS): NlPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const patch: NlPlanPatch = {};

  // Surface first: it selects the base speed used for any duration→distance conversion below.
  if (typeof o.surface === 'string' && (SURFACES as readonly string[]).includes(o.surface)) {
    patch.surface = o.surface as NlPlanPatch['surface'];
  }
  if (typeof o.routeType === 'string' && (ROUTE_TYPES as readonly string[]).includes(o.routeType)) {
    patch.routeType = o.routeType as NlPlanPatch['routeType'];
  }
  if (typeof o.homeBeforeDark === 'boolean') patch.homeBeforeDark = o.homeBeforeDark;
  if (typeof o.avoidBusy === 'boolean') patch.avoidBusy = o.avoidBusy;
  if (typeof o.winter === 'boolean') patch.winter = o.winter;
  if (typeof o.departureHour === 'number' && Number.isFinite(o.departureHour)) {
    patch.departureHour = snapDeparture(o.departureHour);
  }

  if (typeof o.distanceKm === 'number' && Number.isFinite(o.distanceKm)) {
    patch.distanceKm = clampDistance(o.distanceKm); // an explicit distance always wins
  } else if (
    typeof o.durationMin === 'number' &&
    Number.isFinite(o.durationMin) &&
    o.durationMin > 0
  ) {
    const kmh = patch.surface === 'gravel' ? speeds.gravelKmh : speeds.roadKmh;
    patch.distanceKm = clampDistance((o.durationMin / 60) * kmh);
  }

  if (Object.keys(patch).length === 0) return null; // nothing usable ⇒ failed interpretation
  const summary =
    typeof o.summary === 'string' && o.summary.trim().length > 0
      ? o.summary.trim().slice(0, 160)
      : '';
  return { patch, summary };
}
