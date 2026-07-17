# WR-016 · Ride screen — glance zone, wind HUD, wake lock
Epic: 2 · Navigator | Status: DONE | Depends on: WR-014, WR-015 | Size: L

## Goal
The saddle UI: huge honest numbers, the next-turn card, and WindRide's signature promise —
"Tailwind in 2.3 km" — readable at 27 km/h in sunlight.

## Context (read first)
DESIGN.md (tokens, glance rules) · NAVIGATION_SPEC §5,7 · PRODUCT_SPEC §5.

## Acceptance criteria
- [x] Layout: map (route ahead wind-coloured, chevron with pulse), turn card, wind HUD
      (arrow relative to heading + next transition text from scored segments), glance zone:
      speed (≥48 px), wind-aware ETA, remaining km, progress WindRibbon with position dot.
- [x] ETA uses the EMA correction from NAVIGATION_SPEC §5 (unit-tested helper).
- [x] Wake lock held during ride, re-acquired on visibilitychange; battery-saver toggle
      (static map, audio-first).
- [x] Start/pause/end flow wired to recorder (WR-017 interface stub if it lands later).
- [x] Fully drivable by replay dev panel end-to-end.

## Test contract
`nextWindTransition(segments, progressM)` unit tests (boundaries, no-transition case).
EMA ETA tests (riding faster than model ⇒ ETA shrinks). Interaction: pause stops cue firing.

## Technical notes
Heading from fix deltas (smoothed), not compass, at cycling speeds. Reduced-motion kills the
pulse. Keep the screen chrome-free: no tab bar during a ride.

## Out of scope
Ride summary screen (small addition in WR-017); feels-like chart (WR-022).

## Log

- Shipped the saddle UI end to end: `RideController` (`src/nav/rideController.ts`) is the
  UI-agnostic live pipeline — `onFix(fix)` runs the WR-013 Snapper, WR-014 CueScheduler +
  Announcer, and WR-015 OffRouteMonitor, plus the new `EtaEstimator` and `HeadingSmoother`,
  and returns a single `RideState` snapshot. Same code path drives both live GPS and the
  dev replay panel, satisfying "fully drivable by replay end-to-end" without a parallel
  implementation to keep in sync.
- `classifyWindKind` + `WindKind` moved to `src/engine/wind.ts` as the single source of
  truth (tail ≤60°, head ≥120°, cross between); `src/ui/routeGeo.ts` now re-exports it so
  WR-009 importers are unaffected. Lets `src/nav/windHud.ts` share the exact same
  classification the UI already uses for route colouring.
- ETA per NAVIGATION_SPEC §5: `EtaEstimator` (`src/nav/eta.ts`) keeps an EMA (alpha 0.1) of
  actualSpeed/modelledSpeed and corrects `remainingModelledS / ratio` — riding faster than
  the model shrinks the ETA. Starts at ratio 1 (trusts the model until data arrives) and
  ignores non-positive modelled speed. Unit-tested per the test contract.
- `nextWindTransition` (`src/nav/windHud.ts`) reports the next change in wind relationship
  ahead ("Tailwind in 2.3 km") or `null` if it doesn't change before the finish; boundary
  and no-transition cases unit-tested per the test contract.
- `RideMap` (`src/ui/components/RideMap.tsx`) is SVG, not WebGL/MapLibre — chosen for
  glanceability, low power draw, and testability at this stage. A full basemap layered
  underneath is noted as a follow-up rather than in scope here. Route ahead is wind-coloured
  via the existing `routeToWindGeoJSON`; the rider chevron is heading-oriented and pulses,
  with battery-saver and reduced-motion both dropping the pulse.
- `useWakeLock` (`src/ui/useWakeLock.ts`) holds the Screen Wake Lock while riding and
  re-acquires it on `visibilitychange` (NAVIGATION_SPEC §7), no-op where the API is
  unavailable.
- Recorder wired via the `RideRecorder` interface + `nullRecorder` stub (`src/nav/recorder.ts`)
  so `RideScreen` can call start/addFix/pause/resume/finish now; WR-017 supplies the
  crash-safe idb implementation behind the same interface.
- `RideScreen` (`src/ui/screens/RideScreen.tsx`) is chrome-free and full-screen at `#/ride`
  (no tab bar), with `RideMap` + off-route banner, next-turn card, `WindHud` (arrow relative
  to heading + next-transition line), and a glance zone (speed / wind-aware ETA / km left as
  big StatCells) plus a progress WindRibbon with a position dot. Cue mode is segmented
  (voice/beep/silent); `armAudio()` unlocks audio on the Start-ride tap. Drivable end-to-end
  via `DevReplayPanel`'s new `onFix` prop (DEV-gated lazy import). Added `#/ride` to the hash
  router and a "Ride this route →" link on `ResultsScreen`.
- Technical note honoured: heading comes from fix-to-fix bearings via a circular EMA in
  `HeadingSmoother` (`src/nav/heading.ts`), not the magnetometer, ignoring near-stationary
  fixes (<2 m) whose bearing would be jitter.
- Tests: `src/nav/eta.test.ts` (5), `src/nav/windHud.test.ts` (7, incl. boundary and
  no-transition cases), `src/nav/rideController.test.ts` (3: live state, cues fire while
  riding, pause stops cue firing), `src/ui/screens/RideScreen.test.tsx` (4: empty state,
  glance/start render, start→pause→resume flow, battery-saver toggle). 238 tests total,
  lint clean, build OK.
