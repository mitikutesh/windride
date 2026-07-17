# WR-022 · Feels-like elevation chart
Epic: 3 · Conditions | Status: DONE | Depends on: WR-009 | Size: M

## Goal
The most honest chart in cycling: actual elevation profile with a dashed overlay showing the
wind-adjusted "equivalent" profile — headwind rendered as the climb it really is.

## Context (read first)
PRODUCT_SPEC §5 · DESIGN tokens · speed model (WR-007).

## Acceptance criteria
- [x] Equivalent-grade transform: for each segment, grade' = grade + k·(−v_par)/v0 where k is
      calibrated so 8 m/s direct headwind ≈ +2.5% feel (constant documented + tested); smooth
      over 3 segments.
- [x] Chart component (SVG, no chart lib): actual area + dashed feels-like line, wind-kind
      colouring under the line, distance axis; renders on a route detail expansion of Results.
- [x] Tap/drag scrubbing shows values at position (distance, ele, feels-like grade, wind kind).
- [x] Reduced-motion/no-hover fallback (static labels at extremes).

## Test contract
Transform unit tests (tailwind ⇒ feels-like below actual on flats; still air ⇒ identical);
snapshot of path generation on the golden route.

## Technical notes
Downsample to ≤ 200 chart points; keep the transform in engine/ (pure), the SVG in ui/.

## Out of scope
Interactive route editing.

## Log
- Implemented `src/engine/feelsProfile.ts` (pure): `equivalentGrade(gradePct, vParMs) = grade +
  FEEL_K_PCT·(−v_par)/FEEL_REF_WIND_MS` with documented constants `FEEL_K_PCT = 2.5` and
  `FEEL_REF_WIND_MS = 8` (an 8 m/s direct headwind adds +2.5% "feel"; tailwind subtracts).
  `buildFeelsProfile(segments, maxPoints = 200)` smooths **only the wind contribution** over a
  3-segment window (base grade untouched) — so a still-air profile is identical to the actual
  one — integrates both actual and feels grades into cumulative elevation, and downsamples to
  ≤ 200 points keeping first + last.
- Implemented `src/ui/components/FeelsChart.tsx` (SVG, no chart lib): actual elevation as a
  filled area, wind-equivalent feels-like as a dashed line, a wind-kind strip along the base
  (`windColor`), and a distance axis. Pointer scrubbing shows a readout (distance, elevation,
  feels-like grade, wind kind) with a cursor line; a no-pointer/reduced-motion fallback shows
  static labels at the extremes. Rendered on the Results route-detail `<details>` expansion for
  the selected route. Styling is tokens-only.
- Tests: `src/engine/feelsProfile.test.ts` (7 — equivalentGrade still-air/headwind/tailwind;
  still-air profile identical to actual; tailwind-on-flats drops below / headwind climbs above;
  ≤ 200-point downsample; golden profile snapshot) and
  `src/ui/components/FeelsChart.test.tsx` (2 — renders actual area + dashed feels line + one
  wind-kind strip rect per interval + fallback readout; renders nothing for a < 2-point
  profile). Full suite: 303 tests, lint clean, build OK.
- Test contract satisfied: transform unit tests (tailwind ⇒ feels below actual on flats; still
  air ⇒ identical) plus a snapshot of profile/path generation on a golden route.

## Review pass — fixes
Reviewed by a substitute senior reviewer (Opus) — the Fable 5 model was out of usage credits this
session. Verdict was REQUEST-CHANGES; all findings below are now addressed.

- **BLOCKER B1 — distance axis ticked but not implemented.** The acceptance box claimed a
  distance axis, but the chart only had a caption — no axis was actually rendered. Fixed:
  `FeelsChart` now renders a distance-axis baseline plus tick labels at 0/25/50/75/100% of the
  route (in km) in the reserved bottom margin. A new test asserts the axis line and ≥ 3 tick
  labels are present.
- **SHOULD-FIX S1 — unit-tested `equivalentGrade` wasn't the code that shipped.**
  `buildFeelsProfile` re-implemented the wind-grade formula inline, so the calibration tests on
  `equivalentGrade` didn't actually guard the shipping path. Fixed: extracted
  `windExtraGrade(vPar)`; `equivalentGrade = grade + windExtraGrade(vPar)`, and
  `buildFeelsProfile`'s wind term now calls the same `windExtraGrade` — one formula, shared, so
  the existing calibration test now guards what actually ships.
- **SHOULD-FIX S2 — scrubbing (the primary interaction) had no coverage.** Added a scrub test
  that stubs `getBoundingClientRect` width and dispatches a `MouseEvent` typed `'pointermove'`
  (jsdom's native `PointerEvent` drops `clientX`), asserting the readout (distance / elevation /
  feels-grade / wind kind) updates and the cursor line is drawn.
- **SHOULD-FIX S3 — `onMove` divided by `rect.width` with no guard.** A zero-width or detached
  SVG produced `NaN`, which pinned the scrub position to the start. Fixed: early-return when
  `rect.width` is 0.
- **Deferred NITs (noted honestly, not fixed this pass):**
  - N1 — the wind-kind strip loses fidelity after the ≤ 200-point downsample on very long routes;
    a majority-kind pass per bucket is a possible later refinement.
  - N2 — the strip uses `classifyWindKind` (tail/head/cross), so it never shows the shelter hue;
    shelter is unreachable in this chart (the dashed feels-line already reflects exposure via
    `v_par`).
  - N3 — the synthetic start point's kind is hardcoded `'cross'`; only affects the scrub readout
    at distance 0.
  - N4 — the no-pointer fallback labels peak height as "climb", not total ascent.
  - N5 — `buildFeelsProfile` could be `useMemo`'d.
  - N6 — reduced-motion is satisfied by the static default (no animations) rather than an
    explicit `prefers-reduced-motion` branch.
- Gate after fixes: **305 tests**, lint clean, build OK.
