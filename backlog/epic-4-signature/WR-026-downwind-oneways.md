# WR-026 · Downwind one-ways + transit return
Epic: 4 · Signature | Status: DONE | Depends on: WR-011 | Size: L

## Goal
The only geometry where tailwind is unbounded: generate point-to-point rides toward downwind
rail/bus stations and rank by tailwind share × return service — "55 km downwind to Riihimäki,
train back every 30 min."

## Context (read first)
PRODUCT_SPEC §1 lever 5 · API_NOTES §3 · ARCHITECTURE §4 pointToPoint.

## Acceptance criteria
- [x] Station dataset: static JSON of HSL/VR rail + trunk stations (name, latlon, modes) with
      a documented refresh script in tools/ (checked-in data, no runtime dependency for list).
- [x] Candidate endpoints: stations within target±20% distance inside wind_to ±35° arc;
      route via pointToPoint; score with the standard engine (one-way: Sequencing off,
      DistanceMatch on actual).
- [x] Digitransit adapter (`VITE_DIGITRANSIT_KEY`): next departures + frequency for the return
      leg at ETA time; rank = tailwindTimeShare × frequencyFactor; graceful no-key mode
      (rank by wind only, label "check return times").
- [x] "Downwind" mode on Plan produces ranked one-ways with card copy including the return
      ("trains every ~30 min from 18:40").
- [x] Fixtures for Digitransit responses; contract tests; live probe captured once. — **(live
      probe deferred — synthetic fixture; see task #31 / DEC-030)**

## Test contract
Endpoint-arc geometry tests; ranking test on a fixture where a closer-but-crosswind station
loses to a farther pure-downwind one; no-key degradation test.

## Technical notes
Return planning is for the RIDER + bike — flag bike-carriage uncertainty in copy rather than
modelling it. Keep the station arc math in engine/.

## Out of scope
Multi-leg transit optimization; buying tickets.

## Log

**2026-07-18** — Shipped downwind one-ways + transit return end to end (PRODUCT_SPEC §1 lever 5):
- `src/engine/downwind.ts` (new, pure): `downwindEndpoints(start, stations, { targetM, windToDeg,
  distTolPct = 0.2, arcDeg = 35 })` filters stations inside the target±20% distance band AND the
  downwind ±35° arc, nearest-to-dead-downwind first. `tailwindTimeShare(analysis)` — time-weighted
  tailwind fraction. `frequencyFactor(headwayMin) = 60/(60+headway)` (0 when null/no service).
  `rankDownwind(tailwindShare, freqFactor)` = their product. New consts `DOWNWIND_DIST_TOL`,
  `DOWNWIND_ARC_DEG`.
- Station data: `src/data/stations.uusimaa.json` (new, checked-in) + `src/data/stations.ts`
  (bundled import — no runtime dependency for the list) + `tools/fetch_stations.mjs` (new, manual
  refresh script — queries Digitransit for stations and merges so hand-curated bus-only entries
  survive; never run in CI).
- `src/adapters/transit/digitransit.ts` (replaced the placeholder): `DigitransitProvider`
  (GraphQL `stopsByRadius`) → `ReturnService { departuresMs[], headwayMin }`; pure
  `parseReturnService` (prefers `realtimeDeparture`, filters past departures, median headway);
  typed errors (429 → quota, `!ok` → badResponse, fetch throw → network, no key → code `'no-key'`);
  `hasKey` getter. Fixture `fixtures/digitransit/riihimaki.json` + contract tests.
- `src/state/plan/runDownwindPlan.ts` (new): wind at start ⇒ downwind arc ⇒ `pointToPoint` route
  to each candidate station ⇒ one-way scoring (`sequencing: 0` weight, `DistanceMatch` kept with a
  wide 0.4 tolerance since road distance exceeds the crow-flies arc filter) ⇒ Digitransit return
  service at the ETA ⇒ `rank = tailwindShare × frequencyFactor`. No key (or a transient adapter
  failure) falls back to tailwind-alone ranking with `return: null`. Return copy: "trains every
  ~30 min from 18:40 · bike space not guaranteed" — bike-carriage uncertainty flagged in copy, not
  modelled, per the story's technical note.
- Wiring: `getTransitProvider()` registry entry (real Digitransit, self-degrades with no key).
  `PlanInputs.routeType` gains `'downwind'`. `planStore` gains `downwind[]` state plus a downwind
  branch in `generate()` that renders results inline on Plan (not the loop Results grid).
  `PlanScreen`: a "Downwind" shape option + `<DownwindResults>` component. `.env.example` +
  `vite-env.d.ts` document `VITE_DIGITRANSIT_KEY` (optional).
- `scripts/probe-digitransit.mjs` (new) + `npm run probe:digitransit` — manual live smoke check,
  never run in CI.
- Tests: engine (`downwind.test.ts` — arc filter incl. a custom arc, tailwind share, frequency
  factor, "closer crosswind loses to farther pure-downwind" ranking, no-service ⇒ 0), adapter
  contract tests (9, `digitransit.test.ts`), `runDownwindPlan` orchestration tests
  (frequency-driven ranking, no-key degradation, empty-arc ⇒ `[]`). Full gate: 361 tests, lint
  clean, build OK.
- **Honesty caveat:** the "live probe captured once" half of the fixtures acceptance box is
  **not** done this session — no network available. The contract tests run against a hand-built
  synthetic fixture matching the documented Digitransit schema; a real live probe + fixture
  capture is deferred as a manual follow-up (task #31). The acceptance box is ticked with an
  inline note to that effect rather than silently claimed.
- See **DEC-030** for the station-data, wind-uniformity, one-way-scoring, ranking-formula,
  Digitransit-read-vs-Strava-upload, and bike-carriage design decisions.
- Reviewed post-implementation by a substitute senior reviewer (Opus) — Fable 5 was out of usage
  credits this session; see follow-up review commit for findings/fixes.
