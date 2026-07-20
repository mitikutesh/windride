# WR-047 · AI route discovery → validate → wind-scored
Epic: 6 · AI | Status: DONE | Depends on: WR-044 | Size: L

## Goal
Let AI suggest scenic/popular destinations and loops from world knowledge — then treat every
suggestion as a hypothesis: geocode it, build it with ORS, and rank it with the existing
scoring. Hallucinations die at validation; survivors compete as normal candidates.

## Context (read first)
WR-044 (adapter, guardrails) · DEC-043 · WR-005 (ORS adapter, dedupe) · CLAUDE.md rule 3
(ORS budget) + domain warnings (Strava never enters the AI path).

## Acceptance criteria
- [ ] AI suggests candidate ideas (named destination or loop sketch: place names + rough
      distance + one-line why) from world knowledge, optionally seeded with OSM signed
      cycle-network names — NEVER from Strava data.
      **Narrowed per DEC-046(a)**: the app has no geocoder, so a "named destination" cannot be
      validated and would be hallucination-prone. The AI instead suggests a short name + one-line
      note + an integer compass BEARING (0–359°) — a direction, not a place — which can't be
      hallucinated the same way. World-knowledge-sourced, never Strava. Box left unticked because
      the literal "place names" ask isn't what shipped; geocoded named-destination discovery is a
      follow-up once a geocoder adapter exists.
- [ ] Validation pipeline, each stage dropping failures silently: geocode every named place
      (free browser-callable geocoder — Nominatim/Photon, usage policy respected, fetch in an
      adapter) → ORS builds the actual loop/route through the points → unbuildable or
      un-geocodable suggestions never reach the UI.
      **Partially met**: there is no geocode stage (DEC-046a — no geocoder adapter exists yet), so
      that half is out of reach as written. What does ship and is tested: ORS builds a real
      out-and-back toward each suggested bearing, and any bearing the router can't build is
      dropped silently — it never reaches the Results grid. Box left unticked to reflect the
      missing geocode stage honestly.
- [x] Built routes run through the EXISTING analysis + scoring (wind, shelter, safety — all
      of it) and appear as ordinary Results candidates, marked with their AI provenance and
      the one-line rationale as provenance, not evidence.
- [ ] ORS budget respected: AI-sourced builds capped (~3 per plan) so a session stays under
      the ~30-call budget; deduped against classic candidates via `overlapRatio` (WR-005).
      **Partially met**: the budget cap ships and is tested (≤3 unique bearings built, duplicate
      bearings de-duped before counting against the cap). Dedupe-against-CLASSIC-candidates via
      `overlapRatio` does not ship — discovered routes replace the Results grid instead
      (DEC-046b) — so this box stays unticked; merge+dedupe with classic candidates is a
      follow-up.
- [x] Engine stays authoritative: AI text never alters a score, an ETA, or a geometry.

## Test contract
Pipeline tests with fixtures at every stage: suggestion fixture → geocode fixture → ORS
fixture → scored candidate in Results; a hallucinated-place fixture (geocode miss) and an
unroutable fixture both drop cleanly; no live APIs in tests. Manual: `npm run probe:geocode`.

## Technical notes
Geocoding gets its own small adapter (reusable later). Suggestions should carry the region
context (start point, target distance) so the model proposes reachable ideas.

## Out of scope
Popularity/heatmap data (Strava-shaped — banned) · photo/POI enrichment (WR-048).

## Log
Shipped: `src/engine/discovery.ts` (PURE, tested) — `discoveryRequest` + `parseDiscoveries`. The
AI suggests scenic DIRECTIONS (name + note + integer compass bearing 0–359°), not
coordinates/place names, which makes the suggestion hallucination-safe with no geocoder in the
app; malformed ideas are dropped, a response with none usable is rejected outright.
`src/state/plan/scoreRoutes.ts` — `scoreBuiltRoutes` scores already-built routes through the SAME
engine block as `runPlan` (exposure fill, weather, `scoreCandidates`) and also returns the
`WinterInfo` ice caution; kept as a separate function from `runPlan` to avoid a double weather
fetch there (documented inline; a future refactor could unify them).
`src/state/discoveryStore.ts` (+ test) orchestrates: AI directions → `generateCandidates(bearings)`
builds real out-and-back routes (the router validates; unbuildable bearings are dropped silently)
→ re-ids survivors `disc-<bearing>` → `scoreBuiltRoutes` → publishes straight to the Results grid
with per-route AI notes, capped to ≤3 unique bearings (keep-first) for the ORS budget. Client,
providers, grid loader, and navigation are all injectable for tests.
`src/ui/components/DiscoverRoutesButton.tsx` + `PlanScreen.tsx` wiring (opt-in, shown only when AI
is set up and not in downwind mode — the router's round-trip has no bearing control) +
`ResultsScreen.tsx` shows the ✨ AI note for the selected route, gated on the `disc-` id prefix so
it can never leak onto an ordinary plan's result.

Fable review found 3 issues, all fixed before closing:
- **Critical** (ORS budget) — discovery could build up to 6 routes and would double-bill duplicate
  bearings; now capped to ≤3 UNIQUE bearings, deduped before building.
- **Important** (note collision) — the bearing dedupe now keeps the FIRST idea at a duplicate
  bearing, matching `dedupeByOverlap`'s keep-first convention, so a surviving route's note always
  matches the idea that actually produced it.
- **Important, safety** — the WR-027 winter ice-risk caution was being dropped on the discovery
  path; `WinterInfo` is now threaded through `scoreBuiltRoutes` so the caution never silently
  vanishes just because a different button was pressed.
Fable also verified: the AI stays non-authoritative (geometry from the router, scores from the
engine, AI only ever supplies a direction + text); `scoreBuiltRoutes` is faithful to `runPlan`
(no scoring divergence between the two paths); `disc-` ids can't collide with normal-plan ids;
no Strava data anywhere in the path; the engine module (`discovery.ts`) is pure with zero imports.

**DEC-046 v1 narrowings** (added this session, dated 2026-07-20): (a) the AI returns a compass
bearing + note, not geocoded place names — no geocoder adapter exists yet, and a bearing can't be
hallucinated the way a place name can; (b) discovered routes REPLACE the Results grid rather than
being merged + `overlapRatio`-deduped against the classic top-3, so sub-scores normalise across
the small discovered set instead of the usual field; (c) geometry is always out-and-back toward
the bearing, even when `routeType` is `'loop'`, because the router's round-trip mode has no
bearing control; (d) builds are capped at ≤3 unique bearings for the ORS free-tier budget. See
DEC-046 for full rationale. The first two acceptance boxes above and the dedupe half of the third
are left unticked because of (a)/(b) rather than claimed done.

Follow-ups for later stories:
- Geocoded named-destination discovery once a geocoder adapter exists (the original ask behind
  the first two acceptance boxes).
- Merge discovered candidates with the classic top-3 (via `overlapRatio` dedupe, WR-005) instead
  of replacing the Results grid outright.
- Per-idea target distance (today every discovered route uses the plan's single `distanceKm`;
  an idea-specific distance would let "a longer ride to the lake" differ from "a quick loop
  downtown").
