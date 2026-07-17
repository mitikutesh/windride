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
