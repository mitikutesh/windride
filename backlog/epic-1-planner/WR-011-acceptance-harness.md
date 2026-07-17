# WR-011 · v0.1 acceptance harness — the honesty gate
Epic: 1 · Planner | Status: TODO | Depends on: WR-010 | Size: M

## Goal
An executable version of PRODUCT_SPEC §6 that proves v0.1 actually delivers, and becomes the
regression net for every future scoring/routing change.

## Context (read first)
PRODUCT_SPEC §6 · SCORING_SPEC §7 · fixtures/README.md.

## Acceptance criteria
- [ ] `npm run accept`: for 30/50/80 km from the fixed Espoo start against the synthetic
      SW-8 m/s fixture wind + captured ORS fixtures, asserts: ≥3 candidates, mutual overlap
      <70%, winner beats candidate median on time-weighted headwind seconds by ≥15%,
      every result has a non-empty numeric explanation, wall-clock <10 s.
- [ ] Emits a human-readable report (`accept-report.md`): table + the three explanations —
      the owner reads this to judge route quality by eye.
- [ ] Runs in CI on fixtures only; failure blocks merge.

## Test contract
The harness IS the test. Include one intentional-regression test: doubling the headwind
coefficient must change the ranking in the golden fixture (guards against dead wiring).

## Technical notes
Fixture wind is injected via the mock WeatherProvider scenario from WR-003 — no live calls.
Keep thresholds in one config block; tuning them requires a Log entry with reasoning.

## Out of scope
On-road validation (that's the owner's weekend, not CI).

## Log
