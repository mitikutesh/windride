# WR-046 · Natural-language planning
Epic: 6 · AI | Status: TODO | Depends on: WR-044 | Size: M

## Goal
Type "2h gravel loop, few hills, café by the sea" and get the Plan form filled in — parsed to
the existing inputs, clamped to their ranges, and reviewed by the user before anything runs.

## Context (read first)
WR-044 (adapter, validation) · DEC-043 · WR-008 Plan inputs (the target shape) · DEC-004
(speed defaults, for duration→distance).

## Acceptance criteria
- [ ] Free-text field on the Plan screen → one AI parse into a structured Plan-input object:
      distance (or duration, converted via the speed model), loop/out-and-back, surface,
      elevation preference, optional via-point (kept as text).
- [ ] Every parsed value clamped to the existing input ranges/enums; fields the text didn't
      mention (or the parse couldn't place) stay at their current values — never invented.
- [ ] The user reviews the filled form — changed fields visibly highlighted — and taps Plan
      themselves. No auto-generation, no API spend without that tap.
- [ ] Schema-validated per WR-044; malformed ⇒ form untouched + a quiet "couldn't parse that";
      no `ai` key ⇒ the text field is absent and the classic form is unchanged.
- [ ] The clamp/mapping layer is a pure function with its own unit tests (engine-adjacent —
      no I/O).

## Test contract
Fixture parses map to correct clamped Plan inputs (an out-of-range distance clamps, a bogus
surface falls back, an unmentioned field is untouched); malformed fixture leaves the form
as-was; duration→distance uses the speed model, not naive math.

## Out of scope
Multi-turn chat · executing the plan automatically · geocoding the via-point (WR-047's
machinery; until then it prefills the existing inputs only).
