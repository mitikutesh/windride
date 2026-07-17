# WR-014 · Turn cue engine + TTS/beep
Epic: 2 · Navigator | Status: DONE | Depends on: WR-013 | Size: M

## Goal
Timely, non-spammy turn guidance: instructions bound to track distance, announced by on-device
speech (or beeps), scaled to speed.

## Context (read first)
NAVIGATION_SPEC §4 · ARCHITECTURE §4 (TurnStep from WR-005).

## Acceptance criteria
- [x] Steps mapped to progress distances at route load; cue scheduler fires at 200 m and 40 m
      (±40% with speed), each cue exactly once, re-armed correctly after reroute (WR-015 hook).
- [x] Web Speech synthesis with queue + 3 s debounce; beep-only mode (WebAudio, two distinct
      patterns for prepare/turn); silent mode.
- [x] Utterance text templates: "In 200 metres, left onto Rantaraitti" / "Turn left now";
      units follow settings.
- [x] Works fully under replay (speech mocked in tests, assert utterance log).

## Test contract
Replay clean-loop: expected cue sequence matches steps fixture exactly (order, one-shot).
Speed scaling unit tests. Debounce test: two steps 60 m apart ⇒ no overlapping speech.

## Technical notes
speechSynthesis needs a user gesture on some platforms — arm audio on "Start ride" tap and
note platform quirks in the Log after device testing.

## Out of scope
Wind HUD copy (WR-016).

## Log
Shipped `src/nav/cues.ts` (pure) and `src/nav/announcer.ts` (I/O, ports injectable).

`buildCuePoints(steps, track)` maps provider `TurnStep[]` to progress distances using the same
polyline/cumulative distances the WR-013 `Snapper` tracks (turn location =
`track.cum[step.wayPoints[0]]`); the depart step (ORS type 11) is skipped, arrival (type 10) is
kept. `CueScheduler.update(progressM, speedMs)` fires each cue exactly once — a "prepare" cue at
200 m and a "turn" cue at 40 m before the maneuver, both scaled ±40% around a 5.5 m/s nominal
speed (`scaledTriggerDistanceM`: distance = base × clamp(speed/5.5, 0.6, 1.4)); if the turn is
reached in the same tick the prepare is suppressed. `rearm(cues, progressM)` swaps the cue set
after a reroute and marks already-passed cues done — the hook WR-015 will call.

`Announcer(mode, deps)` turns `Cue`s into speech/beep/silent output via a queue with a 3 s debounce
(`CUE_DEBOUNCE_MS`) so two cues never overlap; a fresh cue for the same step collapses/supersedes
a queued older one. Clock and timers (`now`/`setTimeoutFn`/`clearTimeoutFn`) are injectable so
tests assert the utterance log deterministically and the replay harness can drive it. Ports:
`createSpeechPort` (Web Speech synthesis, no-op if unavailable), `createBeepPort` (WebAudio — two
short 880 Hz beeps for "prepare", one longer 1320 Hz beep for "turn"), and silent mode (no-op).
`armAudio(mode, deps)` assembles the real ports and unlocks audio on a user gesture (the "Start
ride" tap, the WR-016 hook).

Key decisions:
- Cues are bound to the WR-013 track's cumulative distances rather than raw step geometry, so
  cue placement stays consistent with the snapper's notion of progress.
- The provider's instruction string is the source of truth for direction + street name in the
  templates; the numeric ORS step type is used only structurally (skip depart / keep arrival),
  never for wording.
- Speed scaling is ±40% around a 5.5 m/s nominal riding speed (`clamp(speed/5.5, 0.6, 1.4)`), so
  faster riders are warned earlier and slower riders later, without a separate config surface.
- Debounce window is a flat 3 s with same-step collapse (a newer cue for the same step replaces a
  still-queued older one) rather than a priority queue — simplest thing that satisfies the no-
  overlap test contract.
- Ports and the clock are injected (`SpeechPort`/`BeepPort`/`now`/timers) so `announcer.test.ts`
  can assert the utterance log deterministically with no real audio/timers.
- A `UnitSystem` param (default `'metric'`, `'imperial'` → feet) is threaded through the
  templates ahead of an actual units setting existing yet — a small forward-looking default so
  WR-016 (or a later settings story) doesn't need to touch `cues.ts` to wire it up.
- Off-route re-arm is wired via `rearm()` as the WR-015 hook; WR-015 itself still needs to call it
  on reroute.

Not yet done: the speechSynthesis/AudioContext user-gesture requirement is handled in code via
`armAudio()` invoked on the Start-ride tap, but on-device platform quirks (iOS Safari, Android
Chrome, etc.) are still to be confirmed per this story's Technical notes — follow up during
device testing in WR-016.

Tests: `src/nav/cues.test.ts` (7 — speed-scaling clamp; `buildCuePoints` skips depart and binds
waypoint distance; one-shot prepare→turn with spec templates; prepare suppressed when turn is
reached in the same tick; arrival cues; rearm after reroute; and the replay clean-loop
integration below) and `src/nav/announcer.test.ts` (6 — voice speaks immediately; 3 s debounce
queues the second cue with no overlap; same-step collapse; beep distinct patterns; silent no-op;
`stop()` cancels + clears). Test contract satisfied: replay clean-loop (driving the real WR-013
`Snapper`) produces the exact ordered one-shot sequence for the fixture steps —
`[prepare:step1, turn:step1]` for the single real turn ("Turn left onto Metsapolku"), prepare text
"In N metres, left onto Metsapolku", turn text "Turn left now"; speed-scaling unit tests
pass; debounce test confirms two cues fired under 3 s apart never overlap. Full gate green: 204
tests, lint clean, build OK.

## Fable 5 review pass — fixes

A Fable 5 review of the initial cut returned APPROVE-WITH-FIXES. All SHOULD-FIX items and the
selected NITs are now applied; the gate is green again.

- **SHOULD-FIX 1 (on-road impact, the key fix)** — `CueScheduler.update` had no upper bound on
  how far behind progress a "turn" cue could still fire, so a GPS-dropout progress jump past the
  maneuver point would announce "Turn left now" for a turn already ridden past — a burst of
  misleading present-tense commands. Fixed with a new constant `CUE_STALE_SLACK_M = 25` (metres):
  a turn whose trigger point is more than 25 m behind current progress is marked done silently
  and never announced, instead of firing late. Added a test driving `update()` with a progress
  jump 300 m past the turn, asserting no utterance is produced and the cue never re-fires.
- **SHOULD-FIX 2** — the scheduler→announcer seam had no test coverage; scheduler and announcer
  were each unit-tested in isolation only. Added an integration test wiring a real `CueScheduler`
  to a real `Announcer` (fake clock following simulated ride time), ticked step-by-step over two
  cue points 60 m apart; asserts all four utterances (prepare/turn × 2) dispatch in ride order
  and are never less than 3 s apart.
- **SHOULD-FIX 3** — the same-step queue collapse removed the superseded cue but re-pushed the
  replacement onto the back of the queue, so an imminent "turn" replacing a still-queued "prepare"
  lost its place and waited an extra debounce cycle before speaking. Fixed to replace in place
  (`queue.splice(dup, 1, cue)`) so the replacement keeps the original's queue position.
- **NIT 6** — added an imperial-units formatting test asserting the feet-based template
  ("In 600 feet, left onto Rantaraitti").
- **NIT 7** — extended the `stop()` test to also fire the pending stale debounce timer *after*
  `stop()` has run, re-asserting nothing further is spoken — exercises the stale-callback path
  (a timer callback firing after teardown).
- **NIT 8** — added a code comment on `createSpeechPort` documenting Web Speech device quirks to
  confirm during WR-016 device testing: Chrome can garbage-collect an unreferenced utterance
  mid-speech (must hold a reference), and iOS requires `speak()` to be called at gesture time to
  unlock voice output (handled today via `armAudio()` on the Start-ride tap, but still needs
  on-device confirmation).
- **NIT 9b** — `rearm()`'s doc comment now notes that WR-015 must also call `announcer.stop()`
  on reroute, so a cue already queued for the old route isn't spoken after the route changes.
- **Deferred (recorded as NITs, not blocking)**:
  - #4 — the replay-contract integration test hand-maps the fixture steps into `CuePoint`s rather
    than importing the real ORS adapter parser; kept as-is to avoid introducing a nav→adapters
    test dependency.
  - #5 — the arrival "You have arrived" utterance fires up to ~40 m early since it shares the
    turn-cue trigger distance; acceptable and consistent with common turn-by-turn nav behaviour.
  - #8 (residual) — the Web Speech quirks themselves (Chrome GC, iOS gesture unlock) are
    documented but only actually verified during WR-016 on-device testing.
  - #9c — out-and-back routes currently carry only outbound steps (a WR-005 provider limitation),
    relevant when WR-016 builds return-leg cues.

Gate after fixes: 207 tests total (`src/nav/cues.test.ts` now 9, `src/nav/announcer.test.ts` now
7), lint clean, build OK.
