# WR-009 · Results — MapLibre map, wind-coloured routes, cards
Epic: 1 · Planner | Status: TODO | Depends on: WR-007, WR-008 | Size: L

## Goal
The payoff screen: top-3 candidates as cards (score ring, stats, ribbon, explanation) over a
MapLibre map where the selected route is drawn segment-by-segment in wind colours.

## Context (read first)
DESIGN.md (tokens, WindRibbon/ScoreRing reuse) · PRODUCT_SPEC §5–6 · API_NOTES §5.

## Acceptance criteria
- [ ] MapLibre + OpenFreeMap liberty style; OSM attribution visible; map fits selected route.
- [ ] Selected route rendered as a per-segment coloured line (tail/cross/head from scoring;
      shelter tint arrives in Epic 3); start marker; other candidates as faint ghosts,
      tappable to select.
- [ ] Cards: rank, name (generated from dominant area/water/forest names is out of scope —
      use "Route A/B/C" + distance), score ring, distance · wind-aware ETA · ascent,
      WindRibbon, explanation line, headwind-km stat.
- [ ] "Wind-aware" caption on every duration; selecting a card syncs the map and vice versa.
- [ ] 60 fps pan on a mid phone: segments merged into one GeoJSON source with per-feature
      colour, not N layers.

## Test contract
Pure helper `routeToWindGeoJSON(candidate)` unit-tested (feature count = segment count,
colour mapping per kind). Interaction test: card select ↔ map highlight state.

## Technical notes
MapLibre inside React: create map once, imperatively update sources (no re-render churn).
Colour from tokens via a small ts mirror of the four semantic hexes (single source noted in
DESIGN §1) — add a test asserting ts mirror === tokens.css values.

## Out of scope
Detail screen/elevation chart (WR-022); heat strip (WR-020).

## Log
