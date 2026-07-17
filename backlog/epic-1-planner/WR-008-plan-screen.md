# WR-008 · Plan screen — inputs → generate flow
Epic: 1 · Planner | Status: TODO | Depends on: WR-002, WR-003 | Size: M

## Goal
The one-screen planning flow: sensible defaults, thumb-reachable controls, a single "Find
today's route" action that drives the pipeline (mocks or live per env).

## Context (read first)
PRODUCT_SPEC §3 v0.1 + §5 · DESIGN.md · ARCHITECTURE §5 · DECISIONS DEC-004.

## Acceptance criteria
- [ ] Inputs: distance slider 20–100 km (default 50), Loop / Out-and-back chips, Road/Gravel
      segmented (default Gravel), toggles: Shelter me (disabled+tooltip until Epic 3), Home
      before dark, Avoid busy roads; start = geolocation with manual lat/lon fallback field.
- [ ] Conditions strip: current wind (speed + FROM direction as arrow + text), temp/feels,
      rain %, sunset — from WeatherProvider.
- [ ] CTA runs generate → segment → score via the plan store; loading state with per-stage
      progress ("drafting candidates 4/8…"); typed errors phrased plainly (quota vs offline).
- [ ] State persists across reload (zustand + idb hydration).
- [ ] Everything works with mocks (`VITE_LIVE_APIS=false`) — demoable offline.

## Test contract
Store tests: happy path (mock providers → ranked results in store), partial candidate failure,
quota error path. One interaction test: change distance → generate → results populated.

## Technical notes
Wind arrow must point where wind BLOWS TO in the UI (users read arrows as flow) while text says
"from SW" — both derived from wind_from; add a unit test for the arrow rotation.

## Out of scope
Map rendering, cards (WR-009); start-time picker (WR-020 adds it).

## Log
