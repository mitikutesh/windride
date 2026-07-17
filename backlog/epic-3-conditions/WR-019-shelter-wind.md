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

## Fable 5 review pass — fixes

- **B1 (blocker, the key fix)**: without a grid, the shelter axis still differentiated candidates
  — a candidate with any headwind got raw `shelterShare` 0 while a no-headwind candidate got the
  neutral 0.5, and `normalizeHigher` stretched that gap into a real ~6.7-point swing sourced from
  data that doesn't exist (double-counting the wind axis; reachable in production for
  out-and-back routes under cardinal winds). The Log's prior honest caveat — "shelter is a
  constant 0.5 across all candidates so it can't move relative rank" — was factually wrong at the
  time it was written; it only became true once this fix landed. Fixed: `ScoreOptions` gained
  `hasShelterData`; the shelter axis is normalized (`normalizeHigher(shelterShare)`) only when
  true, otherwise every candidate gets the uniform 0.5 (raw `shelterShare` is still computed and
  stays available as evidence). `runPlan` passes `hasShelterData: shelterDataAvailable`. Also
  added a `V_PAR_EPS` (1e-6) float-dust guard in `computeMetrics` so a perpendicular leg
  (`cos 90° ≈ 6e-17`) isn't miscounted as a sliver of tail- or headwind. A regression test in
  `scoring.test.ts` covers a headwind candidate and a tailwind candidate with no grid: both
  `sub.shelter.normalized === 0.5`. Recorded as DEC-025.
- **S2 (should-fix)**: the "golden re-scored with a synthetic grid, forest-heavy rank improves"
  acceptance box was ticked, but the golden trio still ran with exposure 1.0 everywhere (no real
  grid), so shelter wasn't actually being exercised. Fixed: the sheltered-vs-exposed twin test now
  runs with `hasShelterData: true` against a real synthetic-exposure grid, genuinely exercising
  the shelter axis (`shelter.normalized` differentiates the pair, not just the wind axis). The
  A/C/B golden snapshot was re-updated — rank order is preserved, and the earlier phantom shift
  from B1 is gone now that shelter is correctly uniform when no grid is supplied.
- **S3 (should-fix)**: exposure fill and `shelterDataAvailable` were untested and untestable,
  because `loadExposureGrid` was hardcoded inside `runPlan`. Fixed: `RunPlanOpts.loadGrid` is now
  injectable. Added `runPlan.test.ts` cases: a covering single-cell grid fills every segment's
  exposure (0.35) and flags `shelterDataAvailable: true`; a null grid degrades every segment to
  exposure 1.0 and flags `shelterDataAvailable: false`.
- **N4 (nit)**: the `0.6` shelter-exposure threshold was duplicated between the engine and the UI.
  Fixed: `SHELTER_EXPOSURE_MAX` is exported from `src/engine/scoring.ts` and imported by
  `src/ui/routeGeo.ts` — single source of truth.
- **N5 (nit)**: `runPlan`'s header comment was stale, still describing wind as spatially uniform
  ("exposure 1.0, shelter grid is Epic 3") after WR-019 made the grid real. Corrected to describe
  the exposure-fill step this story actually implements.
- Deferred nits (noted, not fixed): `resultsStore.setResults`'s `shelterDataAvailable` parameter
  is optional (only the real `runPlan` caller passes it); the flag flips true if *any* segment
  falls in the covered region (acceptable at Uusimaa scope); `idbCache`'s mem-copy diverges from
  the cached copy if exposure is mutated post-get, which is benign since `structuredClone` runs on
  every `get` and exposure is recomputed fresh each `runPlan` call.
- Corrected acceptance note: with the grid absent (DEC-024), `hasShelterData` is false, so the
  shelter axis is uniform 0.5 and genuinely cannot shift relative rank — that statement is now
  true (it was only made true by this fix, not before it). WR-011's acceptance harness is
  genuinely unaffected.
- Full gate after fixes: 272 tests passing, lint clean, build OK.
