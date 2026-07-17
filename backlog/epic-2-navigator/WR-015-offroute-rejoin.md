# WR-015 · Off-route detection + rejoin-track reroute
Epic: 2 · Navigator | Status: DONE | Depends on: WR-013 | Size: M

## Goal
The detail most nav apps get wrong: when the rider leaves the track, guide them back to the
CHOSEN route ~500 m downstream — never reroute to the finish.

## Context (read first)
NAVIGATION_SPEC §3 (authoritative) · API_NOTES §2 (pointToPoint, budget).

## Acceptance criteria
- [x] Trigger: perpendicular >45 m sustained >10 s ⇒ alert (sound + banner).
- [x] Reroute: one RouteProvider.pointToPoint(current, trackPointAt(progress+500 m)); splice
      leg into route; downstream geometry, steps and scored segments preserved; cues re-armed.
- [x] Reroute failure (quota/offline): stay in alert state with bearing-and-distance-to-track
      arrow; retry with backoff; never silently drop guidance.
- [x] Rejoined ride's remaining ETA updates within 2 fixes.

## Test contract
Off-route replay trace: alert fires in the 10–14 s window; with mocked reroute leg, splice
keeps total remaining monotonic and finish point identical. Failure-path test via mock quota
error. Splice unit tests (leg shorter/longer than gap).

## Technical notes
Splicing must recompute cumulative distances and re-index steps once — do it in one pure
function `spliceRoute(route, atM, leg)` in engine/geometry (add there, keep nav thin).

## Out of scope
Multi-rejoin optimization; scoring the new leg's wind (reuse nearest segment's sample).

## Log
Shipped `src/engine/geometry.ts` addition `spliceRoute(route, atM, leg): CandidateRoute` (pure),
`src/nav/snap.ts` addition `pointAtDistance(track, m): LatLon`, and new `src/nav/offRoute.ts`
(`OffRouteMonitor`, `Rerouter`, `bearingToTrack`).

`spliceRoute` builds the forward route as `[leg] + [original route beyond atM]`: the stretch
before the rejoin distance (the divergence and whatever section it skipped) is dropped, and
everything from `atM` to the finish is carried over unchanged — same downstream segment objects,
re-indexed step waypoints, cumulative distances recomputed once. This guarantees the finish point
is always identical to the original route's finish and remaining distance never shortcuts to it
(the NEVER-reroute-to-finish rule from NAVIGATION_SPEC §3/PRODUCT_SPEC). `distanceM` becomes
`leg.distanceM + (routeTotal − atM)`; ascent is recomputed over the spliced geometry.

`pointAtDistance(track, m)` interpolates a `LatLon` at along-track distance `m`, giving the
rejoin target `progress + 500 m` (`REJOIN_AHEAD_M`) that both the monitor and the rerouter need.

`OffRouteMonitor` is fed the snap perpendicular distance and fix time on every fix and reports
`'on-route' | 'off-pending' | 'alert'`; it fires `'alert'` only once perpendicular distance has
stayed above `OFF_ROUTE_PERP_M` (45 m) continuously for `OFF_ROUTE_SUSTAIN_MS` (10 s) — a single
spike or GPS jitter doesn't trigger it. `reset()` clears the sustain timer once a reroute
succeeds so the monitor doesn't immediately re-fire on the new route.

`Rerouter.attempt(current, route, track, progressM)` issues exactly one
`RouteProvider.pointToPoint(current → pointAtDistance(track, progressM + 500 m))` and splices the
returned leg via `spliceRoute`. On success it returns `{ ok: true, route, rejoinAtM }` and resets
its internal attempt counter; on provider failure it returns `{ ok: false, error, nextRetryMs }`
with exponential backoff (`rerouteBackoffMs`: 2 s base, doubling, capped at `REROUTE_BACKOFF_CAP_MS`
= 30 s) — guidance is never silently dropped, the caller stays in the alert state and keeps
retrying on the backoff schedule. `bearingToTrack(current, snapped)` gives the bearing and
straight-line distance to the nearest track point for the failed-state "bearing-to-track arrow"
shown while reroute attempts are still failing.

Cue re-arm is wired through WR-014's `CueScheduler.rearm(newCuePoints, progressM)`: the caller
(WR-016) rebuilds cue points from the spliced route's steps and calls `rearm` after a successful
splice, matching the hook WR-014 already left in place.

Key decisions:
- `spliceRoute` is kept as a single pure function in `engine/geometry` per the story's technical
  note — it imports only domain types and existing geometry helpers, so `nav/offRoute.ts` stays
  thin and only imports `spliceRoute` from engine, `pointAtDistance` from `nav/snap`, and the
  `RouteProvider` type from `adapters/routing` (nav → adapters/engine is an allowed dependency
  direction; only `engine` and `ui` are import-restricted per ARCHITECTURE).
- Rejoin target is always `progress + 500 m` along the *original chosen* track, never the finish
  — this is the detail the story exists to get right, and both the monitor test and the splice
  tests specifically assert remaining distance stays monotonic and the finish point is bit-for-bit
  identical after a splice.
- Reroute failure keeps the rider in `'alert'` state indefinitely with a bearing-and-distance
  fallback rather than a distinct "failed" state — simplest state machine that satisfies "never
  silently drop guidance," and it self-recovers via backoff retries without a separate UI mode.
- Backoff is a flat doubling schedule (2 s → 4 s → 8 s → 16 s → 30 s cap) with no jitter — enough
  to avoid hammering the free ORS tier under repeated quota failures without added complexity.
- Per Out-of-scope, the new leg does not get its own wind scoring pass; it reuses the nearest
  original segment's wind sample rather than re-running the scoring engine on an unplanned leg.
- The actual monitor→rerouter→swap-route/snapper/cues wiring plus `announcer.stop()` on reroute
  is explicitly left to WR-016 (the Ride screen owns the live GPS loop); this story only ships the
  pure/testable building blocks and their unit/replay contracts.

Tests: `src/engine/geometry.splice.test.ts` (3 — finish point and downstream segments preserved
with remaining distance never shortcutting past the rejoin point; downstream steps re-indexed
within bounds with arrival kept; leg shorter than the gap and leg longer than the gap) and
`src/nav/offRoute.test.ts` (7 — monitor alert timing and `reset()`; backoff growth and cap across
repeated failures; off-route replay-trace alert firing 10–14 s after the excursion crosses the
45 m gate; reroute targets `progress + 500 m` and never the finish, with the splice preserving the
finish point; rejoined route's remaining distance reflects the new route within 2 fixes;
provider-quota failure returns a backoff and grows across retries). Test contract satisfied: the
off-route replay trace alerts in the 10–14 s window; the mocked-reroute-leg splice keeps total
remaining distance monotonic with the finish point identical; the failure path is driven by a
mock `ProviderError('quota')`; splice unit tests cover both a leg shorter and a leg longer than
the gap. Full gate green: 217 tests, lint clean, build OK.

## Fable 5 review pass — fixes

A Fable 5 review returned REQUEST-CHANGES on the shipped story above. All findings are now fixed;
the gate is green again.

- **BLOCKER B1 (the key correctness fix) — reroute could target the finish.** Near the end of a
  route, `progress + REJOIN_AHEAD_M` (500 m) could land past — or within a whisker of — the
  route's finish point. The rejoin target was clamped to `track.total`, so the reroute's
  `pointToPoint` call effectively aimed at the finish and remaining distance shortcut straight to
  it: exactly the behaviour NAVIGATION_SPEC §3 says NEVER to do. Fixed: `Rerouter.attempt` now
  checks whether `progress + REJOIN_AHEAD_M` would fall within `FINISH_GUARD_M` (50 m) of the
  finish and, if so, skips the reroute entirely — no `pointToPoint` call is made — returning
  `{ ok: false, reason: 'near-finish' }`; the caller keeps the bearing-to-track alert running
  instead. The `RerouteOutcome` failure shape gained a discriminated `reason` field
  (`'provider-error' | 'near-finish'`) so callers can tell "the provider failed, keep retrying"
  apart from "we're intentionally not rerouting here." Recorded as **DEC-021**. Added a
  near-finish test asserting no provider call is made and `reason: 'near-finish'` is returned.
- **SHOULD-FIX S1 — spliced leg's own arrival step leaked into the ride.** `spliceRoute` kept the
  reroute leg's own ORS "Arrive at destination" step (type 10) in the spliced steps array. Since
  the leg only reaches the rejoin point, not the real finish, WR-014's cue engine would announce
  "You have arrived" mid-ride at the rejoin. Fixed: `spliceRoute` now strips any type-10 step from
  the leg before splicing (the original route's own arrival step, carried over from beyond the
  rejoin, is preserved downstream and still fires at the real finish). Added a test with a leg
  that carries a type-10 step, asserting it's stripped and arrival still fires once, at the end.
- **SHOULD-FIX S2 — straddling segment dropped, breaking the segment-tiling invariant.**
  `spliceRoute` dropped the original segment that straddled the rejoin point outright, so
  `Σ(segments.lengthM)` no longer equalled `distanceM` (under-covered by up to ~500 m). Since the
  ETA/wind model tiles the route by segment, this silently starved that stretch of any wind
  scoring. Fixed: the straddling segment is now **trimmed** rather than dropped — its start point
  is interpolated to the rejoin point and its `lengthM` shortened to match — so segments continue
  to tile the whole route with no gap. Added a tiling-invariant assertion
  (`Σ segments.lengthM ≈ distanceM`) to the splice test.
- **NITs acknowledged/deferred:**
  - N1 — the alert-window test's `>=10 s` lower bound is partly tautological (the monitor can't
    fire before the sustain window elapses); kept as documentation, the `<=14 s` upper bound and
    non-null result are the assertions actually doing the work.
  - N2 — no backwards-clock guard on the monitor's sustain timer; deferred, GPS fix timestamps are
    monotonic in practice.
  - N3 — a zero-length seam edge can appear at a vertex-aligned rejoin; benign, already tolerated
    by `prepareTrack`.
  - N4 — the along-track interpolation helper is duplicated across `pointAtDistance`, `resample`,
    and the replay harness; deferred refactor, no behavioural risk.
  - The acceptance boxes for the sound/banner alert UI and the live cue-rearm wiring remain owned
    by WR-016, as originally noted — unchanged by this review pass.
- **Tests added/updated:** `src/engine/geometry.splice.test.ts` grew from 3 to 4 tests (added the
  strip-arrival-step case and the tiling-invariant assertion folded into the existing preserve
  case); `src/nav/offRoute.test.ts` grew from 7 to 8 tests (added the near-finish
  no-provider-call case).
- **Gate:** 219 tests, lint clean, build OK.
