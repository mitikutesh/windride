/**
 * engine/briefing.ts — grounded facts + prompt + validator for the AI ride briefing (WR-045).
 *
 * PURE (engine rules): no I/O, no DOM, no Date.now — the caller passes `now`. The briefing is fed
 * ONLY numbers WindRide already computed for the selected route + today's conditions, so the model
 * can advise but cannot invent facts (no roads, no weather beyond these numbers). The response is
 * validated here and dropped when malformed, so the engine stays the source of truth (DEC-043).
 * Nothing here derives from Strava — Strava data never enters the AI path (CLAUDE.md).
 *
 * The request builder returns a plain { system, prompt, maxTokens } object (structurally an
 * adapters/ai `AiRequest`) rather than importing the adapter — engine never imports adapters.
 */
import type { ScoredCandidate } from './scoring';

/** Today's forecast conditions, reduced to the primitives the briefing needs (UI maps Conditions). */
export interface BriefingConditions {
  tempC: number | null;
  feelsC: number | null;
  windMs: number;
  windFromDeg: number;
  gustMs: number;
  /** Rain chance as a PERCENT (0–100) — the app-wide convention (Open-Meteo %, FMI, scoring). */
  precipProb: number;
  /** ISO sunset time, or null when daylight is unknown. */
  sunset: string | null;
}

export interface BriefingWinter {
  iceRisk: boolean;
  minTempC: number | null;
}

/** The whitelisted, already-computed numbers handed to the model — nothing else reaches the prompt. */
export interface BriefingFacts {
  distanceKm: number;
  durationMin: number;
  ascentM: number;
  gravelKm: number;
  pavedKm: number;
  tempC: number | null;
  feelsC: number | null;
  windFromCompass: string;
  windFromDeg: number;
  windMs: number;
  gustMs: number;
  maxGustMs: number;
  gustyKm: number;
  rainChancePct: number;
  headwindKm: number;
  tailwindKm: number;
  /** Minutes of daylight left when you'd finish (sunset − ETA); null when sunset is unknown. */
  daylightMarginMin: number | null;
  ice: BriefingWinter | null;
}

export interface Briefing {
  summary: string;
  clothing: string[];
  fuel: string;
  safety: string[];
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass8(deg: number): string {
  return COMPASS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
/** Clamp a percent rain chance into 0–100 (defensive; the input is already a percent). */
function clampPct(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p)));
}

/**
 * Assemble the grounded facts for one selected, scored route + today's conditions. Deterministic
 * given `rideStartMs` (the planned ride-start epoch, used for the daylight margin at ETA). Reads
 * only pre-computed aggregates — never any raw provider payload — so there is nothing to
 * hallucinate from.
 */
export function buildBriefingFacts(
  scored: Pick<ScoredCandidate, 'evidence' | 'analysis'>,
  cond: BriefingConditions,
  rideStartMs: number,
  winter?: BriefingWinter | null,
): BriefingFacts {
  const e = scored.evidence;
  const totalTimeS = scored.analysis.totalTimeS;
  const sunsetMs = cond.sunset ? Date.parse(cond.sunset) : NaN;
  const daylightMarginMin = Number.isFinite(sunsetMs)
    ? Math.round((sunsetMs - (rideStartMs + totalTimeS * 1000)) / 60000)
    : null;

  return {
    distanceKm: round1(e.distanceKm),
    durationMin: Math.round(totalTimeS / 60),
    ascentM: Math.round(e.ascentM),
    gravelKm: round1(e.gravelKm),
    pavedKm: round1(Math.max(0, e.distanceKm - e.gravelKm)),
    tempC: cond.tempC,
    feelsC: cond.feelsC,
    windFromCompass: compass8(cond.windFromDeg),
    windFromDeg: Math.round(cond.windFromDeg),
    windMs: round1(cond.windMs),
    gustMs: round1(cond.gustMs),
    maxGustMs: round1(e.maxGustMs),
    gustyKm: round1(e.gustyKm),
    rainChancePct: clampPct(cond.precipProb),
    headwindKm: round1(e.headwindKm),
    tailwindKm: round1(e.tailwindKm),
    daylightMarginMin,
    ice: winter ?? null,
  };
}

const SYSTEM = [
  'You are a concise cycling assistant embedded in a wind-aware route planner.',
  "You are given ONLY computed facts about one planned ride and today's forecast conditions.",
  'Advise practically for THIS ride. Never invent specifics you were not given: no place names,',
  'no road names, no weather beyond the numbers provided. Prefer metric units. Keep items short.',
  'Return JSON exactly: {"summary": string (<=140 chars), "clothing": string[] (2-5 items),',
  '"fuel": string (one line), "safety": string[] (0-4 items)}.',
].join(' ');

/** The AI request for a briefing — a plain object (structurally an adapters/ai AiRequest). */
export function briefingRequest(facts: BriefingFacts): {
  system: string;
  prompt: string;
  maxTokens: number;
} {
  return {
    system: SYSTEM,
    prompt: `Ride facts (already computed — do not contradict or add to them):\n${JSON.stringify(
      facts,
      null,
      2,
    )}\n\nWrite the briefing as specified.`,
    maxTokens: 500,
  };
}

const MAX_ITEMS = 6;
const MAX_LEN = 240;

function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, MAX_LEN) : null;
}
function cleanList(v: unknown, min: number): string[] | null {
  if (!Array.isArray(v)) return null;
  const items = v
    .map(cleanStr)
    .filter((s): s is string => s !== null)
    .slice(0, MAX_ITEMS);
  return items.length >= min ? items : null;
}

/**
 * Validate a model response into a Briefing, or null to reject it (the feature then no-ops). Caps
 * item counts + string lengths defensively so a runaway response can't blow up the UI (DEC-043).
 */
export function parseBriefing(raw: unknown): Briefing | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const summary = cleanStr(o.summary);
  const clothing = cleanList(o.clothing, 1);
  const fuel = cleanStr(o.fuel);
  if (!summary || !clothing || !fuel) return null;
  // safety is optional: absent ⇒ []. But present-and-malformed (e.g. a bare string) is a rejection,
  // never a silent drop — dropping the one section that carries hazards would be the worst place to
  // partial-trust a bad response (DEC-043).
  let safety: string[] = [];
  if (o.safety !== undefined) {
    const parsed = cleanList(o.safety, 0);
    if (parsed === null) return null;
    safety = parsed;
  }
  return { summary, clothing, fuel, safety };
}
