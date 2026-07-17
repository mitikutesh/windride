# Fixtures

Illustrative-shape samples so the app runs offline from day one. WR-004/WR-005 replace the
`*-sample.*` files with captured real responses (one probe run each) and note it in their Logs.
After capture, fixtures are frozen: adapter parsers change only together with fixtures.

- openmeteo/real-espoo.json — real multipoint hourly response (3 points × 48 hours), captured by
  the WR-004 `npm run probe:weather` run; replaces the old `openmeteo-sample.json`. The real
  shape is a top-level JSON array (one object per point, in request order), not the illustrative
  `{responses:[...]}` wrapper — parser and MockWeatherProvider fixture scenario both updated to
  match.
- ors/roundtrip-sample.geojson — replaces the old non-closed `ors-roundtrip-sample.geojson`; a
  hand-crafted **closed** round-trip loop (start == end coordinate) with elevation in the 3rd
  coordinate and surface extras switching asphalt→gravel across the loop (cycleway waytype), used
  by `parseOrsRoute` tests and `MockRouteProvider`. Real captures (`ors/real-small.json` /
  `ors/real-medium.json`) are pending a `npm run probe:ors` run with a live `VITE_ORS_API_KEY`
  (see DEC-013) — once captured they replace/augment this fixture per the freeze policy below.
- golden/ — created by WR-007/011: hand-computed scoring cases and the acceptance scenario
- traces/ — created by WR-012: synthetic GPX traces (clean loop, off-route, figure-eight)
