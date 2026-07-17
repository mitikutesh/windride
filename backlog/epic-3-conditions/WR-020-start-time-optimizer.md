# WR-020 · Start-time optimizer + heat strip
Epic: 3 · Conditions | Status: TODO | Depends on: WR-011 | Size: M

## Goal
Answer the better question — "which route AND when": score every candidate across the next
12–48 h of hourly forecasts (already in hand, zero extra API calls) and surface the joint
recommendation with a per-route heat strip.

## Context (read first)
PRODUCT_SPEC §3 v0.3 · API_NOTES §1 (all hours in one response) · DESIGN §4 HeatStrip.

## Acceptance criteria
- [ ] `startTime.ts`: score(candidate, departureHour) reusing the two-pass arrival sampling;
      returns matrix candidates × hours; pure, tested.
- [ ] Joint recommendation: best (candidate, hour) within the user's window (default now→+12 h),
      respecting "home before dark" per-hour.
- [ ] HeatStrip component: hour cells coloured by score bucket, best cell marked, "now" marker;
      on cards and a compact strip on Plan.
- [ ] Copy pattern: "Route B at 17:00 beats Route A at any time today" — generated from the
      matrix (tested phrasing rules, numbers included).
- [ ] Start-time picker lands on Plan (now / pick hour) feeding the pipeline.

## Test contract
Matrix tests on the shifting-wind mock scenario (WR-003): best hour moves as wind rotates;
daylight constraint eliminates late cells in a winter-sunset fixture.

## Technical notes
Cache per candidate geometry — only wind samples vary by hour; scoring 8×12 must stay <1 s.

## Out of scope
Ensemble robustness (WR-025).

## Log
