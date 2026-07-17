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
