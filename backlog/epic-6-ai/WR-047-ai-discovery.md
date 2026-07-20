# WR-047 · AI route discovery → validate → wind-scored
Epic: 6 · AI | Status: TODO | Depends on: WR-044 | Size: L

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
- [ ] Validation pipeline, each stage dropping failures silently: geocode every named place
      (free browser-callable geocoder — Nominatim/Photon, usage policy respected, fetch in an
      adapter) → ORS builds the actual loop/route through the points → unbuildable or
      un-geocodable suggestions never reach the UI.
- [ ] Built routes run through the EXISTING analysis + scoring (wind, shelter, safety — all
      of it) and appear as ordinary Results candidates, marked with their AI provenance and
      the one-line rationale as provenance, not evidence.
- [ ] ORS budget respected: AI-sourced builds capped (~3 per plan) so a session stays under
      the ~30-call budget; deduped against classic candidates via `overlapRatio` (WR-005).
- [ ] Engine stays authoritative: AI text never alters a score, an ETA, or a geometry.

## Test contract
Pipeline tests with fixtures at every stage: suggestion fixture → geocode fixture → ORS
fixture → scored candidate in Results; a hallucinated-place fixture (geocode miss) and an
unroutable fixture both drop cleanly; no live APIs in tests. Manual: `npm run probe:geocode`.

## Technical notes
Geocoding gets its own small adapter (reusable later). Suggestions should carry the region
context (start point, target distance) so the model proposes reachable ideas.

## Out of scope
Popularity/heatmap data (Strava-shaped — banned) · photo/POI enrichment (WR-048).
