# WR-054 · Out-and-back cues: no phantom arrival at the fold
Epic: 2 · Navigator | Status: DONE | Depends on: WR-014 | Size: S

## Goal
Found while planning the junction work the owner asked for ("shouting the route direction … is a bit
confusing"): **on any out-and-back candidate the app announced "You have arrived" at the halfway
point and then went silent for the whole return leg.**

`outAndBack()` doubled the polyline but forwarded `steps: leg.steps` unchanged, so the leg's ORS
arrival step (type 10, at the leg's last vertex) landed exactly on the fold, and no cue point existed
past it. Two of the ~8 generated candidates are out-and-backs, so this was a routine ride.

Fixing it exposed a second, worse bug underneath — see the Log.

## Context (read first)
NAVIGATION_SPEC §2 (snap — amended by this story) and §4 (cues) · DEC-062 (this story's decisions) ·
DEC-058 (the outage-recovery precedent for gated re-latching).

## Acceptance criteria
- [x] An out-and-back announces arrival only at the real finish — never at the fold.
- [x] The fold is announced as a turnaround, at both cue distances, and reads naturally
      ("In 200 metres, turn around and ride back" / "Turn around now").
- [x] The turnaround is recognised from the ORS maneuver code, so it survives a localized
      instruction string.
- [x] Every synthesized step's `wayPoints` is in range for the doubled polyline; the outbound
      instructions are preserved unchanged.
- [x] The next-turn card shows a u-turn arrow at the fold.
- [x] Progress along an out-and-back tracks the true position on BOTH arms — it never latches the
      mirrored arm, and never freezes partway.
- [x] The return leg's lack of street-level turns is deliberate and documented, not accidental.
- [x] `npm test && npm run lint && npm run build` green.

## Test contract
Adapter: exactly one arrival step, at the last vertex; a type-9 turnaround at the fold index;
outbound steps preserved; all `wayPoints` in range. The p2p test mock now carries an arrival step, as
real ORS legs do, so the fold logic is exercised rather than skipped. Cues: the fold speaks as a
turnaround at 200 m and 40 m, and is recognised from the code alone with a Finnish instruction.
Controller: riding a synthetic out-and-back end to end announces nothing arrival-shaped before 75 %
of the route, announces the turnaround within 60 m of the halfway point, and still has a next turn to
show on the return leg. Snap: progress stays within 25 m of truth across the fold and reaches the
halfway distance at the halfway point.

## Out of scope
Real street-level instructions for the return leg (needs either a second ORS call or the turn
geometry of WR-056) · the junction camera (WR-055), glyph/wording overhaul (WR-056) and on-map
junction highlight (WR-057) · turn cues for routes that ship no steps at all (WR-058).

## Log
Shipped:
- `src/adapters/routing/ors.ts` — `outAndBackSteps()` rebuilds the doubled route's steps: outbound
  steps unchanged (the outbound half of the doubled polyline is identical to the leg, so their
  `wayPoints` stay valid), the leg's arrival replaced by a type-9 turnaround at the fold, and a real
  arrival at the true end. Exported `TURNAROUND_INSTRUCTION`.
- `src/domain.ts` — `ORS_UTURN` / `ORS_ARRIVAL` / `ORS_DEPART`, the three maneuver codes we rely on
  structurally. They existed as private copies in `nav/cues.ts` AND `engine/geometry.ts`; both now
  import the shared constants.
- `src/nav/cues.ts` — `isTurnaround()` (code-first, text as a fallback) plus turnaround wording for
  both the prepare and turn cues. Without the prepare branch `shortenInstruction` strips the leading
  verb and says "In 200 metres, around and ride back".
- `src/nav/snap.ts` — arm-aware tie-break (see below).
- `src/ui/screens/RideScreen.tsx` — `TurnGlyph` renders the u-turn arrow for the turnaround.
- `fixtures/ors/roundtrip-sample.geojson` — the only ORS fixture had `type: 1` (ORS 1 = *right*) on
  a step reading "Turn left onto Metsapolku", while `cues.test.ts` already assumed 0 = left. Every
  piece of fixture-driven turn work was training against a self-contradictory sample. Now 0.

**The second bug, found by this story's own test (DEC-062).** With the turnaround cue in place it
still did not fire. The cause was in the snapper, not the cues: an out-and-back retraces the *same
polyline*, so every position is exactly equidistant from the outbound and return arms — for the whole
route, not just at the ends like a closed loop. `nearestInWindow` took plain minimum-perpendicular,
so it chose between the arms on floating-point noise: progress leapt to the mirrored position
(1080 m → 1243.9 m on the test route) and then **froze**, because progress may only move forward.
Everything downstream was wrong while frozen — remaining distance, ETA, the ribbon dot — and the
turnaround was skipped by the stale-cue guard.

The fix reuses the tie-break `nearestGlobalNear` already applies at cold start (`SNAP_TIE_BAND_M`,
prefer the progress closest to a target), now available to the windowed search via an optional
`preferProgressM`. Two calibration lessons, both learned by failing tests:
- Preferring "closest to current progress" for *any* tie drags progress **backwards**: on a straight
  stretch a candidate `d` metres behind has a perpendicular distance of about `d`, so it looks like a
  tie. It cost ~128 m of accumulated lag. Hence `SNAP_ARM_SEPARATION_M` — only candidates far apart
  along the route are treated as different arms.
- That separation must also be small enough to defend the fold itself: 100 m left the fold
  undefended (the arms are only ~64 m apart when the rider is 32 m out), which is exactly where the
  turnaround cue lives. 25 m clears the tie band with room to spare and still covers the fold.

Follow-ups discovered (now rows on the board):
- WR-055/056/057 — the junction work this story was originally scoped as; re-split after a design
  red-team showed the single story was too big and partly redundant with existing code.
- WR-058 — curated and AI routes ship `steps: []`, so turn cues, the turn card, and anything built on
  cue points are silently absent on them.
- `spliceRoute` drops the step straddling a reroute rejoin (`wayPoints[0] >= idxAfter`), so the first
  turn after an accepted reroute can go missing. Not filed yet; needs its own investigation.
- The return leg still has no street-level turns. WR-056's turn geometry could synthesise them
  ("turn left", no street name) — better than silence, and honest, since it comes from our own
  polyline rather than a reversed instruction.
