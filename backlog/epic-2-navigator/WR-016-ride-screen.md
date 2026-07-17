# WR-016 · Ride screen — glance zone, wind HUD, wake lock
Epic: 2 · Navigator | Status: TODO | Depends on: WR-014, WR-015 | Size: L

## Goal
The saddle UI: huge honest numbers, the next-turn card, and WindRide's signature promise —
"Tailwind in 2.3 km" — readable at 27 km/h in sunlight.

## Context (read first)
DESIGN.md (tokens, glance rules) · NAVIGATION_SPEC §5,7 · PRODUCT_SPEC §5.

## Acceptance criteria
- [ ] Layout: map (route ahead wind-coloured, chevron with pulse), turn card, wind HUD
      (arrow relative to heading + next transition text from scored segments), glance zone:
      speed (≥48 px), wind-aware ETA, remaining km, progress WindRibbon with position dot.
- [ ] ETA uses the EMA correction from NAVIGATION_SPEC §5 (unit-tested helper).
- [ ] Wake lock held during ride, re-acquired on visibilitychange; battery-saver toggle
      (static map, audio-first).
- [ ] Start/pause/end flow wired to recorder (WR-017 interface stub if it lands later).
- [ ] Fully drivable by replay dev panel end-to-end.

## Test contract
`nextWindTransition(segments, progressM)` unit tests (boundaries, no-transition case).
EMA ETA tests (riding faster than model ⇒ ETA shrinks). Interaction: pause stops cue firing.

## Technical notes
Heading from fix deltas (smoothed), not compass, at cycling speeds. Reduced-motion kills the
pulse. Keep the screen chrome-free: no tab bar during a ride.

## Out of scope
Ride summary screen (small addition in WR-017); feels-like chart (WR-022).

## Log
