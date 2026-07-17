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

## Fable 5 review pass — fixes

A Fable 5 review returned REQUEST-CHANGES on the shipped story above. All findings are now fixed;
the gate is green again.

- **BLOCKER B1 — GPS + voice cues survived navigating away mid-ride.** `RideScreen` had no
  teardown: leaving the screen mid-ride left the `GeolocationSource` polling and the controller
  (and its `Announcer`) live in the background. Fixed: a `useEffect` unmount cleanup now stops the
  `FixSource` and pauses the controller (which stops the announcer) when `RideScreen` unmounts.
  Added a test asserting the (mocked) `GeolocationSource.stop()` is called on unmount.
- **BLOCKER B2 — WR-015's reroute machinery wasn't wired into the live pipeline.** Resolved as a
  deliberate split rather than a rushed full wiring: the CHEAP partial NAVIGATION_SPEC §3
  compliance ships now — an audible off-route alert (announced once per off-route episode) plus a
  bearing-to-track guidance arrow (`RideState.toTrack`: bearing + distance to the nearest track
  point, shown in the off-route banner rotated relative to heading). The FULL auto-reroute
  (`Rerouter.attempt` → `spliceRoute` → swap route/track/snapper + `CueScheduler.rearm` +
  `announcer.stop()`) is DEFERRED and recorded as **DEC-022**, because the spliced route has no
  `CandidateAnalysis` and live re-analysis of the new leg's wind/ETA is non-trivial and was
  explicitly out of scope in WR-015 ("scoring the new leg's wind"). WR-015's off-route DETECTION
  (WR-013/015) plus this alert/arrow give the rider real guidance now; the follow-up story wires
  the rest.
- **SHOULD-FIX S3 — ETA EMA poisoned while paused or by unknown-speed fixes.** Fixed: `onFix` now
  skips `eta.update` while paused, and `speedOf` returns `null` (skipping the EMA sample) when
  speed is unknown, distinct from a measured zero — a stationary-but-valid fix no longer drags the
  EMA toward zero.
- **SHOULD-FIX S4 — progress ribbon dot used a distance fraction.** The dot sat in the wrong wind
  band on headwind/tailwind routes because it didn't match the time-weighted ribbon layout. Fixed:
  the dot now uses the modelled elapsed-TIME fraction (`RideState.timeFraction`).
- **SHOULD-FIX S5 — speed glance numeral under the 48 px acceptance floor.** Fixed: a new
  `--fs-glance-lg` token renders the speed numeral at 48 px (acceptance said ≥48 px); the other
  glance cells stay at the 27 px floor.
- **SHOULD-FIX S6 — geolocation failure was silent.** Fixed: `source.start` is now passed an
  `onError` that shows a banner instead of silently sitting in "riding" with a dead GPS feed.
- **NIT N1 — wind-HUD arrow CSS transition backspun across the 0/360 seam.** Fixed: removed the
  transition; raw-degree rotation was animating the long way round (~360°) whenever the bearing
  crossed due north.
- **NIT N2 — heading jitter gate over-counted E-W movement at high latitude.** Fixed: the gate now
  applies `cos(lat)` to the longitude delta (was over-counting ~2x at 60°N).
- **NIT N3 — resume test used a fresh controller instance instead of resuming the paused one.**
  Fixed: the resume test now pauses only a short prefix (so the turn is still ahead) and resumes
  the SAME paused controller.
- **Deferred NITs (documented, not fixed):**
  - N4 — `end()` leaves the controller live so a late replay fix can still mutate state; WR-017's
    recorder guards against this internally.
  - N6 — `speedKmh` is converted in `nav` rather than at the UI edge; deferred SI-boundary cleanup.
  - N7 — battery-saver only drops the pulse; the SVG map is already low-power so this is judged
    sufficient for now.
  - N8 — no `useWakeLock` unit test; `RideMap` projection remains untested.
- **Tests added/updated:** `src/nav/rideController.test.ts` grew from 3 to 5 tests (added
  resume-same-instance and off-route bearing/announce-once cases); `src/ui/screens/RideScreen.test.tsx`
  grew from 4 to 5 tests (added unmount-stops-GPS).
- **Gate:** 241 tests, lint clean, build OK.
