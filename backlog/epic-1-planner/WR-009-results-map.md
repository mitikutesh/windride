# WR-009 · Results — MapLibre map, wind-coloured routes, cards
Epic: 1 · Planner | Status: DONE | Depends on: WR-007, WR-008 | Size: L

## Goal
The payoff screen: top-3 candidates as cards (score ring, stats, ribbon, explanation) over a
MapLibre map where the selected route is drawn segment-by-segment in wind colours.

## Context (read first)
DESIGN.md (tokens, WindRibbon/ScoreRing reuse) · PRODUCT_SPEC §5–6 · API_NOTES §5.

## Acceptance criteria
- [x] MapLibre + OpenFreeMap liberty style; OSM attribution visible; map fits selected route.
- [x] Selected route rendered as a per-segment coloured line (tail/cross/head from scoring;
      shelter tint arrives in Epic 3); start marker; other candidates as faint ghosts,
      tappable to select.
- [x] Cards: rank, name (generated from dominant area/water/forest names is out of scope —
      use "Route A/B/C" + distance), score ring, distance · wind-aware ETA · ascent,
      WindRibbon, explanation line, headwind-km stat.
- [x] "Wind-aware" caption on every duration; selecting a card syncs the map and vice versa.
- [x] 60 fps pan on a mid phone: segments merged into one GeoJSON source with per-feature
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

Shipped: `RouteMap.tsx` (MapLibre + OpenFreeMap `liberty`, OSM attribution, fitBounds to the
selected route, "Map unavailable" fallback where WebGL is absent), `RouteCard.tsx` (rank badge,
"Route A/B/C" + distance, ScoreRing, StatCells incl. wind-aware ETA and headwind-km, WindRibbon,
explanation line, keyboard-accessible), `routeGeo.ts` (`classifyWindKind`, `routeToWindGeoJSON`,
`routeToRibbon`), `windColors.ts`, and a rewritten `ResultsScreen.tsx` wiring cards ↔ map via
`resultsStore.selectedId`.

Key decisions:
- Single GeoJSON source, per-feature `line-color` (`['get','color']`) for the selected route
  instead of N layers, satisfying the 60 fps acceptance criterion in one draw call.
- `windColors.ts` is a second sanctioned raw-hex location (see DEC-017): MapLibre's WebGL paint
  can't read CSS custom properties, so the four semantic hues plus ghost/start map-chrome colours
  are mirrored there, whitelisted by `scripts/check-tokens.mjs`, and asserted equal to
  `tokens.css` by `windColors.test.ts`.
- The MapLibre `<Map>` created once on mount; sources/layers updated imperatively on
  selection/candidate change (no React re-render churn), per the story's technical notes.
- Route naming is rank-based ("Route A/B/C") — no geocoding/area-name generation, as scoped.
- `RouteMap` itself is intentionally not unit-tested (WebGL); `ResultsScreen` tests mock it and
  cover card rendering, select-to-sync, and the empty state. `vitest.setup.ts` now stubs
  `window.URL.createObjectURL` so `maplibre-gl` imports cleanly under jsdom.
- 147 tests passing; lint and build green.
