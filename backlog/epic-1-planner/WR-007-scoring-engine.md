# WR-007 · Scoring engine v1 + rule-based explanations
Epic: 1 · Planner | Status: DONE | Depends on: WR-006 | Size: L

## Goal
The product's brain: time-weighted wind scoring per SCORING_SPEC, producing ranked candidates
with truthful one-line explanations. Most-tested code in the repo.

## Context (read first)
SCORING_SPEC (all — the math is authoritative) · CLAUDE.md domain warnings · PRODUCT_SPEC §1.

## Acceptance criteria
- [x] `wind.ts`: decomposition exactly per SCORING_SPEC §2; the three must-pass cases are
      literal unit tests.
- [x] `speedModel.ts`: linear model per §3 with settings-injected coefficients; physics model
      behind a flag with same signature; monotonicity property tests.
- [x] `scoring.ts`: v0.1 sub-scores (WindComfort, Sequencing, CrosswindSafety, SurfaceMatch,
      Traffic, Scenery-proxy, ClimbMatch, DistanceMatch, RainAvoid), normalized across the
      candidate set; weights renormalized over available sub-scores (§6); hard constraints §5.
- [x] Loop-cancellation invariant test (§7) wired into the suite.
- [x] Golden-ranking fixture: 3 synthetic candidates with hand-computed expected order —
      snapshot-locked; changing weights intentionally requires updating the snapshot + Log.
- [x] `explain.ts`: top-2/3 facts per SCORING_SPEC §8; every sentence contains ≥1 number
      sourced from segment data; unit-tested against the golden fixture.
- [x] Two-pass arrival-time wind sampling (§1) implemented (rough pass → refine).

## Test contract
Engine coverage ≥ 90%. Determinism test: same inputs twice ⇒ identical output. Perf guard:
scoring 8 candidates × ~170 segments × 12 hours completes < 300 ms in Vitest.

## Technical notes
Keep every sub-score a named pure function returning {value, evidence} — `evidence` feeds
explain.ts (e.g. sheltered-upwind metres). That single design choice makes explanations free.

## Out of scope
Shelter (exposure stays 1.0), robustness, start-time optimization.

## Log
Shipped the full scoring engine: `wind.ts` (`decompose()`, exact §2 sign convention, the three
must-pass cases as literal tests), `speedModel.ts` (linear MVP per §3 with
`DEFAULT_SPEED_SETTINGS` per DEC-004 — paved 27 / gravel 21 / path 18 / unknown 24 km/h, 180 W,
85 kg, CdA 0.32, Crr .005 paved / .012 gravel — plus the Newton-iteration physics model behind
the same `segmentSpeedKmh`/`segmentTimeS` signature via `settings.model`; monotonicity property
tests for both models), `scoring.ts` (`analyzeCandidate` + `scoreCandidates`), and `explain.ts`
(`explainCandidate` + `formatDuration`). 46 new tests, 121 total, all green; engine coverage
94.2% (≥ 90% target); lint and build clean.

Key design/decisions:
- **Two-pass arrival-time wind sampling (§1):** a rough pass at base speed fixes each segment's
  estimated arrival hour, then a second pass re-samples wind at that hour and refines
  speed/time. Tested explicitly: later segments sample a later forecast hour.
- **`{value, evidence}` on every sub-score:** each of the 9 v0.1 sub-scores (WindComfort,
  Sequencing, CrosswindSafety, SurfaceMatch, Traffic, Scenery-proxy, ClimbMatch, DistanceMatch,
  RainAvoid) returns a plain value plus an evidence record (directHeadwindKm, tailwindFinishKm,
  gustyKm, maxGustMs, gravelKm, greenerKm, ascentM, ...). This is what makes `explain.ts` free —
  it just picks the strongest evidence fields and templates them with real numbers, no
  recomputation. Weights (§6) are renormalized over the available sub-scores since
  shelter/robustness aren't implemented yet (available weights sum to 0.84).
- **Linear-model downhill is a documented spec-literal quirk:** §3's linear formula
  (`-2.2*max(grade,0) + 1.2*min(grade,0)`) applies the "steeper ⇒ slower" penalty even on
  descents, so the MVP linear model yields a small speed *reduction* going downhill instead of a
  speedup. Implemented exactly as specified rather than silently "fixing" the spec; the physics
  model (Newton iteration on the power-balance equation) handles descents correctly and is
  available behind `settings.model` for when this matters.
- **Golden snapshot lock:** a synthetic 3-candidate fixture (A tailwind-favoured, B
  headwind-heavy, C crosswind) reproduces the hand-computed ranking A(81) > C(67) > B(31) and is
  snapshot-locked — intentional weight changes must update the snapshot plus this Log.
- Also covered: hard-constraint rejection (§5: distance ±15%, ferry, home-before-dark),
  loop-cancellation invariant Σ L·cos(Δ) ≈ 0 (§7), determinism (same input twice ⇒ identical
  output), and a perf guard (8 candidates × ~170 segments × 12 hours < 300 ms).
- **Deferred, per Out of scope:** shelter sub-score (exposure stays 1.0 everywhere — Epic 3),
  robustness sub-score (Epic 4, WR-025), start-time optimization (Epic 3, WR-020).

Follow-up for WR-008: the Plan screen wires `generateCandidates` (ORS) → weather (Open-Meteo) →
`scoreCandidates`/`analyzeCandidate` → `explainCandidate` into the results the UI renders; no
scoring-engine changes expected, just composition at the UI/adapter boundary.
