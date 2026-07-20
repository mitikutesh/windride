/**
 * engine/discovery.ts — AI route discovery: prompt + validator (WR-047).
 *
 * PURE (engine rules). The model suggests scenic/popular *directions* to ride from the start — a
 * compass bearing + a short human note — NOT coordinates or street names (those would be
 * hallucination-prone). WindRide then builds a real loop toward each bearing with the router and
 * runs it through the existing wind/shelter/safety scoring, so "scenic" is always combined with
 * today's wind and the geometry always comes from the router, never the model (DEC-043). Strava is
 * never consulted (CLAUDE.md) — these are AI world-knowledge suggestions, not activity data.
 */

export interface Discovery {
  /** A short name for the idea, e.g. "Northwest lake forests". */
  name: string;
  /** One line on why it's worth riding (scenery, terrain). */
  note: string;
  /** Compass bearing from the start, 0–359° (0 = north, 90 = east). */
  bearingDeg: number;
}

const MAX_IDEAS = 6;
const MAX_LEN = 200;

const SYSTEM = [
  'You suggest scenic or popular cycling DIRECTIONS to explore from a start point.',
  'For each idea give: name (short), note (one line on the scenery/terrain), and bearingDeg',
  '(an integer compass bearing 0–359 from the start, 0=N 90=E 180=S 270=W).',
  'Do NOT invent street names, trail names, or coordinates — give a general direction and feel only.',
  'Suggest directions likely to be pleasant for the given distance and surface.',
  `Return ONLY JSON: {"ideas": [{"name": string, "note": string, "bearingDeg": number}]} (up to ${MAX_IDEAS}).`,
].join(' ');

/** The AI request for discovery — a plain object (structurally an adapters/ai AiRequest). */
export function discoveryRequest(
  area: string,
  distanceKm: number,
  surface: string,
): { system: string; prompt: string; maxTokens: number } {
  return {
    system: SYSTEM,
    prompt: `Start area: ${area}. Desired ride: about ${Math.round(distanceKm)} km on ${surface}. Suggest directions.`,
    maxTokens: 500,
  };
}

function cleanStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, MAX_LEN) : null;
}

/**
 * Validate a model response into a list of discoveries, or null if none are usable. Each idea needs
 * a name, a note, and an in-range bearing; anything malformed is dropped. Bearings are normalised to
 * an integer 0–359. A response with no usable idea is a rejection (the feature no-ops).
 */
export function parseDiscoveries(raw: unknown): Discovery[] | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const ideas = (raw as { ideas?: unknown }).ideas;
  if (!Array.isArray(ideas)) return null;

  const out: Discovery[] = [];
  for (const item of ideas) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Record<string, unknown>;
    const name = cleanStr(o.name);
    const note = cleanStr(o.note);
    if (!name || !note) continue;
    if (typeof o.bearingDeg !== 'number' || !Number.isFinite(o.bearingDeg)) continue;
    const bearingDeg = ((Math.round(o.bearingDeg) % 360) + 360) % 360;
    out.push({ name, note, bearingDeg });
    if (out.length >= MAX_IDEAS) break;
  }
  return out.length > 0 ? out : null;
}
