# WR-046 · Natural-language planning
Epic: 6 · AI | Status: DONE | Depends on: WR-044 | Size: M

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
      **Partially met**: distance/duration, loop/out-and-back (+downwind), surface, and the
      other existing Plan inputs are handled. Elevation preference and via-point are NOT plan
      inputs today (no control exists to fill), so that half of this criterion is out of reach
      as written — deferred per DEC-045, box left unticked rather than claimed done.
- [x] Every parsed value clamped to the existing input ranges/enums; fields the text didn't
      mention (or the parse couldn't place) stay at their current values — never invented.
- [x] The user reviews the filled form — changed fields visibly highlighted — and taps Plan
      themselves. No auto-generation, no API spend without that tap.
- [x] Schema-validated per WR-044; malformed ⇒ form untouched + a quiet "couldn't parse that";
      no `ai` key ⇒ the text field is absent and the classic form is unchanged.
- [x] The clamp/mapping layer is a pure function with its own unit tests (engine-adjacent —
      no I/O).

## Test contract
Fixture parses map to correct clamped Plan inputs (an out-of-range distance clamps, a bogus
surface falls back, an unmentioned field is untouched); malformed fixture leaves the form
as-was; duration→distance uses the speed model, not naive math.

## Out of scope
Multi-turn chat · executing the plan automatically · geocoding the via-point (WR-047's
machinery; until then it prefills the existing inputs only).

## Log
Shipped: an opt-in free-text box on the Plan screen (`src/ui/components/NlPlanBox.tsx`, mounted
from `PlanScreen.tsx` only when AI is set up). Text goes to `getAiClient().complete()` with a
system prompt scoped to the real `PlanInputs` fields (`src/engine/nlPlan.ts` — `nlPlanRequest` +
`parseNlPlan`, pure, unit-tested). `parseNlPlan` validates and CLAMPS every field to its real
range/enum (distance 20–100 step 5, `routeType`/`surface` enums, `departureHour` snapped to
{0,3,6}, booleans as-is), drops unrecognised fields, and rejects the whole reply if nothing
usable survives. `src/state/nlPlanStore.ts` orchestrates: pulls the rider's calibrated base
speeds (`activeSpeedSettings()`) for duration→distance, applies the clamped patch via
`usePlanStore.setInput`, and exposes changed-field labels (shown as chips) + a summary + status
for the UI. The user reviews the filled controls and taps Plan themselves — nothing auto-plans,
no API spend without the explicit "Interpret" action.

Fable review found 3 issues, all fixed before closing:
- **Critical** — duration→distance was going through the AI's own guess; now routed through the
  speed model's base speed (`activeSpeedSettings`), never naive math or the model's arithmetic.
- **Critical** — changed fields were applied silently with no visual cue; now surfaced as chips
  (`nlPlanStore.changed`) so the user notices an unexpected change (e.g. winter mode flipping on)
  before tapping Plan.
- **Important** — provider failures all said "try rephrasing"; now phrased by `ProviderError`
  kind/code (auth → "check it in Kit → AI", quota → "try again later", network → "check your
  connection"), rephrase copy reserved for genuine parse failures.
Fable also ran an adversarial clamping audit (out-of-range numbers, bogus enums, NaN, injected
fields like start coordinates, a fully-unusable reply) — no leaks, all rejected/clamped/dropped
as intended. Confirmed the feature is non-authoritative (only ever fills existing controls) and
that no Strava data enters the prompt (CLAUDE.md domain warning).

**DEC-045 scope note:** the story's acceptance text names elevation preference and an optional
via-point, but neither exists as a `PlanInputs` field today — there's no control for the parser
to fill. Rather than inventing new inputs mid-story or silently dropping the requirement, added
DEC-045 recording that NL planning maps only the fields that exist now; via-point/elevation wait
for the inputs themselves (via-point geocoding is WR-047's machinery per Out of scope above).
The first acceptance box is left unticked to reflect this honestly.

Follow-ups for later stories:
- Per-control highlight (ring/glow on the actual changed input) instead of a separate chip list
  — closer to the story's "visibly highlighted" framing once there's UI budget for it.
- A render test asserting `NlPlanBox` is absent with no `ai` key configured (currently covered
  by the parent gating on `aiReady`, but no direct UI test locks that contract).
- Clock-time departure requests ("leave at 7am") currently need the model to convert to
  hours-from-now itself before `departureHour` snapping to {0,3,6}; a dedicated clock-time parse
  path would be more robust than relying on the prompt instruction alone.
