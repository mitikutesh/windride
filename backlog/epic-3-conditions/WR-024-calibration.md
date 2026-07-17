# WR-024 · Speed-model calibration from recorded rides
Epic: 3 · Conditions | Status: TODO | Depends on: WR-017 | Size: M

## Goal
Close the loop: learn the owner's real v0 and wind coefficients from their own recorded rides
so ETAs converge on the truth.

## Context (read first)
SCORING_SPEC §3 · WR-017 ride↔route linkage.

## Acceptance criteria
- [ ] Per completed ride with a linked plan: bucket actual segment speeds by (surface,
      v_par band, grade band); persist aggregates.
- [ ] After ≥5 rides: least-squares fit of {v0_road, v0_gravel, k_tail, k_head} with bounds
      (k_head ≥ k_tail ≥ 0); propose in Settings as "Calibrated model" with before/after ETA
      error shown; user applies explicitly (no silent changes).
- [ ] ETA-error metric tracked per ride (|predicted − actual| moving time %) and displayed —
      the honesty scoreboard.
- [ ] All math pure + unit-tested with synthetic ride datasets (known ground-truth params
      recovered within 10%).

## Test contract
Synthetic recovery test as above; degenerate-data guards (all-flat, all-tailwind rides ⇒
partial fit only, others untouched).

## Out of scope
Physics-model (CdA/Crr) fitting; per-route learning.

## Log
