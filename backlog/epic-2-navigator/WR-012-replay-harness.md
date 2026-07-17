# WR-012 · GPX replay harness — build BEFORE any GPS code
Epic: 2 · Navigator | Status: TODO | Depends on: WR-011 | Size: M

## Goal
Deterministic simulated GPS: feed recorded or synthetic traces through the real nav pipeline at
1–20× speed, from terminal and from a dev panel. Every nav story tests against this, so
navigation is debugged at the desk, not in the saddle.

## Context (read first)
NAVIGATION_SPEC §8 (authoritative) · CLAUDE.md testing policy.

## Acceptance criteria
- [ ] `replay.ts`: parse GPX trace → emit fix objects ({lat, lon, ele, time, speed?}) on the
      same interface the live location service will implement (define `FixSource` now).
- [ ] `npm run replay -- <file> --speed 10` streams fixes with timing; `--jitter 8` adds
      gaussian position noise (metres) for realism.
- [ ] Three synthetic traces generated into fixtures/traces/: clean loop following a WR-005
      fixture route; same loop with a deliberate 300 m off-route excursion; a figure-eight
      (self-crossing) trace.
- [ ] Dev panel in the app (dev builds only): pick trace, speed, start/stop.

## Test contract
Replay determinism (same trace ⇒ identical fix sequence with --jitter 0); timing accuracy
±10% at 10×.

## Technical notes
Synthetic traces are derived FROM route fixtures (walk the polyline at modelled speed) so
snap tests have ground truth progress values.

## Out of scope
Snap/cues (next stories) — this story only produces fixes.

## Log
