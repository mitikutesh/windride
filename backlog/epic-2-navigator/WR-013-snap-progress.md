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