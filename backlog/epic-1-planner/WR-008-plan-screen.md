# WR-008 · Plan screen — inputs → generate flow
Epic: 1 · Planner | Status: DONE | Depends on: WR-002, WR-003 | Size: M

## Goal
The one-screen planning flow: sensible defaults, thumb-reachable controls, a single "Find
today's route" action that drives the pipeline (mocks or live per env).

## Context (read first)
PRODUCT_SPEC §3 v0.1 + §5 · DESIGN.md · ARCHITECTURE §5 · DECISIONS DEC-004.

## Acceptance criteria
- [x] Inputs: distance slider 20–100 km (default 50), Loop / Out-and-back chips, Road/Gravel
      segmented (default Gravel), toggles: Shelter me (disabled+tooltip until Epic 3), Home
      before dark, Avoid busy roads; start = geolocation with manual lat/lon fallback field.
- [x] Conditions strip: current wind (speed + FROM direction as arrow + text), temp/feels,
      rain %, sunset — from WeatherProvider.
- [x] CTA runs generate → segment → score via the plan store; loading state with per-stage
      progress ("drafting candidates 4/8…"); typed errors phrased plainly (quota vs offline).
- [x] State persists across reload (zustand + idb hydration).
- [x] Everything works with mocks (`VITE_LIVE_APIS=false`) — demoable offline.

## Test contract
Store tests: happy path (mock providers → ranked results in store), partial candidate failure,
quota error path. One interaction test: change distance → generate → results populated.

## Technical notes
Wind arrow must point where wind BLOWS TO in the UI (users read arrows as flow) while text says
"from SW" — both derived from wind_from; add a unit test for the arrow rotation.

## Out of scope
Map rendering, cards (WR-009); start-time picker (WR-020 adds it).

## Log
Shipped the full plan pipeline and screen. `src/state/plan/runPlan.ts` wires inputs →
`routing.generateCandidates` (progress via `onSettled(done,total)`) → `engine/geometry` resample
for any bare/mock candidates → **one** weather call (`windAlong([start], hours)` + `daylight`) →
`engine/scoring.scoreCandidates` → `{ ranked, rejected, conditions }`. `planStore.ts`
(zustand + idb persistence via `src/state/persist.ts`) holds inputs (distance 20–100 default 50,
loop/out-and-back, road/gravel default gravel, home-before-dark, avoid-busy-roads, start
defaulting to central Espoo for offline demoing), conditions, status, progress, and error; actions
`setInput`, `locate` (geolocation, falls back to the default start), `loadConditions`, `generate`
(drives the pipeline, phrases typed errors plainly, navigates to `#/results`). Inputs persist
across reload; persistence no-ops gracefully without IndexedDB. `resultsStore.ts` holds
ranked/rejected/selectedId for WR-009 to render. `utils/units.ts` adds `compass8`,
`windArrowRotationDeg`, `metresToKm`, `msToKmh`, `formatDurationHM`, `timeOfDay`. New components
`Segmented`, `DistanceSlider`, `ConditionsStrip`; `Toggle` gained `disabled`+`title` so "Shelter
me" is disabled with a tooltip until Epic 3. `PlanScreen` rewritten around a single "Find today's
route" CTA with per-stage progress text, plain error copy, and a manual lat/lon fallback.
`adapters/routing/ors.ts` `generateCandidates` gained the `onSettled` progress callback.

Key simplification (DEC-016): v0.1 treats wind as **spatially uniform** — every segment shares
one hourly column sampled at the start point, matching the default `exposure = 1.0`; the engine's
two-pass sampling still varies wind by *time*-of-arrival along the route. Per-point,
shelter-adjusted weather is Epic 3's job (WR-018/019).

Wind-arrow convention (technical note, tested): the arrow rotates to point where the wind
**blows to**, while the adjacent text reads "from SW" — both derived from the same
`windFromDeg`, never mixed up.

Tests: `runPlan` (happy path → ranked + segmented + conditions; partial candidate failure still
ranks; weather quota error propagates), `units` (arrow rotation, compass, formatters),
`PlanScreen` interaction (change distance → generate → results store populated; conditions strip
renders). 136 tests total, all green on mocks (`VITE_LIVE_APIS=false`) — fully demoable offline.
No open follow-ups beyond the DEC-016 default; WR-009 (Results/map) is next.

## Fable 5 review pass — fixes

A Fable 5 review of WR-008 found two BLOCKERs and several SHOULD-FIX/NITs. All addressed; gate
(`npm test` = 139 passing, `npm run lint`, `npm run build`) is green.

**BLOCKERs:**
- *Out-and-back empty on mocks* — `MockRouteProvider.pointToPoint` now returns a gently winding
  leg (~1.34x crow-flies distance) so out-and-back totals land near the requested length
  (`generateCandidates` shrinks the radius 0.75x to compensate for road winding). The mock round
  trip also now varies its geometry by both seed and points, and loop closure is forced exactly
  to eliminate float drift. `runPlan` gained an out-and-back test.
- *Total routing failure swallowed* — `generateCandidates` now rethrows the first rejection when
  **every** candidate task fails, so an ORS quota/outage error surfaces its `ProviderError` kind
  instead of silently producing zero routes. `planStore.generate` treats a zero-ranked result as
  a visible error message (previous results are preserved rather than clobbered) instead of a
  silent `'ready'`. `runPlan` gained a total-failure test.

**SHOULD-FIX:**
- Loop mode now passes `bearings: []` so it only produces round-trip candidates — a user who
  picked "Loop" no longer sees out-and-back variants mixed in.
- The provider registry's live mode now wires `OrsRouteProvider` (WR-005 is done) alongside
  `OpenMeteoProvider`; the live-mode test asserts both are used.
- `MockWeatherProvider.daylight` now uses today's date with the fixture's time-of-day, so
  "Home before dark" behaves sensibly when demoing on mocks regardless of the calendar date.
- `PlanScreen` now initialises *after* idb hydration (`persist.onFinishHydration`) and only
  geolocates when the start is still the default — a persisted or manually-entered start is
  never clobbered on remount/reload.
- The manual lat/lon inputs guard empty/NaN/out-of-range values so they can no longer snap the
  start to `0,0`.
- Feels-like temperature is plumbed end to end: `WindSample.feelsC` (from Open-Meteo
  `apparent_temperature`, already fetched) flows through `Conditions` to a new "Feels" cell in
  `ConditionsStrip`; the mock weather provider supplies it too.
- The disabled "Shelter me" `Toggle` stays focusable via `aria-disabled` with an
  `aria-describedby` pointing at visually-hidden reason text, so it's keyboard/screen-reader
  accessible instead of a dead `disabled` control.
- Tests added: `runPlan` out-and-back + total-failure cases; `idbStateStorage` round-trip test
  (using `fake-indexeddb`); the ORS parsing test expectation updated for `feelsC`; the
  live-registry test updated to assert both providers.

**Deferred NITs** (documented, not changed):
- `Segmented` lacks the ARIA radio roving-tabindex pattern.
- `loadConditions` failure leaves the conditions strip stuck on "Loading…".
- Conditions could stay `null` instead of showing zeros when the hourly array is empty.
- Navigation-on-generate remains a store side-effect rather than a screen-level concern.
