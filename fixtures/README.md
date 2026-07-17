# Fixtures

Illustrative-shape samples so the app runs offline from day one. WR-004/WR-005 replace the
`*-sample.*` files with captured real responses (one probe run each) and note it in their Logs.
After capture, fixtures are frozen: adapter parsers change only together with fixtures.

- openmeteo/real-espoo.json — real multipoint hourly response (3 points × 48 hours), captured by
  the WR-004 `npm run probe:weather` run; replaces the old `openmeteo-sample.json`. The real
  shape is a top-level JSON array (one object per point, in request order), not the illustrative
  `{responses:[...]}` wrapper — parser and MockWeatherProvider fixture scenario both updated to
  match.
- ors-roundtrip-sample.geojson — minimal round-trip directions shape (geometry + summary + steps)
- golden/ — created by WR-007/011: hand-computed scoring cases and the acceptance scenario
- traces/ — created by WR-012: synthetic GPX traces (clean loop, off-route, figure-eight)
