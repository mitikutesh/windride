# WR-024 · Speed-model calibration from recorded rides
Epic: 3 · Conditions | Status: DONE | Depends on: WR-017 | Size: M

## Goal
Close the loop: learn the owner's real v0 and wind coefficients from their own recorded rides
so ETAs converge on the truth.

## Context (read first)
SCORING_SPEC §3 · WR-017 ride↔route linkage.

## Acceptance criteria
- [x] Per completed ride with a linked plan: bucket actual segment speeds by (surface,
      v_par band, grade band); persist aggregates.
- [x] After ≥5 rides: least-squares fit of {v0_road, v0_gravel, k_tail, k_head} with bounds
      (k_head ≥ k_tail ≥ 0); propose in Settings as "Calibrated model" with before/after ETA
      error shown; user applies explicitly (no silent changes).
- [x] ETA-error metric tracked per ride (|predicted − actual| moving time %) and displayed —
      the honesty scoreboard.
- [x] All math pure + unit-tested with synthetic ride datasets (known ground-truth params
      recovered within 10%).

## Test contract
Synthetic recovery test as above; degenerate-data guards (all-flat, all-tailwind rides ⇒
partial fit only, others untouched).

## Out of scope
Physics-model (CdA/Crr) fitting; per-route learning.

## Log

**2026-07-17** — Shipped speed-model calibration end to end:
- `src/engine/calibration.ts` (new, pure): `fitSpeedModel(obs, base)` — weighted least-squares
  fit of the 4 named params `{v0Paved, v0Gravel, kTail, kHead}` of the linear speed model. Grade
  coefficients are held fixed and the grade term is subtracted from observed speed before the
  fit, so it stays a clean 4-parameter linear LS problem rather than a joint physics fit. Bounds
  `k_head ≥ k_tail ≥ 0` enforced by projection. Columns with no signal in the observations are
  left unfitted (base value carried through) — degenerate inputs (all-tailwind, single-surface)
  yield a partial fit instead of garbage. Also: `bucketObservations`/`mergeBuckets`/
  `bucketsToObservations` — persistable weighted-sum aggregates keyed by (surface, v_par band,
  grade band), with band edges sitting exactly on the model's kinks (0 for wind, 0 for grade) so
  no bucket ever mixes head/tail or up/down; `etaErrorPct`/`etaErrorForModel` — moving-time ETA
  error a given model scores over a set of buckets, the before/after comparison; `toSpeedSettings`,
  `predictedSpeedKmh`.
- `src/nav/rideCalibration.ts` (new): `observationsFromRide(analysis, points)` snaps a recorded
  ride onto its planned route with the windowed `Snapper` and accumulates on-route distance/time
  per planned segment, emitting one `RideObservation` per paved/gravel segment. Path/unknown
  segments are left at defaults — the fit only calibrates paved & gravel base speeds.
- `src/state/calibrationStore.ts` (new, zustand + idb persist, key `windride-calibration`): banks
  per-ride buckets (aggregates only, never raw points) plus `rideCount` and recent per-ride ETA
  errors. `computeProposal(buckets, rideCount)` fits once `rideCount ≥ ENOUGH_RIDES` (5), reporting
  before/after ETA error. `apply`/`clearApplied`/`resetData` round out the store.
  `activeSpeedSettings()` overlays the applied calibration onto defaults, else returns defaults
  unchanged.
- `src/nav/recorder.ts`: `RideFinish` now also returns `points`, so ride-finish can feed them into
  calibration alongside the existing summary.
- UI: `src/ui/components/CalibrationSettings.tsx` (new), added to `KitScreen` — shows rides
  banked, recent ETA error, the proposed model with before/after ETA error, and explicit
  Apply / Reset-to-default / Clear-data controls (planning never changes silently).
  `RideScreen.tsx` calls `calibrationStore.recordRide(analysis, points, analysis.totalTimeS,
  summary.movingS)` on ride finish whenever a planned analysis is loaded (a linked plan).
- `src/state/plan/runPlan.ts`: planning now passes `speed: activeSpeedSettings()` into
  `scoreCandidates`/`scoreMatrix`, so an applied calibration actually drives ETAs instead of
  sitting unused in the store.

**Decisions:** **DEC-028** (new, see `docs/DECISIONS.md`) — grade coefficients held fixed and
subtracted before the fit (physics CdA/Crr fitting stays out of scope); calibration captured at
ride-finish while the planned `CandidateAnalysis` is still in memory, because the planned
per-segment wind (v_par) and grade are not persisted with the recorded ride and can't be
recovered from the GPX alone (rides finished before this story, or after a reload with no loaded
plan, contribute nothing); only aggregated buckets persist, never raw points, with band edges on
the model's kinks; applying a calibrated model is an explicit owner action in Settings, per
acceptance; before/after ETA error is computed over the calibrated paved/gravel portion of the
buckets — the only portion any calibration can change.

**Tests:** `src/engine/calibration.test.ts` (synthetic ground-truth recovery within 10%,
partial-fit degenerate guards for all-tailwind and single-surface data, bounds projection,
bucketing round-trip preserves the fit, bucket merge, `etaErrorForModel`, `toSpeedSettings`),
`src/nav/rideCalibration.test.ts`, `src/state/calibrationStore.test.ts`. Full gate: 335 tests,
lint clean, build OK.

**Follow-ups:** path/unknown base speeds and physics-model (CdA/Crr) fitting remain out of scope
per the story. Reviewed post-implementation by a substitute senior reviewer (Opus) — Fable 5 was
out of usage credits this session; see follow-up review commit for findings/fixes.

**2026-07-17 — Substitute review (Opus, standing in for Fable 5 — out of credits) — fixes
applied.** Verdict: REQUEST-CHANGES; all six findings below are fixed and the gate is green (339
tests, lint clean, build OK).
- **MAJOR 1 — bounds could move an unfitted param.** The old `kHead = max(kHead, kTail)`
  projection could push an *unfitted* headwind coefficient above its base value when tail-only
  data fit `kTail` high, while the UI still claimed "kept defaults" — dishonest. Fixed: the
  `k_head ≥ k_tail ≥ 0` bound is now enforced only among *fitted* parameters; a held (unfitted)
  coefficient stays exactly at base and the fitted one is clamped against it instead. New
  regression test: tail-only data leaves `kHead` at base and clamps `kTail`.
- **MAJOR 2 — moving-time mismatch.** `observationsFromRide` counted all on-track time
  including stops, but `summary.movingS` excludes sub-1.2 km/h time — the fit and the ETA target
  were on different clocks (stopped time dragged `v0` low, so ETAs ran too long). Fixed:
  `observationsFromRide` now applies the same `MOVING_SPEED_MS` gate, so observed speeds and
  weights are on the moving-time clock. New test: a 120 s stop no longer drags observed speed
  down.
- **MAJOR 3 — grade leak into v0.** Holding the crude linear grade term fixed while fitting a
  single `v0` across all grades let descent error contaminate `v0`. Fixed: the fit and the
  before/after comparison now run over near-flat buckets only (`|grade| ≤ MAX_FIT_GRADE_PCT`,
  4%); steep buckets are still persisted, for a future physics-model story. New test: a near-flat
  fit recovers `v0` cleanly while fitting everything is pulled off.
- **MAJOR 4 — no completion guard.** Per-ride ETA error compared the full-plan predicted time
  against a partial actual, so a bailed-early ride could fabricate a ~700% error and still count.
  Fixed: per-ride ETA error is now computed by `etaErrorForModel` over the ride's own buckets (the
  portion actually ridden), scored with the model in effect at the time — coverage-robust.
- **MINOR 5 — jittery observed distance.** Observed distance now uses snapped along-track
  progress delta rather than raw GPS haversine (which jitter inflates), plus a sanity clamp to
  the model's max speed.
- **MINOR 6 — unvalidated persisted model.** The persisted `applied` model is now validated (all
  params finite) before it can drive ETAs — `activeSpeedSettings()` falls back to default
  otherwise; the persist store gained `version: 1`; the Settings panel now handles the
  zero-fitted-parameters case honestly instead of implying a full fit occurred.
- See the DEC-028 review addendum in `docs/DECISIONS.md` for the design-level summary of these
  refinements.
