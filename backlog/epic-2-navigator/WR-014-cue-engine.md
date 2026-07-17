# WR-014 · Turn cue engine + TTS/beep
Epic: 2 · Navigator | Status: TODO | Depends on: WR-013 | Size: M

## Goal
Timely, non-spammy turn guidance: instructions bound to track distance, announced by on-device
speech (or beeps), scaled to speed.

## Context (read first)
NAVIGATION_SPEC §4 · ARCHITECTURE §4 (TurnStep from WR-005).

## Acceptance criteria
- [ ] Steps mapped to progress distances at route load; cue scheduler fires at 200 m and 40 m
      (±40% with speed), each cue exactly once, re-armed correctly after reroute (WR-015 hook).
- [ ] Web Speech synthesis with queue + 3 s debounce; beep-only mode (WebAudio, two distinct
      patterns for prepare/turn); silent mode.
- [ ] Utterance text templates: "In 200 metres, left onto Rantaraitti" / "Turn left now";
      units follow settings.
- [ ] Works fully under replay (speech mocked in tests, assert utterance log).

## Test contract
Replay clean-loop: expected cue sequence matches steps fixture exactly (order, one-shot).
Speed scaling unit tests. Debounce test: two steps 60 m apart ⇒ no overlapping speech.

## Technical notes
speechSynthesis needs a user gesture on some platforms — arm audio on "Start ride" tap and
note platform quirks in the Log after device testing.

## Out of scope
Wind HUD copy (WR-016).

## Log
