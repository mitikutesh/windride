/**
 * engine/rideRecap.ts — post-ride AI summary: facts + prompt + validator (WR-049).
 *
 * PURE (engine rules). Fed ONLY numbers WindRide computed from the rider's OWN recording
 * (summarizeRide → RideSummary), so the recap can narrate the ride but cannot invent it. Wind mix
 * and headwind-avoided are present only when the ride was linked to a plan; otherwise the recap
 * speaks to distance/time/speed alone. Own recordings only — Strava is never a source (CLAUDE.md).
 * The response is validated + dropped when malformed (engine stays authoritative, DEC-043).
 */
import type { RideSummary } from '../domain';

export interface RecapFacts {
  distanceKm: number;
  movingMin: number;
  elapsedMin: number;
  restMin: number;
  avgSpeedKmh: number;
  /** Share of moving time by wind relationship, when the ride was linked to a plan; else null. */
  windMix: { tailPct: number; crossPct: number; headPct: number } | null;
  /** Headwind km avoided vs the plan's median candidate, when that data exists; else null. */
  headwindAvoidedKm: number | null;
}

export interface Recap {
  summary: string;
  highlights: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Reduce a recorded ride's summary to grounded numbers for the recap. */
export function buildRecapFacts(s: RideSummary): RecapFacts {
  let windMix: RecapFacts['windMix'] = null;
  if (s.windByKindS) {
    const { tail, cross, head } = s.windByKindS;
    const total = tail + cross + head;
    if (total > 0) {
      windMix = {
        tailPct: Math.round((tail / total) * 100),
        crossPct: Math.round((cross / total) * 100),
        headPct: Math.round((head / total) * 100),
      };
    }
  }
  return {
    distanceKm: round1(s.distanceM / 1000),
    movingMin: Math.round(s.movingS / 60),
    elapsedMin: Math.round(s.elapsedS / 60),
    restMin: Math.max(0, Math.round((s.elapsedS - s.movingS) / 60)),
    avgSpeedKmh: round1(s.avgSpeedMs * 3.6),
    windMix,
    headwindAvoidedKm: typeof s.headwindAvoidedKm === 'number' ? round1(s.headwindAvoidedKm) : null,
  };
}

const SYSTEM = [
  "You write a short, friendly recap of a cyclist's completed ride.",
  'You are given ONLY numbers computed from their own recording. Do not invent anything not in them',
  '(no places, no weather beyond the wind mix given). Be encouraging but honest. Prefer metric.',
  'Return ONLY JSON: {"summary": string (<=160 chars), "highlights": string[] (0-4 short items)}.',
].join(' ');

/** The AI request for a recap — a plain object (structurally an adapters/ai AiRequest). */
export function recapRequest(facts: RecapFacts): {
  system: string;
  prompt: string;
  maxTokens: number;
} {
  return {
    system: SYSTEM,
    prompt: `Recorded ride (already computed — do not contradict):\n${JSON.stringify(
      facts,
      null,
      2,
    )}\n\nWrite the recap as specified.`,
    maxTokens: 400,
  };
}

const MAX_ITEMS = 4;
const MAX_LEN = 200;

function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, MAX_LEN) : null;
}

/** Validate a model response into a Recap, or null to reject it (the feature then no-ops). */
export function parseRecap(raw: unknown): Recap | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const summary = cleanStr(o.summary);
  if (!summary) return null;
  let highlights: string[] = [];
  if (o.highlights !== undefined) {
    if (!Array.isArray(o.highlights)) return null;
    // Any malformed element (a number, an object, an empty string) rejects the WHOLE response —
    // never partial-trust a schema violation (DEC-043). Count is a UI safety cap, not a trust call.
    const cleaned: string[] = [];
    for (const h of o.highlights) {
      const s = cleanStr(h);
      if (s === null) return null;
      cleaned.push(s);
    }
    highlights = cleaned.slice(0, MAX_ITEMS);
  }
  return { summary, highlights };
}
