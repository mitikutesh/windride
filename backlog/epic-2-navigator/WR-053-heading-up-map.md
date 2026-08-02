# WR-053 · Heading-up map orientation (rotate to travel, north-up toggle)
Epic: 2 · Navigator | Status: DONE | Depends on: WR-016 | Size: M

## Goal
Owner-reported (2026-08-02) after real rides: during live navigation the map is locked north-up, so
when the voice says "turn left" the arrow on screen does not point the way the rider is actually
going — deciding left from right becomes a mental rotation puzzle at the exact moment it matters.
Rotate the map so **up = direction of travel** (the Google-Maps "heading up" mode), with a button to
go back to north-up, and sit the rider low on screen so most of the map shows the road ahead.

## Context (read first)
NAVIGATION_SPEC §9 (added by this story) · DEC-033 (the heading blend, and why the map must NOT
consume it) · DEC-058 (GPS-outage recovery, which the bearing gate must respect) · DEC-061 (this
story's decisions).

## Acceptance criteria
- [x] While riding, the map rotates so up = the rider's direction of travel, and the rider puck
      points up the screen. In heading-up the puck sits low, inside the band the turn card and stats
      panel leave visible, so roughly three-quarters of the visible map is the road ahead.
- [x] A map button toggles heading-up ↔ north-up. It works in both directions — including while
      heading due north, where the bearing does not change — is remembered across rides, and shows
      where north is so the rider can always re-orient.
- [x] Rotation is stable: the map never spins while the rider is stopped (the device compass can
      never rotate it), never jitters on a straight road (5° deadband), and never whips to a chord
      bearing after a GPS outage.
- [x] The map bearing comes from the GPS travel bearing only, gated on 10 m of real displacement —
      never from `RideState.headingDeg`, which is compass-dominated at low speed.
- [x] Reduced-motion riders default to north-up; battery saver still jumps rather than eases.
- [x] The follow camera runs at fix rate, not device-compass sensor rate (precondition — see Log).
- [x] `npm test && npm run lint && npm run build` green.

## Test contract
Nav: `MapBearingGate` — no commit before 10 m; hold between commits; deadband holds but re-anchors;
deadband measured across 0°/360°; a >60 m single-fix jump re-anchors WITHOUT committing; null travel
bearing holds; a ±4 m stationary wander sequence never commits. Controller: `mapBearingDeg` is null
on the first fix, locks onto the travel bearing once moving, and is unmoved by `setCompassHeading`.
UI (pure): `cameraTargetFor` — bearing/offset zero in north-up and until a bearing exists; offset
lands the rider inside the visible band for the live chrome; long ease for a >90° turn measured
against MapLibre's −180..180 bearing; zero duration under battery saver; plus first coverage for
`zoomForMetres`. UI (light): the toggle renders while riding, defaults pressed, flips the store, and
the announced orientation is honest; north-up is held during a reroute preview and restored on
Accept without touching the rider's preference.

## Out of scope
WR-054 (junction clarity: turn-approach zoom, junction highlight, geometric turn glyph, chained
cues) · a 3D/tilted navigation view · gesture rotation · using `Fix.heading` (the OS-fused course)
as a bearing source · persisting the basemap and battery-saver toggles alongside the orientation.

## Log
Shipped:
- `src/nav/mapBearing.ts` (+ test) — `MapBearingGate`: displacement-gated map bearing from the GPS
  travel bearing. No clock, no speed, no compass.
- `src/nav/rideController.ts` — owns the gate, fed the travel bearing BEFORE the compass blend;
  new `RideState.mapBearingDeg`.
- `src/ui/mapCamera.ts` (+ test) — pure `cameraTargetFor()` returning center/zoom/bearing/offset/
  duration/essential; `zoomForMetres` moved here from `mapLayers.ts` (its only consumer was RideMap,
  and it had no test).
- `src/ui/components/RideMap.tsx` — applies the target via `easeTo`; new `headingUp` /
  `mapBearingDeg` / `insets` props; `map.keyboard.disableRotation()`; the ResizeObserver now re-runs
  the camera, not just `resize()`.
- `src/state/rideSettingsStore.ts` (+ test) — persisted `mapOrientation`, defaulting to north-up
  under `prefers-reduced-motion`.
- `src/ui/screens/RideScreen.tsx` (+ tests) — the toggle button, the compass throttle, a memoised
  rider prop, live-ride insets, and north-up while a reroute proposal is previewed.

Decisions (DEC-061): the map bearing is travel-only and displacement-gated; no EMA/slew filter (at
1 Hz an EMA needs ~10 s to finish a corner — MapLibre's `easeTo` is the smoother); `easeTo({offset})`
rather than `padding` (MapLibre padding persists between calls and `fitBounds` adds it).

A blind design red-team before implementation changed three things and was right each time:
1. **The follow camera was already re-easing at compass sensor rate (~60 Hz), not fix rate** — every
   `deviceorientationabsolute` event pushed React state, the `rider` prop was a fresh literal per
   render, and RideMap's camera effect was keyed on that object. Center/zoom survived by accident;
   bearing would not have (rotation speed would have become an artifact of the interrupt cascade,
   and would have differed depending on whether the compass was granted). Fixed as a precondition:
   the compass publishes at ~8 Hz, the rider prop is memoised on values, and the marker effect is
   split from the camera effect so heading changes move only the puck.
2. **`RideState.headingDeg` is the wrong source for a map bearing.** Below 0.8 m/s it is pure
   compass, whose Android alpha→heading conversion is tilt-uncompensated (DEC-033), and around the
   1.9 m/s crossfade midpoint `circularBlend` returns the dominant endpoint — so it can flip 180°
   between fixes, which as a map bearing reads as an endless slow rotate-and-rotate-back.
3. **The off-route arrow should NOT change.** An earlier draft rotated it relative to the map
   bearing; it is a DOM banner, not a map-anchored element, and on a bar-mounted phone screen-up
   already IS the travel direction — the same reasoning that keeps the wind HUD body-relative.

Review fixes applied after the a11y pass: the toggle's pressed state no longer rests on colour
alone (WCAG 1.4.1) — heading-up adds a fixed pip at screen-top, because the rotating needle looks
identical in both modes whenever the rider happens to be heading due north. The screen-reader
announcement now states what the map is actually doing ("…once you are moving" before the first
bearing exists) and is not rendered at all on the idle route preview, where nothing rotates.

Follow-ups discovered:
- WR-054 is the other half of the owner's report (junction clarity) and is now queued.
- `Fix.heading` (the OS-fused course, captured in `locationService.ts` but never consumed) is
  probably a better map-bearing source than our own fix-to-fix bearing. Deferred: it needs its own
  availability study on real devices.
- The live-ride insets are constants mirroring `components.css` (`--ride-panel-clear`, the details
  panel's `78dvh`). Measuring the real chrome boxes would remove the drift risk.
- Vector-basemap road labels visibly re-place on each corner. Inherent to rotating a vector map;
  cosmetic, accepted.
- `batterySaver`, the basemap choice, and the orientation are three map/ride settings with three
  different lifetimes; folding the first two into `rideSettingsStore` would make them consistent.
