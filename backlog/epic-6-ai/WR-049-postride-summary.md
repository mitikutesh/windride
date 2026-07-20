# WR-049 · Post-ride AI summary
Epic: 6 · AI | Status: DONE | Depends on: WR-044 | Size: S

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
      → DEC-048: a `RecordedRide` doesn't persist the plan's ETA, per-segment v_par, or
      gust-flag stretches, so this literal input shape is deferred until a plan snapshot is
      persisted with the ride. What ships instead: `buildRecapFacts` (pure, `engine/rideRecap.ts`)
      reduces the persisted `RideSummary` to distance/moving/elapsed/rest minutes, avg speed, and
      — when the ride is plan-linked (`windByKindS` present) — wind-mix % and headwind-avoided km.
      Strava fields (`stravaActivityId`/name) are structurally absent from `RecapFacts` and never
      reach the prompt — verified end-to-end by Fable review.
- [ ] Output: short structured recap (highlights, where wind helped/hurt, ETA verdict)
      validated per WR-044; malformed ⇒ no recap, the ride summary screen is unchanged.
      → DEC-048: ETA verdict is deferred (no ETA data available, see above); "where wind
      helped/hurt" ships as the wind-mix %/headwind-avoided facts instead of a narrated verdict.
      What ships and is genuinely met: output shape `{summary, highlights[]}`, validated by
      `parseRecap` (`engine/rideRecap.ts`) — a present-but-malformed highlight element (a number,
      object, or empty string) rejects the WHOLE response, never partial-trust; on rejection the
      ride history/summary screen is unchanged (`RideRecap` shows nothing but its opt-in button).
- [x] Opt-in action on a finished/saved ride; absent without an `ai` key; rides without a
      matching plan get no recap rather than a made-up one. (Reframed: "matching plan in memory"
      → "plan-linked ride", i.e. a persisted `RideSummary.windByKindS` — the in-memory planned
      analysis WR-024 used doesn't survive a reload/history view, so plan-linkage is read off the
      persisted summary instead. `RideRecap` renders nothing unless AI is set up (`aiProvider` +
      `ai` key) AND `ride.summary.windByKindS` exists; covered by render tests: no-key hidden,
      no-plan hidden, ready renders.)
- [x] Every number shown came in via the input — the model narrates, never recomputes.
      (`recapRequest`'s system prompt instructs the model not to invent anything beyond the given
      numbers; `buildRecapFacts` is the sole source of figures; the model only produces
      `summary`/`highlights` prose, no numeric fields of its own.)

## Test contract
Recap-input builder unit tests (planned-vs-actual join over a replay fixture, no-plan case
yields no input); fixture response renders; malformed fixture ⇒ absent; no-key ⇒ action
hidden.

## Out of scope
Training load/coaching · trends across multiple rides · syncing recaps anywhere.

## Log
Shipped: `src/engine/rideRecap.ts` (pure) — `buildRecapFacts` (RideSummary → grounded numbers:
distance, moving/elapsed/rest minutes, avg speed, and, when plan-linked, wind-mix % +
headwind-avoided km), `recapRequest` (prompt), `parseRecap` (validates the whole response,
rejecting on any malformed highlight element rather than silently filtering). `src/state/recapStore.ts`
— `getAiClient().complete()`, a status machine, and a monotonic request-token guard so a slow
older request can't clobber a newer one; client is injectable for tests. `src/ui/components/RideRecap.tsx`
— per-ride "AI recap" opt-in button, renders nothing unless AI is set up AND the ride is
plan-linked (`windByKindS`); pure view over the store. `src/ui/components/RideHistory.tsx` mounts
`<RideRecap ride={r}/>` per ride.

Fable review verified the Strava wall end-to-end (recap is built ONLY from the rider's own
`RideSummary`; `stravaActivityId`/name never reach the prompt) and fixed two Important issues:
`parseRecap` now rejects a present-but-malformed highlight element (a number/object/empty string)
instead of silently filtering it out, matching DEC-043's "malformed ⇒ drop the whole response,
never partial-trust"; and a same-ride request race, where a late-failing older request could
overwrite a newer success, fixed with the monotonic request-token guard in `recapStore`. Review
also confirmed the recap is gated to plan-linked rides so "no plan → no recap" holds, and added
`RideRecap` render tests (no-key hidden, no-plan hidden, ready renders) plus a race test.

Added DEC-048 recording the deliberate scope narrowing: a `RecordedRide` doesn't persist the
plan's predicted ETA, per-segment v_par, or gust-flag stretches, so v1 recaps can't give the
story's ETA verdict / per-stretch speed deltas / gust-stretch callouts — those wait on a future
story that persists a plan snapshot with the ride. v1 recaps distance/time/speed plus, when
plan-linked, wind-mix % and headwind-avoided km; output is `{summary, highlights[]}`.

Follow-ups: persist a plan snapshot (predicted ETA, per-segment v_par, gust-flag stretches) with
the ride so a future recap can give the full ETA-verdict / per-stretch speed-delta / gust-stretch
recap the story originally described.
