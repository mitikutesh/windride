# WR-012 · GPX replay harness — build BEFORE any GPS code
Epic: 2 · Navigator | Status: DONE | Depends on: WR-011 | Size: M

## Goal
Deterministic simulated GPS: feed recorded or synthetic traces through the real nav pipeline at
1–20× speed, from terminal and from a dev panel. Every nav story tests against this, so
navigation is debugged at the desk, not in the saddle.

## Context (read first)
NAVIGATION_SPEC §8 (authoritative) · CLAUDE.md testing policy.

## Acceptance criteria
- [x] `replay.ts`: parse GPX trace → emit fix objects ({lat, lon, ele, time, speed?}) on the
      same interface the live location service will implement (define `FixSource` now).
- [x] `npm run replay -- <file> --speed 10` streams fixes with timing; `--jitter 8` adds
      gaussian position noise (metres) for realism.
- [x] Three synthetic traces generated into fixtures/traces/: clean loop following a WR-005
      fixture route; same loop with a deliberate 300 m off-route excursion; a figure-eight
      (self-crossing) trace.
- [x] Dev panel in the app (dev builds only): pick trace, speed, start/stop.

## Test contract
Replay determinism (same trace ⇒ identical fix sequence with --jitter 0); timing accuracy
±10% at 10×.

## Technical notes
Synthetic traces are derived FROM route fixtures (walk the polyline at modelled speed) so
snap tests have ground truth progress values.

## Out of scope
Snap/cues (next stories) — this story only produces fixes.

## Log
Shipped the shared `FixSource` contract (`src/nav/fixSource.ts`: `Fix` {lat, lon, ele?, time,
speed?} + `{start(handler), stop()}`) that WR-013's live geolocation service will implement
against the same interface — nav code written now never has to change shape when GPS lands.

`src/nav/replay.ts` provides the pure building blocks plus the source itself:
`parseTraceToFixes` (GPX → fixes, deriving speed from consecutive time+distance),
`walkPolyline` (interpolate a polyline at a modelled speed/hz — this is the ground-truth
progress generator WR-013's snap tests will assert against), `applyJitter` (deterministic
gaussian metres via a seeded mulberry32 PRNG), `replayFixes` (exact deterministic fix sequence,
no timers — used by tests), and `ReplaySource` (the real `FixSource`, streams with relative
timing scaled by `speed`, timers injectable for tests).

`scripts/gen-traces.ts` (`npm run gen:traces`) derives three polylines from the WR-005 ORS
fixture loop — clean loop, same loop with a ~300 m perpendicular off-route excursion and back,
and a self-crossing lemniscate figure-eight — walks each at 25 km/h, and writes
`fixtures/traces/{clean-loop,off-route,figure-eight}.gpx` (576/628/1131 fixes). Because these
are walked from the real route fixture, WR-013 gets exact ground-truth `progressM` to check
its windowed snap against, including the self-crossing case NAVIGATION_SPEC §2 calls out.

`scripts/replay.ts` (`npm run replay -- <file.gpx> [--speed N] [--jitter metres]`) streams
fixes with scaled timing to the console — the terminal half of the "debug at the desk" loop.

`src/ui/components/DevReplayPanel.tsx` is the dev-panel half: trace picker, speed slider,
start/stop, live fix readout. It's lazy-loaded from `KitScreen` only behind
`import.meta.env.DEV`, so the conditional dynamic import is dead-code-eliminated in production
builds and the bundled `?raw` traces never ship (verified: prod precache size unchanged).

Tests cover `walkPolyline` spacing/time/endpoints, `parseTraceToFixes` speed derivation,
determinism (jitter 0 is a passthrough; a seeded jitter is reproducible and differs across
seeds), and `ReplaySource` timing (delays = (t − t0)/speed, e.g. 1 s apart at 10× ⇒ 100 ms,
within the ±10% contract; all fixes emitted in order). 167 tests passing; lint and build green.

No open follow-ups; off-route/self-crossing *handling* (snap, cues, reroute) is explicitly out
of scope here and lands in WR-013/WR-015 against these same traces.

## Fable 5 review pass — fixes

A Fable 5 review found SHOULD-FIX items (no blockers). All addressed:

- **Endpoint closure (the headline bug).** `walkPolyline` was accumulating float distance
  along the polyline and stopping once that accumulator reached the target, so replayed
  loops/traces landed ~3.7–5.2 m short of the true route endpoint instead of closing exactly.
  That gap would have corrupted WR-013's loop-closure and finish-detection ground truth (a
  "closed loop" that never quite closes). Rewrote it to index-based iteration that emits the
  exact final route vertex on the last step, eliminating drift. All three fixture traces were
  regenerated against the fixed walker (576→577, 628→629, 1131→1132 fixes — the corrected
  endpoint adds one fix each). The endpoint test is tightened from an approximate check to
  near-exact.
- **`FixSource` seam hardened for WR-013.** `start(onFix, onError?)` now carries an optional
  error channel, and `Fix` gained optional `accuracy`/`heading` fields. This freezes the
  interface shape so WR-013's `watchPosition`-backed source (permission denied, position
  unavailable, timeout errors; accuracy-based gating) can implement against it with zero
  breaking changes later. `ReplaySource.start` accepts `onError` for interface compatibility;
  replay is deterministic and never errors, so it's simply unused there.
- **1 Hz time synthesis for timeless GPX.** `parseTraceToFixes` previously collapsed every fix
  in a trace lacking `<time>` elements to epoch 0, which would replay as an instantaneous dump
  of out-of-order fixes rather than a timed stream. It now synthesises a 1 Hz timeline so
  timeless traces replay sanely.
- **Route-polyline sidecars for snap ground truth.** `gen-traces` now also writes the
  underlying polylines to `fixtures/traces/{clean-loop,off-route,figure-eight}-route.json`.
  Previously the figure-eight and off-route route shapes existed only inside the generator
  script; WR-013's snap tests need the actual route geometry (not just the walked fix
  sequence) as ground truth, so it's now a checked-in fixture.
- **`DevReplayPanel` unmount cleanup.** Added a `useEffect` cleanup that stops the
  `ReplaySource` on unmount, so navigating away from the panel mid-replay no longer leaves
  timers firing against a dead component.
- **Replay CLI validation + determinism.** `scripts/replay.ts` now validates `--speed` and
  `--jitter` (rejects `NaN`/`<= 0`) instead of silently misbehaving, and adds a `--seed` flag
  for deterministic jitter reproduction from the terminal.
- **New tests.** A fixture-contract test asserts exact fix counts, clean-loop closure, that
  the off-route trace peaks at ~300 m from the clean route (via turf `pointToLineDistance`)
  and returns, and that the figure-eight self-crosses. A real-timer timing test asserts
  emission lands within ±10% of wall-clock at 20× — the timing contract was previously only
  checked against a mocked scheduler, not real timers.
- **Deferred NITs (intentionally not fixed).** `ReplaySource` schedules one `setTimeout` per
  fix upfront; fine at these fixture sizes, but a chained single-timer approach would scale
  better and would allow mid-run speed changes — left as a future improvement if traces grow
  much longer. The small `.wr-devpanel` CSS block ships in the production stylesheet since
  CSS isn't tree-shaken by route/env like the JS import is; harmless (a few bytes) but noted.

Gate green after fixes: 172 tests passing (was 167), lint clean, build clean.
