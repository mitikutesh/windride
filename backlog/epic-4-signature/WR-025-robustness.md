# WR-025 · Forecast-robustness sub-score
Epic: 4 · Signature | Status: TODO | Depends on: WR-007 | Size: S

## Goal
Prefer routes that survive a wrong forecast: re-score with wind direction perturbed ±30°, take
the minimum WindComfort as the Robustness sub-score.

## Context (read first)
SCORING_SPEC §4 Robustness, §6 weights.

## Acceptance criteria
- [ ] `robustness(candidate, wind)` = min over wind_from ∈ {−30, 0, +30}° of WindComfort;
      joins the weight vector; ties in ranking break toward higher robustness.
- [ ] Results card shows a small "robust ✓ / fragile △" marker with the spread number.
- [ ] Golden fixture gains a "fragile" candidate (great at exact forecast, collapses at +30°)
      demoted below a slightly-worse-but-robust one; snapshot locked.

## Test contract
Symmetric-loop property: perfectly symmetric circle ⇒ robustness ≈ WindComfort (rotation-
invariant). Perf: adds <2× scoring cost (reuse geometry).

## Out of scope
True ensemble members (future; API_NOTES note only).

## Log
