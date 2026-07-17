# WR-022 · Feels-like elevation chart
Epic: 3 · Conditions | Status: TODO | Depends on: WR-009 | Size: M

## Goal
The most honest chart in cycling: actual elevation profile with a dashed overlay showing the
wind-adjusted "equivalent" profile — headwind rendered as the climb it really is.

## Context (read first)
PRODUCT_SPEC §5 · DESIGN tokens · speed model (WR-007).

## Acceptance criteria
- [ ] Equivalent-grade transform: for each segment, grade' = grade + k·(−v_par)/v0 where k is
      calibrated so 8 m/s direct headwind ≈ +2.5% feel (constant documented + tested); smooth
      over 3 segments.
- [ ] Chart component (SVG, no chart lib): actual area + dashed feels-like line, wind-kind
      colouring under the line, distance axis; renders on a route detail expansion of Results.
- [ ] Tap/drag scrubbing shows values at position (distance, ele, feels-like grade, wind kind).
- [ ] Reduced-motion/no-hover fallback (static labels at extremes).

## Test contract
Transform unit tests (tailwind ⇒ feels-like below actual on flats; still air ⇒ identical);
snapshot of path generation on the golden route.

## Technical notes
Downsample to ≤ 200 chart points; keep the transform in engine/ (pure), the SVG in ui/.

## Out of scope
Interactive route editing.

## Log
