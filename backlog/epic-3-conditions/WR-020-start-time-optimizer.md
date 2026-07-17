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
