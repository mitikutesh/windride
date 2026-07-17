# WR-025 · Forecast-robustness sub-score
Epic: 4 · Signature | Status: DONE | Depends on: WR-007 | Size: S

## Goal
Prefer routes that survive a wrong forecast: re-score with wind direction perturbed ±30°, take
the minimum WindComfort as the Robustness sub-score.

## Context (read first)
SCORING_SPEC §4 Robustness, §6 weights.

## Acceptance criteria
- [x] `robustness(candidate, wind)` = min over wind_from ∈ {−30, 0, +30}° of WindComfort;
      joins the weight vector; ties in ranking break toward higher robustness.
- [x] Results card shows a small "robust ✓ / fragile △" marker with the spread number.
- [x] Golden fixture gains a "fragile" candidate (great at exact forecast, collapses at +30°)
      demoted below a slightly-worse-but-robust one; snapshot locked.

## Test contract
Symmetric-loop property: perfectly symmetric circle ⇒ robustness ≈ WindComfort (rotation-
invariant). Perf: adds <2× scoring cost (reuse geometry).

## Out of scope
True ensemble members (future; API_NOTES note only).

## Log

**2026-07-17** — Shipped the forecast-robustness sub-score end to end (SCORING_SPEC §4):
- `src/engine/scoring.ts`: new helpers `rotateWindFrom`, `headwindPenaltyOf`, `computeRobustness`.
  For each candidate, the engine re-analyses with `wind_from` perturbed −30° and +30° (fixed
  geometry/segments reused, only the wind-relative pass re-runs) and takes the **worst-case**
  headwind penalty across `{−30°, 0°, +30°}` — equivalent to the minimum WindComfort — as the
  `robustness` sub-score. New consts `ROBUSTNESS_PERTURBATION_DEG` (30) and
  `ROBUST_SPREAD_THRESHOLD_MS` (0.5, the robust/fragile UI cutoff). `robustness` joins
  `DEFAULT_WEIGHTS` at 0.10; the total renormalises over whichever weights are present, per the
  existing pattern. `computeMetrics` now takes `windBySegment` so it can run the ±30° passes;
  both `scoreCandidates` and `scoreMatrix` pass the wind plus the matching `startHourIndex`, so
  rotated passes sample the same forecast hour as the primary pass and the start-time heat-strip
  stays consistent with the main ranking. Ranking ties now break toward higher robustness, then
  candidate id.
- Evidence gained `robustnessSpreadMs` — the extra time-weighted effective headwind (m/s) under
  the worst ±30° error (small = robust, large = fragile). Chosen as an absolute, bounded metric
  rather than a relative % that would blow up on near-zero-headwind routes.
- UI: `RouteCard.tsx` + `components.css` — a small "✓ robust / △ fragile · ±30° forecast:
  +X.X m/s" marker, tokens-only (`--tail` green / `--head` red), gated on
  `ROBUST_SPREAD_THRESHOLD_MS`.
- Tests (`scoring.test.ts`): a rotation-symmetric 12-gon property test (robustness ≈ WindComfort,
  spread ≈ 0 — the rotation-invariance contract) and a fragile-demotion golden (a route that's
  headwind-free at the exact forecast but collapses to a 120° headwind at −30° ranks **below** a
  slightly-shorter but robust route; snapshot locked). `explain.test.ts` fixture updated for the
  new sub-score/evidence field. The existing golden ranking snapshot was re-locked (candidate
  order A, C, B unchanged; totals shifted only because a new weighted sub-score joined). Full
  gate: 341 tests, lint clean, build OK.
- **Perf:** robustness adds two extra wind re-analyses per candidate, reusing geometry/segments —
  within the story's "<2× scoring cost" budget.
- See **DEC-029** for the spread-as-m/s, UI threshold, matrix-inclusion, and tie-break decisions.
- Reviewed post-implementation by a substitute senior reviewer (Opus) — Fable 5 was out of usage
  credits this session; see follow-up review commit for findings/fixes.

**2026-07-18 — Substitute review (Opus, standing in for Fable 5 — out of credits) — fixes
applied.** Verdict: REQUEST-CHANGES; all six findings below (2 MAJOR, 3 MINOR, 1 NIT) are fixed
and the gate is green (342 tests, lint clean, build OK).
- **MAJOR 1 — fragile-demotion test was confounded.** The golden ranking test passed even with
  the robustness weight zeroed out — the "robust" route was also shorter/faster, so time-weighted
  traffic+rain favoured it regardless of robustness. Fixed: the test now proves causation via a
  weight flip — scoring with only `{distance: 0.05, robustness: X}`, the robust route wins with
  robustness ON and the order flips to the fragile route with robustness OFF. The sub-score/
  spread assertions and the default-weights golden snapshot are unchanged.
- **MAJOR 2 — badge conflated "insensitive" with "good".** A uniformly bad route (e.g. pure
  headwind at every rotation) is insensitive to a ±30° shift, so it showed a reassuring green
  "✓ robust" — implying quality it doesn't have. Fixed: the `RouteCard` marker is now
  quality-neutral — "✓ forecast-stable / △ forecast-sensitive · ±30°: +X.X m/s"; stable is muted
  (`var(--text2)`), only the sensitive case is coloured (`--head`) as a caution. Overall route
  quality remains the score ring's job, not this marker's.
- **MINOR 3 — tie-break could throw.** A caller dropping the robustness weight (a documented,
  supported contract) left `sub.robustness` undefined at tie-break time. Fixed: the tie-break now
  optional-chains it (`?? 0.5`).
- **MINOR 4 — matrix cost unguarded.** Added a `scoreMatrix` perf guard test (6 candidates × 12
  hours, each cell doing the base pass plus two ±30° re-analyses, asserted under 500 ms).
- **MINOR 5 — base penalty computed two ways.** `computeMetrics` now derives the base headwind
  penalty via `headwindPenaltyOf(a.segments)` — the same function the ±30° passes use — so the
  spread's baseline can't silently drift from the rotated passes' baseline.
- **NIT — spread was emphasis-weighted, not true m/s.** `robustnessSpreadMs` is now the extra
  *un-emphasised* effective headwind (m/s) at the worst-penalty rotation (new `effHeadwindOf`
  helper), so the card's "m/s" figure is an honest wind reading; the ranking penalty itself still
  uses the emphasis-weighted worst-case, unchanged.
- See the DEC-029 review addendum in `docs/DECISIONS.md` for the design-level summary.
