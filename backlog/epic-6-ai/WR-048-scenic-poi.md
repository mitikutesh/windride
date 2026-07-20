# WR-048 · Scenic photos + POI highlights
Epic: 6 · AI | Status: TODO | Depends on: WR-047 | Size: M

## Goal
Show what a route is actually famous for: viewpoint/landmark highlights and scenic imagery
from free sources, pinned on the map — and feeding the Scenery sub-score where that's honest.

## Context (read first)
WR-047 (discovery candidates these enrich) · WR-009 Results map · SCORING_SPEC (Scenery
sub-score) · ARCHITECTURE §2 (adapters-only fetch).

## Acceptance criteria
- [ ] `src/adapters/poi/`: Wikimedia/Wikipedia geosearch (and/or Mapillary if its free tier is
      browser-callable — verify, record) for POIs + photos near the route corridor; NOT
      Strava. Attribution + licence text shown per each source's requirement.
- [ ] POI pins on the Results map (viewpoint/landmark category, name, photo thumbnail where
      one exists); tapping a pin opens a small card.
- [ ] POI density/quality feeds the existing Scenery sub-score where sensible — additive,
      documented; if weights shift, the golden ranking snapshot is re-locked deliberately in
      the Log, never silently.
- [ ] Budget + cache: corridor queries cached in idb; at most one geosearch batch per
      candidate per plan.
- [ ] Degrades to nothing: offline, no key needed, no results ⇒ no pins, no errors, scoring
      falls back to the current Scenery inputs.

## Test contract
Adapter contract tests on geosearch fixtures (shape, empty result, error path, cache hit);
an engine test that added POI input shifts Scenery monotonically and never other sub-scores;
map pin render test. No live calls in tests; manual `npm run probe:poi`.

## Out of scope
User-uploaded photos · uploading anything anywhere · street-level imagery viewers.
