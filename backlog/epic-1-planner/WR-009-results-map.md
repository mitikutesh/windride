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

### Fable 5 review pass — fixes

A Fable 5 review found one BLOCKER and several SHOULD-FIX/NITs, all addressed; gate
(`npm test` = 149 passing, `npm run lint`, `npm run build`) green.

- **BLOCKER:** `ResultsScreen` passed *all* ranked candidates to `RouteMap` but only the top 3 to
  the cards, so tapping a rank-4+ ghost selected a candidate with no card — breaking the
  card↔map "vice versa" sync and risking a GPX export (WR-010) of a route never shown as a card.
  Fixed: the same top-3 slice is now passed to both the map and the cards.
- **SHOULD-FIX:** `RouteMap`'s async `'load'` handler captured `candidates`/`selectedId` at mount,
  so a selection change during the 1–2 s style load was silently dropped. It now mirrors
  `candidates`/`selectedId`/`onSelect` into refs and reads them from the load handler, removing
  the exhaustive-deps eslint-disable that had been hiding the bug.
- **SHOULD-FIX:** `routeToWindGeoJSON` drew each segment as a straight a→b chord between
  resampled endpoints, cutting corners by up to ~100 m and disagreeing with the ghost line (full
  polyline). It now includes the original intermediate polyline vertices that fall within each
  segment's distance range.
- **SHOULD-FIX:** the `RouteCard` "Headwind" stat is relabelled "Direct headwind" — it shows
  `evidence.directHeadwindKm` (delta > 150°), matching `explain.ts` wording, so it no longer reads
  "0.0 km" beside a red (≥120°) ribbon segment.
- **SHOULD-FIX:** `windColors.test.ts` now also asserts `MAP_COLORS.ghost === --text2` and
  `MAP_COLORS.start === --sky`, so the map-chrome mirror can't silently desync on a skin swap.
- **SHOULD-FIX:** the `ResultsScreen` test now proves *both* sync directions — card→map (the
  mocked map captures its props and its `selectedId` flips after a card click) and map→card
  (driving the captured `onSelect` marks the matching card `aria-pressed`).
- **NITs:** `routeGeo` test asserts `[lon, lat]` order (catches axis transposition); `RouteMap`
  clears the selected source and removes the marker when nothing is selected; the "Map
  unavailable" fallback now renders only on a genuine WebGL-construction failure (a state flag),
  not underneath the canvas during load.
