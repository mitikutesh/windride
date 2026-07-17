# WR-017 · Recorder — crash-safe rides, pause, GPX out
Epic: 2 · Navigator | Status: TODO | Depends on: WR-013 | Size: M

## Goal
Never lose a ride: fixes stream into idb as they happen, auto-pause detects stops, finishing
produces a GPX plus a summary with the ride's wind story.

## Context (read first)
NAVIGATION_SPEC §6 · ARCHITECTURE §6 · WR-010's GPX writer.

## Acceptance criteria
- [ ] Fixes appended to idb `rides` in batches of 10 (flush also on pause/visibility change);
      app kill + reopen ⇒ resume-or-save prompt with all points intact.
- [ ] Auto-pause per spec (<1.2 km/h >20 s) and resume; moving time vs elapsed tracked.
- [ ] Finish: GPX via the shared writer; summary computed (distance, moving time, avg speed,
      % time by wind kind from planned segments, "headwind avoided vs median candidate" if
      the plan session data exists).
- [ ] Ride history list (date, name, stats) with delete + GPX re-export.

## Test contract
Replay a full trace ⇒ recorded distance within 1% of trace length; kill-restore test (idb
survives simulated reload mid-ride); pause detection on the stop-and-go synthetic trace.

## Technical notes
Store planned-route linkage (routeId) on the ride — WR-024 calibration and WR-028 novelty
both need it. Summary wind stats come from planned segments matched by progress, good enough.

## Out of scope
Strava upload (WR-023); calibration math (WR-024).

## Log
