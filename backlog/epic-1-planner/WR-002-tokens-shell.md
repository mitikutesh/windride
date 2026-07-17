# WR-002 · Design tokens + app shell + attribution footer
Epic: 1 · Planner | Status: TODO | Depends on: WR-001 | Size: M

## Goal
The Baltic Dusk skin as CSS variables, base components, a two-screen shell (Plan / Results
placeholder) and the legally required attribution — so all feature UI composes tokens, never
raw hex values.

## Context (read first)
DESIGN.md (all) · PRODUCT_SPEC §5 · DECISIONS DEC-005.

## Acceptance criteria
- [ ] `src/ui/tokens.css`: every value from DESIGN §1–3 as CSS custom properties; no other
      file contains a raw colour hex (lint grep in CI).
- [ ] Fonts self-hosted (Space Grotesk 700, Inter 400/600/700) — no runtime Google request.
- [ ] Components built + storybook-style demo route `/kit`: PrimaryButton, Chip, Toggle,
      StatCell, WindRibbon (accepts `[{fraction, kind: tail|cross|head|shelter}]`), ScoreRing.
- [ ] App shell: header, Plan/Results navigation, footer with "© OpenStreetMap contributors ·
      Weather by Open-Meteo (CC-BY 4.0)".
- [ ] prefers-reduced-motion disables all animation; hit targets ≥ 44 px verified on the kit page.

## Test contract
Component render tests for WindRibbon (fractions sum handling, rounding) and ScoreRing
(0/50/100 arc math). Axe-style a11y smoke on the kit route.

## Technical notes
WindRibbon and ScoreRing are pure presentational (props in, SVG out) — they'll be reused by
Results, Ride and Summary screens. Keep them dependency-free.

## Out of scope
Real Plan inputs (WR-008); map (WR-009).

## Log
