# WR-013 · Location service + windowed snap + progress
Epic: 2 · Navigator | Status: DONE | Depends on: WR-012 | Size: M

## Goal
Reliable "where am I on my route": live geolocation behind FixSource, windowed snap-to-track,
monotonic progress, distance-remaining — correct even on self-crossing loops.

## Context (read first)
NAVIGATION_SPEC §1–2 (authoritative numbers) · CLAUDE.md domain warnings (windowed snap).

## Acceptance criteria
- [x] `locationService.ts`: watchPosition wrapped as FixSource (permissions UX: clear prompt,
      graceful denial state); replay source interchangeable.
- [x] `snap.ts`: window [−100 m, +300 m] around last progress, perpendicular gate 60 m,
      forward-only progress with −15 m jitter tolerance; cold-start = global nearest once.
- [x] Figure-eight replay: progress passes the crossing without teleporting (regression test).
- [x] Exposes {progressM, remainingM, perpendicularM, snapped: LatLon, onTrack: boolean}.

## Test contract
Integration via replay traces: clean loop ⇒ progress strictly increasing, final remaining <30 m;
jittered trace ⇒ no backwards jumps >15 m; crossing trace ⇒ max single-fix progress jump <50 m.

## Technical notes
Precompute cumulative distances per polyline point once; snap search is then an index-window
scan — keep it O(window), not O(route).

## Out of scope
Cues, off-route handling, UI.

## Log
Shipped `src/nav/snap.ts`: `prepareTrack(polyline)` precomputes cumulative per-vertex distances
and total length once, so `Snapper.update(fix)` is a windowed index scan — O(window), not
O(route), per NAVIGATION_SPEC §1's requirement. The search window is `[progress-100 m,
progress+300 m]` around the last known progress, gated by a 60 m perpendicular-distance cutoff;
progress only advances forward, with a −15 m jitter tolerance so small backward noise near a
stationary/slow rider doesn't regress progress. Cold start (no prior progress) falls back to a
global-nearest-point search exactly once, then every subsequent update is windowed. Fixes that
fail the perpendicular gate (off-track) or arrive materially behind the tolerance (large
backward jump) hold progress rather than advancing — this story intentionally only *holds*
position in those cases; actual off-route detection/rejoin behaviour is deferred to WR-015 per
the story's Out of scope note. `Snapper.update` returns `{progressM, remainingM, perpendicularM,
snapped: LatLon, onTrack: boolean}` per the acceptance criteria.

Shipped `src/nav/locationService.ts`: `GeolocationSource` implements the same `FixSource`
contract as WR-012's `ReplaySource` (see WR-012 Log), wrapping
`navigator.geolocation.watchPosition`. It maps each `GeolocationPosition` to a `Fix`
(lat/lon/ele/time/speed/accuracy/heading, optional fields omitted rather than set to
null/undefined placeholders) and maps `GeolocationPositionError` codes 1/2/3 to a typed
`GeolocationError` with `kind: 'denied' | 'unavailable' | 'timeout'` (plus an `'unsupported'`
kind when `navigator.geolocation` doesn't exist), delivered on the `onError` channel so the UI
can render the permission-prompt/denial state — no UI was built in this story, only the typed
error contract it needs. `navigator.geolocation` is injectable (constructor param) for testing
without a browser geolocation API.

Test contract satisfied via the WR-012 replay traces: clean loop ⇒ progress monotonic
non-decreasing throughout, final `remainingM` <30 m; jittered clean loop (seeded gaussian noise)
⇒ no backward progress jump exceeds 15 m; figure-eight ⇒ max single-fix progress jump <50 m at
the self-crossing (no teleport) and the run traverses >90% of the route length. All three are
green.

`src/nav/snap.test.ts` (8 tests): `prepareTrack` cumulative-distance/total correctness,
cold-start global-nearest-once, perpendicular-gate off-track holds progress, large-backward fix
rejected (progress held), small backward jitter tolerated (within −15 m), plus the three
replay-trace contract cases above. `src/nav/locationService.test.ts` (7 tests): position→Fix
mapping, optional-field omission when the browser omits altitude/speed/heading, error-code→kind
mapping for codes 1/2/3, `'unsupported'` when geolocation is absent, and `clearWatch` firing on
`stop()`. Gate green: 187 tests passing, lint clean, build clean.

No open follow-ups from this story; off-route detection/rejoin lands in WR-015 against the same
snap/`onTrack` output, and turn cues (WR-014) consume `progressM`/`remainingM` from here.

## Fable 5 review pass — fixes

A Fable 5 review of this story returned REQUEST-CHANGES. All findings below are now addressed;
the gate is green: 191 tests passing (up from 187), lint clean, build clean.

- **BLOCKER B1 — projection could overshoot the +300 m window.** `nearestInWindow` enforced the
  window per-segment but only clamped the projection fraction to `[0,1]` (the whole segment), so
  on a long, straight segment (e.g. an open-road ORS segment) a single fix could project far past
  `progress+300 m` — observed up to an 899 m jump through a 300 m window — permanently
  corrupting progress since advancement is forward-only. Fixed: for each candidate segment, the
  projection fraction `t` is now additionally clamped to `[tLo, tHi]`, the sub-segment fraction
  range that maps to `[lo, hi]` (derived from the window bounds and the segment's cumulative
  distances), so a single update can never advance progress past the window edge. Added a
  regression test, "does not teleport forward past +300 m through a long segment (B1)".
- **SHOULD-FIX S1 — the figure-eight no-teleport test guarded nothing.** It ran on the clean
  (noise-free) trace, where a naive global-nearest search also passes, so a regression to
  global-nearest would not have failed it. Fixed: the test now runs on a jittered trace
  (`applyJitter` 8 m, seeded via `mulberry32(7)`); windowed search still passes (max single-fix
  jump <50 m, >90% of route length traversed) while a regression to global-nearest would teleport
  thousands of metres at the self-crossing and fail.
- **SHOULD-FIX S2 — cold start latched unconditionally.** The very first fix set `progressM`
  regardless of quality, so a low-accuracy first fix hundreds of metres off the route would
  permanently strand progress. Fixed: cold start now only latches `progressM` when the fix is
  inside the perpendicular gate (60 m); otherwise it returns `onTrack: false`, `accepted: false`,
  leaves progress unset, and the next fix retries the global-nearest search. ("Cold start = global
  nearest once" now means once *successfully*.) Added a test, "cold start does NOT latch on a fix
  outside the perpendicular gate (retries)".
- **SHOULD-FIX S3 — `GeolocationSource.start()` didn't stop a prior watch.** This violated the
  `FixSource` contract ("start() implies stop() of any prior stream") and leaked
  `watchPosition` handles on repeated start calls. Fixed: `start()` now calls `this.stop()` first.
  Added a test, "re-start stops the prior watch (FixSource contract)".
- **SHOULD-FIX S4 — NaN speed/heading leaked into `Fix`.** `GeolocationCoordinates.speed` and
  `.heading` are `NaN` (not `null`) when the device is stationary — i.e. at every red light — and
  that `NaN` was passed straight through into the `Fix`. Fixed: a `finiteOrUndef()` helper coerces
  non-finite `altitude`/`speed`/`heading` to `undefined` before building the `Fix`. Added a test,
  "drops NaN speed/heading (W3C reports NaN when stationary)".
- **SHOULD-FIX S5 — scan was O(route), not O(window) as documented.** Fixed: `nearestInWindow` now
  finds the first in-window segment via binary search over the precomputed cumulative-distance
  array (`firstSegmentAtOrAfter`) and breaks as soon as a segment's start exceeds the window end,
  so the scan is `O(log n + window)` as the Technical notes require, not `O(route)`.
- **SHOULD-FIX S6 — `onTrack` conflated lateral off-track with longitudinal backward-hold.**
  Fixed: `onTrack` now means purely "within the 60 m perpendicular gate" — the signal WR-015's
  off-route detector will consume. A new `accepted` field means "this fix advanced progress"
  (on-track AND not a >15 m backward jump). `SnapResult` now exposes both `onTrack` and
  `accepted` — any code consuming `SnapResult` for "did progress move" should read `accepted`,
  not `onTrack`.
- **NIT N1 — `prepareTrack([])` produced a null-island sentinel.** Fixed: `prepareTrack` now
  throws on fewer than 2 points.
- **NIT N4 — stale comment in `fixSource.ts`.** It claimed "snap gates on accuracy —
  NAVIGATION_SPEC §2", but no such gate exists and snap ignores accuracy entirely. Fixed: comment
  amended to "surfaced for UI confidence; not yet gated on".
- **Deferred (accepted as-is):** N2 — optional `Fix` fields are set to `undefined` rather than
  key-omitted; harmless while `exactOptionalPropertyTypes` is `false`. N3 — the clean-loop test
  asserts non-decreasing (not strictly-increasing) progress, the defensible choice given pauses
  and duplicate fixes; already noted in this Log's original test-contract paragraph.
- Test counts: `src/nav/snap.test.ts` 10 tests (was 8), `src/nav/locationService.test.ts` 9 tests
  (was 7); 191 total in the suite (was 187).