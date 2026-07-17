# WR-004 · Open-Meteo weather adapter
Epic: 1 · Planner | Status: TODO | Depends on: WR-003 | Size: M

## Goal
Real wind/weather: one multipoint call returning hourly samples for every route point, parsed
into WindSample[][], cached, attributed.

## Context (read first)
API_NOTES §1 · ARCHITECTURE §4 · CLAUDE.md domain warnings (wind_from!).

## Acceptance criteria
- [ ] `openMeteo.ts` implements WeatherProvider: multipoint lat/lon lists, hourly params per
      API_NOTES §1, `wind_speed_unit=ms`, daylight from daily sunrise/sunset.
- [ ] ONE live probe run (`npm run probe:weather`, requires VITE_LIVE_APIS=true) captures a real
      response into `fixtures/openmeteo/real-espoo.json`, replacing the illustrative sample;
      parser verified against it. Probe never runs in CI.
- [ ] In-memory + idb cache keyed by (rounded points, date-hour); TTL 30 min.
- [ ] Passes the WR-003 contract suite in fixture mode; all three error kinds mapped.

## Test contract
Parsing tests on the captured fixture (values spot-checked by hand in the Log); transposition
test (point count × hour count); cache hit test (second call = zero fetches).

## Technical notes
Round coordinates to 3 decimals in cache keys. If live param names differ from API_NOTES §1,
fix parser + fixture + API_NOTES together (note in Log).

## Out of scope
Ensemble/robustness (WR-025); exposure adjustment (WR-019).

## Log
