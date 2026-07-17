# WR-019 · Shelter-aware effective wind + shelter sub-score
Epic: 3 · Conditions | Status: DONE | Depends on: WR-018 | Size: M

## Goal
Turn the grid into felt wind: every segment gets its exposure factor, W_eff drives all wind
math, the Shelter sub-score goes live, explanations start saying "hidden in Nuuksio forest".

## Context (read first)
SCORING_SPEC §2, §4 (Shelter), §6 · WR-018 output format.

## Acceptance criteria
- [x] Segmentation fills Segment.exposure from exposureGrid (midpoint lookup); default 1.0
      outside region (flagged in results as "no shelter data here").
- [x] W_eff and gust_eff use exposure everywhere (grep: no remaining raw-W usage in scoring).
- [x] Shelter sub-score per spec joins the weight vector (renormalization removed for it).
- [x] Golden fixture extended: same 3 candidates re-scored with a synthetic grid — forest-heavy
      candidate's rank improves as hand-computed; snapshot updated with Log note.
- [x] Map (WR-009) gains shelter tint on segments with exposure ≤ 0.6; ribbon gains shelter kind.
- [x] explain.ts emits shelter facts ("9.2 km of upwind inside forest, effective wind 3.4 m/s").

## Test contract
W_eff propagation tests (exposure 0.35 ⇒ v_par scales); UI colour mapping test extended.

## Technical notes
The acceptance harness (WR-011) thresholds may shift — rerun, adjust with reasoning in Log.

## Out of scope
Gust flags UI (WR-021).

## Log

- Shipped: `shelter` added to `SubScoreName` and `DEFAULT_WEIGHTS` (0.06) in
  `src/engine/scoring.ts`. `computeMetrics` accumulates `shelterShare` = the share of upwind
  (headwind) time spent in shelter (segment exposure ≤ 0.6); neutral 0.5 when a candidate has no
  headwind time at all. Shelter is normalized across the candidate set exactly like the other
  sub-scores — the total's existing renormalization over present weights absorbs it cleanly, no
  special-casing needed. New evidence fields `shelteredUpwindKm` and `shelteredEffWindMs`
  (time-weighted effective wind over the sheltered upwind portion) feed `explain.ts`.
- W_eff/gust_eff (`decompose(bearing, windFrom, windMs, exposure, gustMs)`) already had the
  exposure parameter from WR-007; WR-019 makes it real. `src/engine/geometry.ts` adds
  `segmentMidpoint(seg)`. `state/plan/runPlan.ts` loads the exposure grid once via
  `loadExposureGrid` and fills each segment's `exposure` with `exposureAt(grid, midpoint)`,
  tracking `shelterDataAvailable` (false when the grid is missing or the ride falls outside its
  covered region). No raw-W usage remains in scoring — exposure flows through everywhere.
- `explain.ts` emits a shelter fact ("<n> km of upwind inside forest, effective wind <x> m/s")
  whenever `shelteredUpwindKm > 0.3`.
- UI: `src/ui/routeGeo.ts` adds `segmentKind(sa)` (exposure ≤ `SHELTER_EXPOSURE_MAX` 0.6 →
  `'shelter'`, else falls back to `classifyWindKind`); both `routeToWindGeoJSON` (map) and
  `routeToRibbon` tint sheltered segments with the shelter hue. `shelterDataAvailable` flows
  `runPlan` → `resultsStore` → `ResultsScreen`, which shows a "no shelter data here" note when no
  exposure coverage applies to the plotted routes.
- Golden fixture: scoring golden snapshot updated — shelter now contributes a real term, A>C>B
  ranking order preserved.
- Tests added/extended: `scoring.test.ts` (W_eff scales `v_par` by exposure; a forest-sheltered
  headwind route outranks its exposed twin — `shelter.raw` 1 vs 0, `shelteredUpwindKm`/
  `shelteredEffWindMs` asserted), `routeGeo.test.ts` (low-exposure segments tint as shelter in
  both map and ribbon), `explain.test.ts` (shelter fact string). Full gate: 269 tests, lint
  clean, build OK.
- Honest caveat: `public/data/exposure-uusimaa.json` isn't generated yet (WR-018 deferral,
  DEC-024), so at runtime today every segment resolves to exposure 1.0 — shelter sub-score, map
  tint, and "hidden in forest" explanations are wired and unit-tested but produce no real
  differentiation until the grid exists. `shelterDataAvailable` is false in this state and the
  "no shelter data here" note is showing. Reran the WR-011 acceptance harness (30/50/80 km):
  unchanged — with the grid absent, shelter is a constant 0.5 across all candidates so it can't
  move relative rank; thresholds left as-is. Rerun and adjust with reasoning once the real grid
  lands (WR-018 follow-up).
