# WR-015 · Off-route detection + rejoin-track reroute
Epic: 2 · Navigator | Status: TODO | Depends on: WR-013 | Size: M

## Goal
The detail most nav apps get wrong: when the rider leaves the track, guide them back to the
CHOSEN route ~500 m downstream — never reroute to the finish.

## Context (read first)
NAVIGATION_SPEC §3 (authoritative) · API_NOTES §2 (pointToPoint, budget).

## Acceptance criteria
- [ ] Trigger: perpendicular >45 m sustained >10 s ⇒ alert (sound + banner).
- [ ] Reroute: one RouteProvider.pointToPoint(current, trackPointAt(progress+500 m)); splice
      leg into route; downstream geometry, steps and scored segments preserved; cues re-armed.
- [ ] Reroute failure (quota/offline): stay in alert state with bearing-and-distance-to-track
      arrow; retry with backoff; never silently drop guidance.
- [ ] Rejoined ride's remaining ETA updates within 2 fixes.

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
