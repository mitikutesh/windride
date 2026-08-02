# WR-057 · On-map junction: the path we follow, unmistakable
Epic: 2 · Navigator | Status: DONE | Depends on: WR-055, WR-056 | Size: S

## Goal
The last piece of the owner's report (2026-08-02): *"it should zoom, clearly show **the other options
and the one we should follow**"*. WR-055 delivered the zoom — the map now shows ~140 m across at a
junction and the basemap draws every other road. Two things still undercut it:

1. The route was a **flat 6 px line at every zoom**. At junction zoom that line no longer covers the
   road it follows, so *which* road it takes was ambiguous — exactly the question asked.
2. The route was added with **no `beforeId`**, so it painted **over the basemap's street labels** —
   and those labels are precisely how a rider tells our road apart from the others.

## Context (read first)
NAVIGATION_SPEC §9b (zoom policy — the zooms these widths bracket) · DEC-065 (this story) ·
`ui/mapLayers.ts` `firstSymbolLayerId` · `ui/windColors.ts` for why the casing colour is what it is.

## Acceptance criteria
- [x] The route widens as the rider zooms in and thins out over the whole route, so at a junction it
      reads as a bold ribbon rather than a thread beside the road.
- [x] It carries a dark casing that stays legible against the LIGHT default basemap.
- [x] Basemap street labels draw on top of the route — the other options are readable.
- [x] An arrow at the junction node points the way the route leaves it, and keeps pointing down that
      road as the map rotates in heading-up mode.
- [x] The reroute proposal and gust warnings still draw above everything.
- [x] `npm test && npm run lint && npm run build` green.

## Test contract
`cues.ts` `nextManeuver`: finds the next junction; skips the arrival step (otherwise the finish line
gets a turn arrow drawn on it), "continue straight", and chain-suppressed followers; undefined past
the last one and on a step-less route. Controller: `junction.at` is the fold of the out-and-back
fixture and `outBearingDeg` is ~180° from the outbound bearing — the strongest available check that the
bearing is the OUTGOING one, not the arriving one; null once the last maneuver is behind. RideMap's
layers and marker are not unit-testable (jsdom has no WebGL, so the component renders its fallback),
which is why the camera and cue maths live in pure modules.

## Out of scope
WR-058 (turn cues for step-less routes) · highlighting every junction rather than the next one ·
lane guidance · extracting the other branches from vector tiles.

## Log
Shipped:
- `src/nav/cues.ts` — `nextManeuver(cues, progressM)`.
- `src/nav/rideController.ts` — `RideState.junction = { at, outBearingDeg }` and `JUNCTION_EXIT_M`
  (25 m). The outgoing bearing is a chord over that window: short enough that the chord IS the road's
  direction, so no averaging helper was needed — `pointAtDistance` and `bearingDeg` already existed.
- `src/ui/components/RideMap.tsx` — `wr-route-casing` (`MAP_COLORS.arrowHalo`) under a
  zoom-interpolated `wr-route`; route, casing and direction arrows all inserted before the basemap's
  first symbol layer; a `junction` prop driving a DOM marker.
- `src/ui/screens/RideScreen.tsx` — the arrow appears only once the junction is inside
  `ZOOM_APPROACH_M`, and never during a reroute preview.
- `src/ui/components/components.css` — `.wr-junctionmarker`, tokens only.

Decisions (DEC-065). The design shrank a lot from the roadmap sketch:
- **The separate sliced "junction corridor" source was dropped.** It needed a `NextTurn.atM`, a
  unified `slicePolyline` (one already exists privately in `nav/reroute.ts`), a new source, two more
  layers and more prop threading — and at 140 m across the visible route basically IS the junction, so
  slicing adds almost nothing over making the route bolder as the rider zooms in.
- **The casing is dark, not near-white.** The first sketch used `MAP_COLORS.arrow` (`#f1f5ec`), but
  `DEFAULT_BASEMAP` is `'streets'` = the OpenFreeMap **Liberty** style, which is *light* — a near-white
  casing would have vanished into white and yellow roads. `arrowHalo` (mirroring `--bg`) gives a strong
  outline with no new colour token.
- **The arrow is a DOM marker, not a symbol layer.** A canvas icon returns null in jsdom (so the layer
  would silently disappear in tests) and would have to hardcode hex; a marker styles itself from the
  design tokens exactly like the rider chevron.

Both corrections above came from the WR-055 design red-team, which had reviewed this same design in
passing. No fresh red-team was spawned for this story for that reason.

**Accepted visible change:** street labels now draw over the route line. That is standard cartography
and what Maps does, but it is a change worth a look on a real ride.

Follow-ups:
- `nav/reroute.ts` still has a private `slicePolyline(polyline, endM)`; if anything else ever needs a
  slice, unify it into `engine/geometry.ts` as `slicePolyline(points, fromM, toM)` rather than adding
  a second one.
- The arrow marks only the next maneuver. Marking the one after it (now that `thenKind` exists) would
  help at the chained junctions WR-056 found are a third of a real ride.
- WR-058 remains: curated and AI routes ship `steps: []`, so no junction arrow, cues or turn card.
