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
  by `parseOrsRoute` tests and `MockRouteProvider`. Its `type: 1` on a "Turn left" step (ORS 1 =
  *right*) was corrected to 0 in WR-054 — every piece of fixture-driven turn work had been training
  against a self-contradictory sample.
- ors/real-small.json — **real** 22.5 km Espoo round trip (868 points, 128 turn steps), captured by
  the WR-056 `npm run probe:ors` run. This is the fixture that settled DEC-064: every ORS `type`
  code agrees with its own instruction text, so the maneuver taxonomy can be trusted for the turn
  glyph. It is also the only fixture with realistic junction DENSITY — a step every ~176 m median,
  with 43 of 120 maneuvers inside 60 m of the one before — which is what `nav/cues.ts` chaining and
  `ui/mapCamera.ts`'s asymmetric approach window are calibrated against. Frozen.
  `ors/real-medium.json` (the 50 km loop) is NOT captured: ORS returned HTTP 500 for a round trip
  that long, and one real capture was enough, so the probe was not retried (live-call budget,
  API_NOTES §2). Notably absent from real step data: `exit_number` (roundabout exits) — the step
  keys are `distance, duration, type, instruction, name, way_points` only.
- golden/ — created by WR-007/011: hand-computed scoring cases and the acceptance scenario
- traces/ — created by WR-012: synthetic GPX traces (clean loop, off-route, figure-eight)
- curated/ — WR-052 ingest fixtures (all synthetic, never captured from a live provider):
  `bikeland-sample.gpx` (a closed ~11 km track shaped like a bikeland.fi export),
  `overpass-sample.json` (one relation whose members include a REVERSED way, an `alternative`
  spur, a non-way member and a disjoint fragment — the stitching contract — plus a sub-5 km
  relation for the min-length report), `overpass-oversize.json` (one dense ~307 km route used to
  trip the size guard against a deliberately small budget), and `catalog-sample.json` (a built
  catalog with one deliberately malformed entry, read by the adapter and store tests).
