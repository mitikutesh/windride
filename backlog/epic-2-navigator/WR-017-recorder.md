# WR-017 · Recorder — crash-safe rides, pause, GPX out
Epic: 2 · Navigator | Status: DONE | Depends on: WR-013 | Size: M

## Goal
Never lose a ride: fixes stream into idb as they happen, auto-pause detects stops, finishing
produces a GPX plus a summary with the ride's wind story.

## Context (read first)
NAVIGATION_SPEC §6 · ARCHITECTURE §6 · WR-010's GPX writer.

## Acceptance criteria
- [x] Fixes appended to idb `rides` in batches of 10 (flush also on pause/visibility change);
      app kill + reopen ⇒ resume-or-save prompt with all points intact.
- [x] Auto-pause per spec (<1.2 km/h >20 s) and resume; moving time vs elapsed tracked.
- [x] Finish: GPX via the shared writer; summary computed (distance, moving time, avg speed,
      % time by wind kind from planned segments, "headwind avoided vs median candidate" if
      the plan session data exists).
- [x] Ride history list (date, name, stats) with delete + GPX re-export.

## Test contract
Replay a full trace ⇒ recorded distance within 1% of trace length; kill-restore test (idb
survives simulated reload mid-ride); pause detection on the stop-and-go synthetic trace.

## Technical notes
Store planned-route linkage (routeId) on the ride — WR-024 calibration and WR-028 novelty
both need it. Summary wind stats come from planned segments matched by progress, good enough.

## Out of scope
Strava upload (WR-023); calibration math (WR-024).

## Log
- **Shipped:** `RideSummary` domain type (`src/domain.ts`) — distanceM, elapsedS, movingS,
  avgSpeedMs, optional `windByKindS` {tail,cross,head} and `headwindAvoidedKm`. `src/data/db.ts`
  bumped the `windride` idb to v2, adding `rides` (keyPath `id`) and `ridePoints` (keyPath
  `[rideId,seq]`, `byRide` index) stores plus ops: createRide, appendRidePoints, updateRide,
  getRecordingRide, listRides, getRidePoints, deleteRide. `src/nav/rideSummary.ts` (pure):
  `summarizeRide` (haversine distance, moving vs elapsed via the ≥1.2 km/h `MOVING_SPEED_MS`
  threshold, avg speed over moving time, wind-by-kind bucketing + headwind-avoided when a plan
  analysis is linked) and `autoPaused` (trailing sub-threshold stretch > `AUTO_PAUSE_S` = 20 s).
  `src/nav/recorder.ts` replaces the WR-016 stub with `IdbRideRecorder` (start/addFix/pause/
  resume/flush/finish), plus `loadRidePoints` and `saveUnfinishedRide`. `src/state/ridesStore.ts`
  (zustand) and `src/ui/components/RideHistory.tsx` (list + delete + GPX re-export). `RideScreen`
  wired to the real recorder with a visibility-flush listener, unmount flush, resume-or-save
  prompt on open, and GPX download + history refresh on finish.
- **Key decisions:**
  - A separate `ridePoints` store keyed `[rideId, seq]` (not an array field on the ride record)
    gives true incremental append — no O(n) rewrite of prior points on every batch.
  - Writes go through a serialized chain (`createRide` → `appendRidePoints` → `updateRide`) so
    ordering is guaranteed and a failure is recorded on `lastError` rather than silently
    swallowed or left as an unhandled rejection.
  - Flush batch size is 10, with additional flush triggers on pause, `visibilitychange`, and
    finish, so backgrounding or app-switch doesn't strand fixes in memory.
  - `summarizeRide` stays pure and reuses the WR-013 `Snapper` to bucket moving intervals onto
    planned segments for `windByKindS`, rather than inventing a second matching path.
  - `routeId` is stored on the ride record now so WR-024 (calibration) and WR-028 (novelty) have
    the plan linkage they need without a later migration.
  - GPX output reuses the shared WR-010 `toGpx` writer, not a second serializer.
  - The resume-or-save prompt is driven by `getRecordingRide` (the one unfinished ride) rather
    than inferring "was recording" from UI state, so a cold reload after an OS kill still finds
    it.
  - **Honest caveat:** a hard crash can still lose the in-flight buffer of up to 9 fixes not yet
    at the batch-10 threshold; the `visibilitychange` flush mitigates the common case (app
    backgrounded before being killed) but a true instant kill (e.g. OOM without a visibility
    transition) can still drop that tail.
- **Tests:** `src/nav/rideSummary.test.ts` (5: distance within 1% of trace, moving vs elapsed,
  wind-by-kind buckets + headwindAvoided, autoPaused detect + not-while-moving),
  `src/nav/recorder.test.ts` (4, under fake-indexeddb: full-trace GPX within 1% + finished
  summary, batches of 10, simulated app-kill crash-safe resume with all points intact,
  saveUnfinishedRide finalises without resuming), and the WR-010 db migration smoke test updated
  to v2 (routes data survives; rides + ridePoints stores added).
- **Test contract satisfied:** recorded distance within 1% of trace length; kill-restore (idb
  survives a simulated reload mid-ride via a fresh handle); pause detection on the stop-and-go
  synthetic trace.
- **Gate:** 250 tests, lint clean, build OK.
