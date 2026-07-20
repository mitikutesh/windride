# WR-049 · Post-ride AI summary
Epic: 6 · AI | Status: TODO | Depends on: WR-044 | Size: S

## Goal
After a ride, a friendly recap of the recording versus the plan — where the wind helped or
hurt, how honest the ETA was, which stretches got gusty — grounded in computed comparisons,
from our OWN recordings only.

## Context (read first)
WR-044 (adapter, validation, guardrails) · WR-017 recorder · WR-024 calibration (the
planned-vs-actual machinery to reuse) · CLAUDE.md domain warnings (never Strava).

## Acceptance criteria
- [ ] Recap input = app-computed comparison numbers only: planned vs actual time, per-stretch
      speed deltas against planned wind (v_par), overall ETA error, gust-flag stretches
      crossed — built from the user's own recording + the plan (reusing WR-024's
      planned-analysis-in-memory approach); Strava data is structurally absent from the path.
- [ ] Output: short structured recap (highlights, where wind helped/hurt, ETA verdict)
      validated per WR-044; malformed ⇒ no recap, the ride summary screen is unchanged.
- [ ] Opt-in action on a finished/saved ride; absent without an `ai` key; rides without a
      matching plan in memory get no recap rather than a made-up one.
- [ ] Every number shown came in via the input — the model narrates, never recomputes.

## Test contract
Recap-input builder unit tests (planned-vs-actual join over a replay fixture, no-plan case
yields no input); fixture response renders; malformed fixture ⇒ absent; no-key ⇒ action
hidden.

## Out of scope
Training load/coaching · trends across multiple rides · syncing recaps anywhere.
