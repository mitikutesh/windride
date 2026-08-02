# WR-056 · Junction glyph and wording: real maneuver kinds, chained turns
Epic: 2 · Navigator | Status: DONE | Depends on: WR-054 | Size: M

## Goal
The last piece of the owner's report (2026-08-02): *"shouting the route direction … is a bit
confusing"*. WR-053 rotated the map, WR-055 zoomed it; this fixes what the app **says and draws**.

Three defects:
1. `TurnGlyph` substring-matched the instruction for 'left'/'right'/'u-turn', so "Turn left", "Keep
   left" and "Sharp left" drew the **same arrow** — and a roundabout ("Enter the roundabout and take
   the 2nd exit onto X", which contains no direction word) drew as **straight ahead**.
2. Closely-spaced maneuvers talked over each other (see the Log for the measured scale).
3. The provider's own maneuver taxonomy was going unused on a stated suspicion that turned out to be
   false.

## Context (read first)
NAVIGATION_SPEC §4 (cues — amended) · DEC-064 (this story, incl. the real-capture evidence) ·
`fixtures/README.md` for what the probe captured · DEC-062 (the fixture bug that caused the suspicion).

## Acceptance criteria
- [x] left / slight left / sharp left / keep left / right / … / u-turn / roundabout / arrive each draw
      a distinct, directionally correct arrow.
- [x] A roundabout draws as a roundabout, not as straight ahead.
- [x] Two maneuvers within 60 m produce ONE prepare that names both, never two stacked prepares; two
      within 15 m produce one cue entirely, with the follower's direction spoken in it.
- [x] A run of three or more composes without any maneuver going silent.
- [x] The maneuver taxonomy is verified against a real provider response, not assumed.
- [x] A contradicting provider code can never draw the wrong direction.
- [x] `npm test && npm run lint && npm run build` green.

## Test contract
`turnKind.test.ts`: every ORS code → its kind; the four left-ish maneuvers that used to share one
arrow are four distinct kinds; roundabout detected with and without a code; wording fallback when
`type` is absent or unknown; **the guard** — `type: 1` (right) on "Turn left onto X" yields left, and
the mirror case; a code kept when the wording gives no verdict (no side named, or both); sideless
kinds kept even when the wording mentions a side ("Arrive … on the right"); and an assertion across
**all 128 steps of the real capture** that code and wording never disagree on the side.
`cues.test.ts`: same-junction pair → one cue set, follower silent, direction carried in the hint;
50 m pair → one prepare, both turns; well-separated pair untouched and no hint; a run of three keeps
all three turn cues with only the first follower named; several merges name only one.
`RideScreen.test.tsx`: the card's `data-turn-kind` is `keep-left` (not the generic left arrow the old
code drew) and the chained roundabout renders too.

## Out of scope
WR-057 (on-map junction highlight + arrow at the node) · WR-058 (cues for step-less routes) ·
shortened roundabout phrasing (needs `exit_number`, which ORS does not send — see the Log) · using
the steps' `name` field.

## Log
**Step 0 ran the probe rather than guessing, and it changed the story.** `fixtures/README.md` had
recorded the real ORS captures as pending since WR-005. One `npm run probe:ors` run (2 live calls; the
50 km loop returned HTTP 500 and was not retried, so only `real-small.json` landed — 22.5 km, 868
points, 128 steps) settled three things at once:

- **The type codes agree with their own text, on every one of 128 steps.** 0 "Turn left", 1 "Turn
  right", 2/3 sharp, 4/5 slight, 6 "Continue straight", 12/13 "Keep left/right". The caution in
  `cues.ts` ("provider `type` codes can disagree with the localized instruction text") traced to the
  hand-made fixture's own bug, which WR-054 fixed. So the taxonomy is trustworthy, and the glyph can
  be built on it — which matters because geometry *cannot* separate "Keep left" (12) from "Slight
  left" (4): they are the same angle.
- **`exit_number` does not exist** in the response (step keys are `distance, duration, type,
  instruction, name, way_points`), so the planned shortened roundabout phrase was dropped per the
  plan's own branch point. The glyph fix is the real roundabout win.
- **Closely-spaced maneuvers are a third of a real ride, not an edge case.** Median gap 117 m, but
  **43 of 120 real maneuvers fall within 60 m of the previous one, 23 of them within 15 m.** Unchained
  that is 43 doubled or stacked announcements over 22 km — very plausibly the largest single
  contributor to the owner's complaint.

That last number changed the design mid-story: the approved plan folded a <15 m follower away
silently, which at 23 occurrences would have dropped real instructions. Refined to keep every
maneuver's direction audible:
- **gap ≤ 15 m** — same junction: the follower is not announced, but its direction is appended to the
  leader ("Turn left, then right"). Only the street name is lost.
- **15 m < gap ≤ 60 m** — a real second maneuver whose PREPARE would stack ~150 m early: its prepare
  is dropped and the leader's cue names it, but its own turn cue still fires.
- 60 m is deliberately above the widest scaled turn trigger (40 × 1.4 = 56 m); below that, two TURN
  cues land on the same tick and talk over each other.

Shipped:
- `src/nav/turnKind.ts` (+ test) — `TurnKind`, `turnKindOf` (code first, wording as check and
  fallback, with a side-disagreement guard), `shortDirection`.
- `src/domain.ts` — the full ORS code table, with the capture as its evidence.
- `src/nav/cues.ts` — `markChains` at BUILD time (it cannot be done at fire time: with maneuvers at
  1000 m and 1050 m the order is leader-prepare, *follower-prepare*, leader-turn — by the time the
  leader fires, the follower spoke 150 m ago), `CuePoint.suppress`/`thenKind`, `withThen`, and
  `applySuppression` reusing the existing one-shot bookkeeping so the hot loop needs no special case.
- `src/nav/rideController.ts` — `NextTurn.kind`/`thenKind`; a fully-suppressed cue is never the card's
  "next turn" (it is the same junction as the one before it).
- `src/ui/screens/RideScreen.tsx` — `TurnGlyph` driven by kind: one arrow rotated per kind
  (straight 0°, slight ±25°, normal ±65°, sharp ±115°) plus dedicated u-turn, fork, roundabout and
  arrive glyphs, and `data-turn-kind` so it is testable at all (the SVG is `aria-hidden`).
- `fixtures/ors/real-small.json` + `fixtures/README.md`.

Follow-ups:
- The steps carry a `name` (street) field we do not parse — it would let cues name a street without
  regexing the instruction.
- Roundabout phrasing still speaks the whole provider sentence; shortening it needs an exit number
  ORS does not provide on this profile.
- `real-medium.json` is still uncaptured (ORS 500s on a 50 km round trip).
- WR-058 remains: curated and AI routes ship `steps: []`, so none of this exists on them.
