# WR-055 · Live map zoom policy: honest look-ahead + junction approach
Epic: 2 · Navigator | Status: DONE | Depends on: WR-054 | Size: M

## Goal
Owner-reported (2026-08-02), the second half of the junction complaint: *"it should zoom, clearly show
the other options and the one we should follow."*

Planned as "add a junction zoom". The measured cause turned out to be one line nobody had ever put a
number to — `autoZoomM = 250 + speedKmh * 40`. At 25 km/h that is 1250 m across a ~390 px screen,
which with the rider 72 % down the visible band is **1190 m — 171 seconds — of road ahead**, against a
25–40 s navigation convention. That single coefficient, not a missing feature, is why a 20 m junction
rendered as ~6 px.

## Context (read first)
NAVIGATION_SPEC §9 (map orientation + zoom policy) · DEC-063 (this story) · DEC-061 (the camera this
builds on) · `nav/cues.ts` for why the approach must not reuse the speed-scaled cue triggers.

## Acceptance criteria
- [x] Cruise zoom holds a constant ~30 s of road ahead, clamped at both ends, and the whole zoom
      policy is one pure unit-tested module instead of an untested inline expression.
- [x] Approaching a real maneuver tightens further to ~140 m across, is already tight when the rider
      arrives (a plateau, not a point), and holds through the corner instead of popping out.
- [x] Suppressed wherever tightening would hurt: details sheet open, sustained off-route, two
      consecutive refused fixes, reroute preview, the first fixes after accepting a reroute, and
      before the rider has moved at all.
- [x] `+` / `−` step from what is on screen, so `+` can never zoom out.
- [x] The map does not slide under the rider marker at the tighter zoom.
- [x] A large zoom change gets the long ease, not just a large rotation.
- [x] `npm test && npm run lint && npm run build` green.

## Test contract
`cues.ts`: `proximityToManeuverM` — null with no steps; nearest node ahead; pinned to 0 through the
grace window past a node then released; a node well behind is NOT near; arrival and "continue
straight" skipped while forks (12/13) and turnarounds (9) count; nearest of two straddling nodes.
`mapCamera.ts`: `cruiseZoomM` holds ~`ZOOM_LOOKAHEAD_S` at 25/40/60 km/h, errs toward MORE context
below the floor speed, clamps both ends, and is >4× tighter than the rule it replaces (which the test
also records as ~171 s, so the bug cannot quietly return); `turnApproachZoomM` cruise/plateau/
monotone ramp/never-wider-than-cruise; `cameraTargetFor` escalates the ease on a large zoom delta with
no rotation. Controller: `turnProximityM` tightens toward the out-and-back fold, pins to 0 through it,
is null at the finish (arrival excluded) and null on a step-less route.

## Out of scope
WR-056 (glyph + wording), WR-057 (on-map junction highlight), WR-058 (cues for step-less routes) ·
re-arming `manualZoomM` automatically after a timeout · pitching the camera.

## Log
Shipped:
- `src/nav/cues.ts` — `proximityToManeuverM(cues, progressM, graceM)` + `MANEUVER_GRACE_M`. Pure and
  tested here rather than through the controller.
- `src/nav/rideController.ts` — `RideState.turnProximityM`.
- `src/ui/mapCamera.ts` — `cruiseZoomM(speedKmh)` and `turnApproachZoomM(proximityM, cruiseM)`; the
  ease duration now also keys off the zoom delta; `CameraInput.rider` became `anchor`.
- `src/ui/components/RideMap.tsx` — camera follows `rider.anchor`, marker still on `rider.position`;
  camera effect keyed on the anchor.
- `src/ui/screens/RideScreen.tsx` — the policy wiring, the suppression predicate, `anchor` selection,
  and the zoom-button reseed.

Decisions (DEC-063): cruise is a look-ahead-TIME policy; the junction override is a function of
DISTANCE ONLY; maneuver proximity is asymmetric; the camera anchors on the snapped point on-track.

A blind red-team of the original design changed it substantially, and three of its findings were
things this story would otherwise have shipped as bugs:
1. **The premise was wrong.** The junction override is the *smaller* half — fixing the cruise
   coefficient alone takes the junction from 6 px to ~36 px; the override then takes it to ~56 px. The
   original plan built a ramp, a plateau, a quantizer and a puck lerp to cross a 3.2-zoom-level gap
   that should never have been 3.2 levels wide.
2. **`+` would have zoomed OUT 5.6×.** `zoomIn` seeded from `autoZoomM`, not from the applied zoom, so
   mid-approach (140 m across) one tap would have jumped to 781 m — and since `manualZoomM` never
   re-arms, junction zoom would then have been dead for the rest of the ride.
3. **A symmetric `min |turnDistanceM − progressM|` pins the camera on urban routes.** It keeps the
   view tight for 200 m *after* every node too, so with maneuvers under 400 m apart the ramp never
   returns to cruise — the fix for "too zoomed out at junctions" would have become "permanently
   zoomed in, no look-ahead" on exactly the routes with the most junctions. Hence the asymmetric
   window and the maneuver filter.

Cut as verified scope creep: a `tightness` value lerping the puck from 0.72 to 0.55 "so the junction
ahead is framed" — the junction is never under the turn card at 140 m across, moving the puck up would
*remove* ~30 m of look-ahead, and `offset` is gated on heading-up so it does nothing at all in
north-up. Also cut a 25 m zoom quantizer: the ramp moves ~48 m of `zoomM` per fix at 25 km/h, so it
would have suppressed zero changes at the speed that motivated the feature. The ease-duration
heuristic covers that concern instead.

Also found while implementing: the `ZOOM_MIN_ACROSS_M` floor incidentally kills a pre-existing churn
source. The old formula was linear in `speedKmh`, and `speedOf` falls back to `haversine/dt`, so
standing GPS wander moved the requested zoom ±20 m every fix; the floor now pins everything below
~23 km/h to one value.

Follow-ups:
- No automatic re-arm for `manualZoomM`, and `Auto` only renders while following — a rider who taps
  `+` then pans must Recenter to find `Auto`. Worth a timeout re-arm (the Maps behaviour).
- The live-ride insets are still constants mirroring `components.css`; measuring the real chrome would
  remove the drift risk (also noted in WR-053).
- The only ORS fixture has 2 steps / 1 real turn over 2 km, so junction *density* — the case that
  motivated the asymmetric window — cannot be dogfooded through the replay harness. A denser real
  fixture would let `npm run replay` cover it.
