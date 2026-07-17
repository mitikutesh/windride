# WR-004 · Open-Meteo weather adapter
Epic: 1 · Planner | Status: DONE | Depends on: WR-003 | Size: M

## Goal
Real wind/weather: one multipoint call returning hourly samples for every route point, parsed
into WindSample[][], cached, attributed.

## Context (read first)
API_NOTES §1 · ARCHITECTURE §4 · CLAUDE.md domain warnings (wind_from!).

## Acceptance criteria
- [x] `openMeteo.ts` implements WeatherProvider: multipoint lat/lon lists, hourly params per
      API_NOTES §1, `wind_speed_unit=ms`, daylight from daily sunrise/sunset.
- [x] ONE live probe run (`npm run probe:weather`, requires VITE_LIVE_APIS=true) captures a real
      response into `fixtures/openmeteo/real-espoo.json`, replacing the illustrative sample;
      parser verified against it. Probe never runs in CI.
- [x] In-memory + idb cache keyed by (rounded points, date-hour); TTL 30 min.
- [x] Passes the WR-003 contract suite in fixture mode; all three error kinds mapped.

## Test contract
Parsing tests on the captured fixture (values spot-checked by hand in the Log); transposition
test (point count × hour count); cache hit test (second call = zero fetches).

## Technical notes
Round coordinates to 3 decimals in cache keys. If live param names differ from API_NOTES §1,
fix parser + fixture + API_NOTES together (note in Log).

## Out of scope
Ensemble/robustness (WR-025); exposure adjustment (WR-019).

## Log

Implemented `src/adapters/weather/openMeteo.ts`: `OpenMeteoProvider` implements `WeatherProvider`
with one multipoint call (comma-separated `latitude`/`longitude` lists), hourly params per
API_NOTES §1 (`wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,
apparent_temperature,precipitation_probability`), daily `sunrise,sunset`, `wind_speed_unit=ms`,
`timezone=auto`, `forecast_days` derived from the requested hour count. `wind_direction_10m` is
kept meteorological (FROM) end to end per CLAUDE.md domain warnings — no sign flip in the
adapter. Parsing is exposed as pure `parseWindGrid()` / `parseDaylight()` functions.

**Shape correction vs. the illustrative fixture.** The real multipoint response is a top-level
JSON **array** (one object per requested point, in request order), not the `{responses:[...]}`
wrapper the placeholder `openmeteo-sample.json` used. The parser accepts array-or-single-object
so it also tolerates a lone-point response shape. Also confirmed: Open-Meteo snaps each requested
coordinate to its nearest forecast grid-cell centre (returned `latitude`/`longitude` won't exactly
equal the request), but it preserves request order, so the adapter maps `response[i] -> points[i]`
by index rather than by matching coordinates.

**Hand spot-check of the captured fixture** (`fixtures/openmeteo/real-espoo.json`, 3 points × 48
hours): point0/hour0 — time `2026-07-17T00:00`, windMs `1.7`, windFromDeg `134` (from the SE),
gustMs `3.2`, tempC `16.8`, precipProb `0`; daylight — sunrise `2026-07-17T04:26`, sunset
`2026-07-17T22:27`.

Error mapping per ARCHITECTURE §7: thrown fetch → `network`; HTTP 429 → `quota`; other non-ok →
`badResponse`; invalid JSON → `badResponse`. `fetchFn` and `now()` are injectable so fixture-mode
tests are deterministic.

Added `src/adapters/weather/cache.ts` (`createWeatherCache`): in-memory `Map` plus IndexedDB
persistence (via `idb`), IndexedDB-availability-guarded so it's skipped cleanly under
node/vitest. Keyed by rounded points (3 decimals) + hours + date-hour bucket; 30 min TTL with an
injectable clock.

Added `scripts/probe-weather.mjs` (`npm run probe:weather`), refuses to run unless
`VITE_LIVE_APIS=true`, never invoked in CI. Run once this session to capture
`fixtures/openmeteo/real-espoo.json`. The illustrative `fixtures/openmeteo-sample.json` was
deleted; `MockWeatherProvider`'s `fixture` scenario now reads the real capture, and its
spot-checked expected values were updated to match.

Tests: re-ran the WR-003 contract suite against the real adapter in fixture mode (injected
fetch), covering all three error kinds on both `windAlong` and `daylight`; added parsing
spot-check tests, a transposition test (3×6 points×hours), a URL-param test, a cache-hit test
(second identical call ⇒ zero fetches), and a cache TTL + idb-persistence test (using
`fake-indexeddb`, added as a new dev dependency). 51 tests passing total; `npm run lint` and
`npm run build` green.

Follow-ups for later stories: WR-020 (start-time optimizer) will consume the full hourly set
already returned by this one call at zero extra API cost; WR-019 (shelter-aware effective wind)
will apply its exposure adjustment on top of these raw `WindSample`s without touching this
adapter.
