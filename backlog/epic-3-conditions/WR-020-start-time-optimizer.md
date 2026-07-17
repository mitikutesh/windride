# WR-020 · Start-time optimizer + heat strip
Epic: 3 · Conditions | Status: DONE | Depends on: WR-011 | Size: M

## Goal
Answer the better question — "which route AND when": score every candidate across the next
12–48 h of hourly forecasts (already in hand, zero extra API calls) and surface the joint
recommendation with a per-route heat strip.

## Context (read first)
PRODUCT_SPEC §3 v0.3 · API_NOTES §1 (all hours in one response) · DESIGN §4 HeatStrip.

## Acceptance criteria
- [x] `startTime.ts`: score(candidate, departureHour) reusing the two-pass arrival sampling;
      returns matrix candidates × hours; pure, tested. — implemented as
      `scoring.ts#scoreMatrix(inputs, hours, opts)` (samples wind per hour via `startHourIndex`,
      normalizes sub-scores jointly across all candidate×hour cells) plus `startTime.ts#bestStart`;
      both pure and unit-tested.
- [x] Joint recommendation: best (candidate, hour) within the user's window (default now→+12 h),
      respecting "home before dark" per-hour. — `bestStart` picks the joint max cell (ties: earlier
      hour, then id); `opts.minutesUntilSunset` shrinks by 60 min per departure hour so late cells
      are rejected (`total: null`) inside `scoreMatrix` itself.
- [x] HeatStrip component: hour cells coloured by score bucket, best cell marked, "now" marker;
      on cards and a compact strip on Plan. — `heat.ts#heatBucket` (5 buckets) + `HeatStrip.tsx`.
      Note: the strip renders on the Results card for the selected route (coloured across the
      whole matrix, best hour marked); Plan carries the departure-hour picker rather than its own
      strip.
- [x] Copy pattern: "Route B at 17:00 beats Route A at any time today" — generated from the
      matrix (tested phrasing rules, numbers included). — `startTime.ts#startTimeMessage`: cross-
      route win phrasing, "… is your best window" for a same-route win, and "No ride fits before
      dark in your window." when every cell is rejected.
- [x] Start-time picker lands on Plan (now / pick hour) feeding the pipeline. — Plan's "Start"
      Segmented (Now / +3 h / +6 h) sets `PlanInputs.departureHour`, which shifts the main
      ranking's `startHourIndex` and sunset margin in `runPlan.ts`.

## Test contract
Matrix tests on the shifting-wind mock scenario (WR-003): best hour moves as wind rotates;
daylight constraint eliminates late cells in a winter-sunset fixture.

## Technical notes
Cache per candidate geometry — only wind samples vary by hour; scoring 8×12 must stay <1 s.

## Out of scope
Ensemble robustness (WR-025).

## Log

Shipped the joint start-time optimizer and heat strip end-to-end:

- `src/engine/scoring.ts`: added `scoreMatrix(inputs, hours, opts)`, scoring every
  candidate × departure hour by sampling wind per hour via `startHourIndex`. Extracted the
  shared normalization into `subScoreNorms` + `weightedTotal`, reused by both `scoreCandidates`
  (unchanged behaviour) and `scoreMatrix`.
- `src/engine/startTime.ts` (pure): `bestStart(matrix, allowedHours?)` for the joint max cell,
  and `startTimeMessage(matrix, {label, hourLabel, allowedHours?})` for the recommendation copy.
- `src/state/plan/runPlan.ts`: computes the matrix over the whole forecast window, the
  recommendation message, and clock hour labels; `PlanOutput` gained `startMatrix`,
  `startMessage`, `hourLabels`; `PlanInputs` gained `departureHour` (0 = now).
- UI: `src/ui/components/heat.ts` (`heatBucket`, `HEAT_BUCKETS = 5`, pure) + `HeatStrip.tsx`;
  ResultsScreen shows the recommendation message and a HeatStrip for the selected route;
  PlanScreen gained a "Start" Segmented (Now / +3 h / +6 h) feeding `departureHour`;
  `resultsStore`/`planStore` carry the new matrix/message/labels fields.
- Tests: `src/engine/startTime.test.ts` (7 — best-hour tracking as wind rotates, daylight
  rejection, joint `bestStart` tie-breaking, all three `startTimeMessage` phrasings) and
  `src/ui/components/HeatStrip.test.tsx` (2 — bucket mapping, render markers). 281 tests total,
  lint clean, build OK.

Key decisions:
- **Joint normalization across the whole matrix** (all candidate×hour cells together), not
  per-hour re-anchoring, so totals are comparable across the entire matrix — this is what makes
  "Route B at 17:00 beats Route A at any time" a valid comparison instead of an artifact of
  re-normalizing each hour's slice independently.
- **Daylight enforced per departure hour**: `opts.minutesUntilSunset` is now-relative and shrinks
  by 60 min per hour offset, so cells departing too late are rejected (`total: null`) rather than
  silently scored as if daylight were unlimited.
- `scoreMatrix` reuses the same `subScoreNorms`/`weightedTotal` path as `scoreCandidates`, so the
  two scoring modes can't drift apart on sub-score semantics.
- Recommendation copy has three fixed outcomes: a cross-route/cross-hour win, a same-route best-
  window, or "No ride fits before dark in your window." when everything is rejected — no free-text
  generation, so phrasing is fully test-covered.
- HeatStrip buckets (5) map onto the existing wind-hue design tokens rather than introducing a new
  colour scale.
- The departure-hour picker offers Now / +3 h / +6 h (not a free hour-picker) as the v0.3 default;
  it feeds `departureHour` straight into the main ranking's `startHourIndex`/sunset margin, while
  the full matrix (used for the heat strip and recommendation) always spans the whole forecast
  window regardless of the picker value.

## Review pass — fixes

Reviewed by a substitute senior reviewer (Opus) — the Fable 5 model was out of usage credits this
session (two "Usage credits are required for this model" errors mid-session).

Adversarial review returned APPROVE-WITH-FIXES; all SHOULD-FIXes and the two actionable NITs are
applied, gate is green (285 tests, lint clean, build OK):

- **SF1 — label every matrix candidate.** `labelByRank` previously only labelled the ranked
  survivors for the picked `departureHour`, so the recommendation copy could name a matrix
  candidate ("Route B at 17:00 beats Route A...") that the current ranking had actually rejected
  on daylight grounds — a route referenced by a letter it was never assigned. Fixed: every
  candidate present in the matrix is now labelled — ranked survivors get Route A/B/C in rank
  order first, then any remaining daylight-rejected candidates get the next letters — so the
  message always names a route the label map actually covers.
- **SF2 — matrix daylight now follows the user's toggle.** The matrix was always scored with
  `homeBeforeDark: true` regardless of the Plan screen's toggle state, so with the toggle OFF the
  UI could show ranked, rideable routes while `startMessage` simultaneously said "No ride fits
  before dark" (computed against the always-on assumption). Fixed: `runPlan.ts` now passes the
  matrix through the same `homeBeforeDark` toggle as the main ranking, and only supplies
  `minutesUntilSunset` to `scoreMatrix` when the toggle is on — message and offered routes agree.
- **SF3 — `scoreMatrix` daylight guard.** `scoreMatrix` silently skipped the daylight constraint
  entirely if `minutesUntilSunset` was omitted while `homeBeforeDark` was `true`, instead of
  failing loudly. Fixed: `scoreMatrix` now throws the same guard `scoreCandidates` already uses
  for that combination, so a missing sunset value can't silently produce an unconstrained matrix.
- **SF4 — test coverage.** Added `runPlan` WR-020 coverage: `startMatrix` rows equal
  ranked-plus-rejected candidates, `hourLabels` are aligned and formatted `"HH:00"`, `startMessage`
  always names a real route, and there's exactly one cell per window hour; also verified that
  `departureHour` shifts both the ranking hour and the sunset margin together, so a later
  departure never ends up ranking *more* routes than an earlier one. Added `startTime.ts` coverage
  for `bestStart` honouring `allowedHours`, and for a fully-rejected candidate row being ignored
  while the runner-up cell is still picked correctly.
- **NIT — HeatStrip a11y.** `role="img"` on the strip collapses the subtree for assistive tech, so
  the per-cell `aria-label`s were dead weight (never reachable). Replaced with a single summary
  `aria-label` on the strip (including the best hour); individual cells are now `aria-hidden` with
  a `title` as a mouse-only hint — the numeric detail already lives in the adjacent recommendation
  sentence, so nothing is lost.
- **NIT — HeatStrip overflow.** Added `overflow-x: auto` so a long forecast window (more hours
  than fit the card width) scrolls horizontally instead of overflowing the card.
- **Deferred (noted, not changed):** the per-route heat marker shows the *selected* route's local
  best hour while the recommendation sentence names the *joint* best across all routes — accepted
  as-is since the strip is explicitly per-route; the "+0.5 beats" threshold and the heat-bucket
  cutoffs are already documented in code comments rather than re-derived here; and when a
  `departureHour` empties the ranking entirely, `planStore` still takes its existing error path
  rather than surfacing the optimizer's "ride earlier" recommendation there — flagged as a
  possible follow-up, not fixed in this pass.
