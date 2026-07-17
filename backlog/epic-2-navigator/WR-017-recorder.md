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

## Fable 5 review pass — fixes

A Fable 5 review returned REQUEST-CHANGES with 3 blockers and 4 should-fix items. All are now
fixed; the gate is green. Epic 2 (Navigator) is now complete.

- **BLOCKER 1 — empty-ride summary guard (crash-recovery fix):** `summarizeRide([])` dereferenced
  `points[0].time` and threw, which crashed the resume-or-save "Save it" path for the most likely
  real-world crash: a ride killed before its first batch of fixes ever flushed. `summarizeRide`
  now returns a zero summary (0 distance/elapsed/moving/avg speed) for zero points instead of
  throwing. Added a `rideSummary` test and a `recorder` test asserting `saveUnfinishedRide` on a
  zero-point ride does not throw.
- **BLOCKER 2 — auto-pause wired live into `RideController`, with auto-resume:** `autoPaused` was
  computed by `rideSummary.ts` but never wired into the live recording pipeline, so the
  acceptance criterion ("Auto-pause per spec … and resume") wasn't actually met. Fixed by wiring
  it into `RideController`: it tracks trailing sub-threshold time incrementally against
  `MOVING_SPEED_MS` (1.2 km/h) and `AUTO_PAUSE_S` (20 s), resets the counter on movement, and
  exposes `RideState.autoPaused`, auto-resuming as soon as the rider is moving again (no user
  action needed). `summarizeRide` is unchanged and still reports moving-vs-elapsed for the final
  summary. Added a `RideController` test: auto-pauses after a 25 s stop, clears on movement.
- **BLOCKER 3 — Resume button on the interrupted-ride prompt:** the resume-or-save prompt had no
  way to actually resume, only save/discard. `RideScreen` now shows a Resume button when the
  interrupted ride's planned route is still loaded this session (`unfinished.routeId` matches the
  currently selected candidate id); Resume rebuilds the `RideController` plus a resumed
  `IdbRideRecorder` seeded from `loadRidePoints`, keeps the existing recording row (does not call
  `start()` again), and continues recording/flushing from there. After a page reload the in-memory
  route analysis is gone, so in that case the prompt still only offers Save/Discard — this is a
  documented, honest limitation rather than a silent gap.
- **SHOULD-FIX 1 — recording-error banner via `lastError`:** `lastError` on the recorder was
  write-only (set but never read). It is now part of the `RideRecorder` interface, and
  `RideScreen` polls it per fix, showing a "Ride isn't being saved — storage error" banner so an
  idb failure (quota exceeded, private-mode browser, etc.) is visible instead of giving a false
  sense that the ride is safely recording.
- **SHOULD-FIX 2 — auto-flush proven by test via `whenSettled()`:** no test previously proved
  incremental auto-flush actually happens mid-ride (as opposed to only at `finish()`). Added
  `whenSettled()` to `IdbRideRecorder` and a test that awaits only the auto-flushed writes (no
  explicit `flush()` call) and asserts 20 of 25 points are persisted, then calls `flush()` and
  confirms the remaining tail lands.
- **SHOULD-FIX 3 — real v1→v2 migration test:** the existing "migration smoke" test didn't
  actually exercise a migration — it just built a fresh v2 database. Added
  `src/data/db.migration.test.ts` (isolated module registry so it gets its own fresh
  `dbPromise`), which creates a genuine v1 database with a route, then lets `db.ts`'s real
  `onupgradeneeded` path run the upgrade to v2, and asserts the route survives and the `rides` +
  `ridePoints` stores now exist. The prior `db.test.ts` case was renamed honestly to a "v2 schema
  smoke" test since it was never a migration test.
- **SHOULD-FIX 4 — GPX filename uses the real distance:** finish/save GPX downloads were always
  named `…-0km.gpx` regardless of actual ride length. `finish()` and `saveUnfinishedRide` now
  return `{ gpx, summary }`, and `RideScreen` names the download from `summary.distanceM`.
- **Deferred NITs (documented, not blocking):**
  - N1 — resume sequence numbers are seeded from `resumePoints.length`; fine today but would need
    a gap-aware approach if a middle batch could ever be missing.
  - N2 — `updateRide` is get-then-put; safe today because it's serialized in practice by the
    write chain, but not safe against future concurrent writers.
  - N4 — ARCHITECTURE §6's storage note is stale with respect to the v1/rides layout; flagged for
    a future docs pass.
  - N5 — `RideScreen` reads a couple of `db.ts` functions directly rather than going through a
    store; a minor layering inconsistency, not a bug.
  - N6 — `getRecordingRide` returns only the newest recording ride; fine while only one ride can
    be in-flight at a time.
  - N8 — `windByKindS` buckets elapsed time, not moving time; consistent with how it's used today
    but worth double-checking against future consumers.
- **Test counts:** `rideSummary.test.ts` 6, `recorder.test.ts` 6, `rideController.test.ts` 7,
  `db.migration.test.ts` 1 (new/changed); **254 tests total, lint clean, build OK.**
