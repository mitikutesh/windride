# WR-051 · Confirm-first reroute, true-position rider marker, fresh plan start
Epic: 2 · Navigator | Status: DONE | Depends on: WR-015, WR-016 | Size: M

## Goal
Owner-reported (2026-07-28): three riding-day failures. (1) Rerouting "doesn't work" when
leaving the route — it must ASK before rerouting, PREVIEW the proposed route, apply only on an
explicit Accept, and always aim back at the ORIGINAL route. (2) The rider marker sticks to the
route line even when the rider is beside it — it must show the true GPS position. (3) A new plan
keeps yesterday's persisted start point — every new plan must fetch the CURRENT location.

## Context (read first)
NAVIGATION_SPEC §3 (updated by this story) · DEC-021/DEC-022 (building blocks + old auto-apply)
· DEC-054 (this story's decisions).

## Acceptance criteria
- [x] Sustained off-route (WR-015 monitor) opens a "Reroute?" offer; NO router call happens
      before the rider confirms. Declining silences the offer for that off-route episode and
      re-arms once back on the route.
- [x] On confirm: one pointToPoint leg to the original track at progress+500 m (WR-015 splice —
      downstream preserved, never the finish), re-analysed for wind/ETA, shown as a DASHED
      preview on the map with Accept / Keep current.
- [x] Only Accept swaps the route into the controller AND into everything rendered (map line,
      gust markers, ribbon) — an accepted reroute is visible, not silent.
- [x] Failure paths: near-finish → non-retryable message; provider failure → manual Retry; a
      rider who rejoins mid-fetch gets no stale dialog. Bearing-to-track arrow stays throughout.
- [x] Rider marker + follow camera use the RAW fix (`RideState.position`), never the snapped
      point; progress/cues/ETA still use the snap.
- [x] Plan screen open and every `generate()` refresh geolocation unless the start was hand-set
      ('manual'); locate failure falls back to the stored start; "Use my location" returns a
      manual start to geo tracking.

## Test contract
Nav: proposeReroute returns a proposal without touching the controller; near-finish/failure/
skipped paths. Controller: `position` equals the raw fix and differs from `snapped` off-route.
UI (light): off-route → offer with zero fetches; confirm → one fetch + preview; Accept closes;
decline → no re-offer, zero fetches. State: locate() marks geo; setInput(start) marks manual;
generate() re-locates for geo/default and never for manual.

## Out of scope
Auto-reroute setting (the old DEC-022 silent path); re-fetching live wind for the detour leg
(still reconstructed ~uniform from the plan analysis); moving-preview drift correction.

## Log
Shipped:
- `src/nav/rideController.ts` — `RideState.position` (raw fix) alongside `snapped`.
- `src/nav/reroute.ts` — `attemptReroute` (auto-apply) replaced by `proposeReroute` →
  `{ proposal: { analysis, rejoinAtM } }`; apply happens only via `applyReroute` on Accept.
- `src/ui/screens/RideScreen.tsx` — reroute phase machine (idle/offer/loading/preview/error),
  per-episode decline, stale-result guards (`offRouteRef`), `liveAnalysis` so the map/ribbon
  render the spliced route after Accept, marker fed the raw fix, dialog overlay + CSS.
- `src/ui/components/RideMap.tsx` — accepts `RouteGeoInput` (plan or live analysis), new dashed
  `wr-preview` layer for the proposal; `src/ui/routeGeo.ts` widened to `RouteGeoInput`.
- `src/state/planStore.ts` — `startSource` ('default'/'geo'/'manual'), locate() options
  (timeout/maximumAge), generate() re-locates non-manual starts; persisted with inputs (pre-story
  stores hydrate as 'default' → refreshed on next visit). `src/ui/screens/PlanScreen.tsx` —
  mount-locate now keyed on startSource (not "still at default"), + "Use my location" button.

Decisions: DEC-054 (confirm-first replaces DEC-022 auto-apply; raw-fix marker; fresh plan
start). DEC-053 retired (reverted custom-domain work) to keep IDs unambiguous.

Discovered for later: the reroute preview is fetched from the confirm-time position — a fast
rider may drift ~100 m before accepting; the reroute snapper's windowed acquire absorbs this,
but a "refresh proposal" affordance could help on long decisions. Ribbon/dot after a reroute
re-baselines to the spliced route's timeline (whole-ride fraction, not plan fraction).
`end()` still feeds calibration (WR-024) the ORIGINAL plan analysis even when the ride was
rerouted — rerouted rides pair GPS points against segments the rider didn't ride (pre-existing,
now a real flow); consider excluding rerouted rides from calibration or snapshotting the live
analysis.

Tests: +1 nav (position truth), reroute tests rewritten for proposeReroute (4), +2 UI flow
(ask→preview→accept; decline), +5 planStore location tests. Full gate green: 647 tests, lint
clean, build OK.

## Fable 5 review pass — fixes

An independent Fable 5 review of commit 3dad49e returned 2 SHOULD-FIX + 4 NITs; all addressed:

- **S1 — in-flight fetch outlived the ride/episode.** `offRouteRef` was only ever written by
  `handleFix`, so after End (GPS stopped) it stayed `'alert'` forever and a slow reroute fetch
  could re-open the preview on the ENDED screen; Accept would then mutate (and voice-announce
  through) the dead controller. Fixed: the confirm callback captures its controller and discards
  the result via `isStale()` (`controllerRef.current !== controller || offRouteRef.current !==
  'alert'`), and `start()`/`resumeUnfinished()`/`end()` reset `offRouteRef` to `'on-route'`.
  Regression test: deferred-fetch UI test "a rider who rejoins mid-fetch gets no stale dialog".
- **S2 — Accept while paused voiced a cue.** The offer intentionally works while paused (a
  stopped rider deciding is the normal case), but `applyReroute` unconditionally announced
  "New route", breaking the pause contract ("pausing stops cue output"). Fixed: `applyReroute`
  announces only when not paused; the swap itself still happens. Regression test added.
- **N3 — preview overpainted the whole route.** The dashed preview drew the entire spliced
  polyline to the finish; now `proposeReroute` returns `previewPolyline` — the detour LEG only,
  sliced at `spliced.distanceM − (track.total − rejoinAtM)` — so the dashed line shows exactly
  what changes and visibly meets the planned route. `rejoinAtM` is no longer unused. Test added.
- **N4 — misleading `maximumAge` comment** reworded (default 0 = always fresh; generate() opts
  into 60 s reuse).
- **N5 — "Use my location" failed silently**: `locate()` now resolves a boolean; the button
  shows "Couldn't get your location" on denial/timeout.
- **N6 — calibration-after-reroute mismatch** logged under Discovered for later (above).

Gate after review fixes: 650 tests, lint clean, build OK.
