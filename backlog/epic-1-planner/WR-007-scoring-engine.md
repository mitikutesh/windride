# WR-007 · Scoring engine v1 + rule-based explanations
Epic: 1 · Planner | Status: TODO | Depends on: WR-006 | Size: L

## Goal
The product's brain: time-weighted wind scoring per SCORING_SPEC, producing ranked candidates
with truthful one-line explanations. Most-tested code in the repo.

## Context (read first)
SCORING_SPEC (all — the math is authoritative) · CLAUDE.md domain warnings · PRODUCT_SPEC §1.

## Acceptance criteria
- [ ] `wind.ts`: decomposition exactly per SCORING_SPEC §2; the three must-pass cases are
      literal unit tests.
- [ ] `speedModel.ts`: linear model per §3 with settings-injected coefficients; physics model
      behind a flag with same signature; monotonicity property tests.
- [ ] `scoring.ts`: v0.1 sub-scores (WindComfort, Sequencing, CrosswindSafety, SurfaceMatch,
      Traffic, Scenery-proxy, ClimbMatch, DistanceMatch, RainAvoid), normalized across the
      candidate set; weights renormalized over available sub-scores (§6); hard constraints §5.
- [ ] Loop-cancellation invariant test (§7) wired into the suite.
- [ ] Golden-ranking fixture: 3 synthetic candidates with hand-computed expected order —
      snapshot-locked; changing weights intentionally requires updating the snapshot + Log.
- [ ] `explain.ts`: top-2/3 facts per SCORING_SPEC §8; every sentence contains ≥1 number
      sourced from segment data; unit-tested against the golden fixture.
- [ ] Two-pass arrival-time wind sampling (§1) implemented (rough pass → refine).

## Test contract
Engine coverage ≥ 90%. Determinism test: same inputs twice ⇒ identical output. Perf guard:
scoring 8 candidates × ~170 segments × 12 hours completes < 300 ms in Vitest.

## Technical notes
Keep every sub-score a named pure function returning {value, evidence} — `evidence` feeds
explain.ts (e.g. sheltered-upwind metres). That single design choice makes explanations free.

## Out of scope
Shelter (exposure stays 1.0), robustness, start-time optimization.

## Log
