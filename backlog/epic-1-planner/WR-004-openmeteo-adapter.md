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

### Fable 5 review pass — fixes

A Fable 5 review of this story found two BLOCKERs and several SHOULD-FIXes. All are fixed; gate
is green (`npm test` = 54 passing, `npm run lint`, `npm run build`).

**BLOCKER — time window.** `windAlong` was requesting `forecast_days` starting from local
midnight, so hour-indexed samples covered the day so far plus tomorrow rather than "the next N
hours from now" — meaning WR-007 would have scored last night's wind instead of current/future
wind. Fixed to request `forecast_hours=hours` instead; verified live that Open-Meteo's
`forecast_hours` slot 0 is the current hour, so the response now correctly returns the next
`hours` hours. The fixture was re-captured against this corrected param
(`npm run probe:weather -- --force`), and the hand spot-check in this Log is superseded: for
`fixtures/openmeteo/real-espoo.json`, point0/hour0 is now time `2026-07-17T12:00`, windMs `3.5`,
windFromDeg `166`, gustMs `8.3`, tempC `22.4`, precipProb `0`. `MockWeatherProvider`'s `fixture`
scenario test values were updated to match.

**BLOCKER — daylight parsing.** `parseDaylight` incorrectly required an `hourly` key to be
present on the response, but a daily-only Open-Meteo request returns a bare object containing
only `daily` (confirmed against a live call). `asPointArray` now just normalises the response
shape to a non-empty array; `parseWindGrid` alone owns the hourly-field validation, so
daylight-only responses parse correctly. Added a regression test that parses a daily-only
response object.

**SHOULD-FIX — typed errors on malformed hourly data.** `parseWindGrid` now explicitly validates
that every required hourly array is present and at least `hours` long, throwing
`ProviderError('badResponse')` instead of letting a raw `TypeError` escape — this is the
param-rename failure mode flagged in API_NOTES §1. Added a test covering a truncated/missing
hourly array.

**SHOULD-FIX — live registry wiring.** `getProviders()` previously threw when
`VITE_LIVE_APIS=true` was set, even though this story's `OpenMeteoProvider` was ready. It now
returns the live `OpenMeteoProvider` for weather in that mode (routing still returns
`MockRouteProvider` until WR-005 lands); registry test updated to assert this.

**SHOULD-FIX — cache resilience.** IndexedDB failures (unavailable, blocked, or throwing) are
now caught so the cache degrades to memory-only instead of leaking an unmapped `DOMException` as
a provider error or memoizing a rejected connection promise (which would have wedged the cache
for the rest of the session). Expired idb rows are also deleted on read, so the store can't grow
unbounded across TTL rollovers.

**SHOULD-FIX — probe safety.** `scripts/probe-weather.mjs` now refuses to overwrite the frozen
`fixtures/openmeteo/real-espoo.json` unless invoked with `--force`, preventing an accidental
re-run from silently drifting the golden fixture (and the hand-checked values that document it).

**Added:** a cache test proving a re-fetch occurs after the 30 min TTL / hour-bucket rollover
(previously only the zero-fetch cache-hit path was covered).

**Deferred (documented, not changed) — NITs:** `daylight()` remains a separate, uncached fetch
from `windAlong`; there is no in-flight request de-duplication (two concurrent identical calls
before the first resolves will both hit the network/idb). Neither is required for current
consumers; revisit if a future story calls this adapter at higher frequency.
