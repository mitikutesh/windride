# WR-021 · Gust-exposure safety flags
Epic: 3 · Conditions | Status: TODO | Depends on: WR-019 | Size: S

## Goal
Reframe wind as safety where it matters: flag exposed high-crosswind stretches when gusts
exceed threshold, in results and as a ride-time warning.

## Context (read first)
SCORING_SPEC §4 CrosswindSafety · PRODUCT_SPEC §3 v0.3.

## Acceptance criteria
- [ ] Flag rule: gust_eff ≥ threshold (default 13 m/s, settings 10–18) AND v_cross ≥ 0.6·W_eff
      AND exposure ≥ 1.0, merged into stretches ≥ 300 m.
- [ ] Results: warning chip per flagged route ("2.1 km exposed crosswind, gusts 14 m/s") +
      map markers at stretch midpoints.
- [ ] Ride HUD (WR-016): upcoming flagged stretch announced once, 500 m ahead.
- [ ] CrosswindSafety sub-score now uses the same stretch detection (single source).

## Test contract
Stretch-merging unit tests (gaps, minimum length); golden fixture: coastal candidate gets the
flag, forest one doesn't.

## Out of scope
Wind-station live data; rider-weight-based thresholds.

## Log
