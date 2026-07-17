# WR-013 · Location service + windowed snap + progress
Epic: 2 · Navigator | Status: TODO | Depends on: WR-012 | Size: M

## Goal
Reliable "where am I on my route": live geolocation behind FixSource, windowed snap-to-track,
monotonic progress, distance-remaining — correct even on self-crossing loops.

## Context (read first)
NAVIGATION_SPEC §1–2 (authoritative numbers) · CLAUDE.md domain warnings (windowed snap).

## Acceptance criteria
- [ ] `locationService.ts`: watchPosition wrapped as FixSource (permissions UX: clear prompt,
      graceful denial state); replay source interchangeable.
- [ ] `snap.ts`: window [−100 m, +300 m] around last progress, perpendicular gate 60 m,
      forward-only progress with −15 m jitter tolerance; cold-start = global nearest once.
- [ ] Figure-eight replay: progress passes the crossing without teleporting (regression test).
- [ ] Exposes {progressM, remainingM, perpendicularM, snapped: LatLon, onTrack: boolean}.

## Test contract
Integration via replay traces: clean loop ⇒ progress strictly increasing, final remaining <30 m;
jittered trace ⇒ no backwards jumps >15 m; crossing trace ⇒ max single-fix progress jump <50 m.

## Technical notes
Precompute cumulative distances per polyline point once; snap search is then an index-window
scan — keep it O(window), not O(route).

## Out of scope
Cues, off-route handling, UI.

## Log
