# Fixtures

Illustrative-shape samples so the app runs offline from day one. WR-004/WR-005 replace the
`*-sample.*` files with captured real responses (one probe run each) and note it in their Logs.
After capture, fixtures are frozen: adapter parsers change only together with fixtures.

- openmeteo-sample.json — minimal multipoint hourly response shape (2 points × 3 hours)
- ors-roundtrip-sample.geojson — minimal round-trip directions shape (geometry + summary + steps)
- golden/ — created by WR-007/011: hand-computed scoring cases and the acceptance scenario
- traces/ — created by WR-012: synthetic GPX traces (clean loop, off-route, figure-eight)
