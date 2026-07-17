# WR-002 · Design tokens + app shell + attribution footer
Epic: 1 · Planner | Status: DONE | Depends on: WR-001 | Size: M

## Goal
The Baltic Dusk skin as CSS variables, base components, a two-screen shell (Plan / Results
placeholder) and the legally required attribution — so all feature UI composes tokens, never
raw hex values.

## Context (read first)
DESIGN.md (all) · PRODUCT_SPEC §5 · DECISIONS DEC-005.

## Acceptance criteria
- [x] `src/ui/tokens.css`: every value from DESIGN §1–3 as CSS custom properties; no other
      file contains a raw colour hex (lint grep in CI).
- [x] Fonts self-hosted (Space Grotesk 700, Inter 400/600/700) — no runtime Google request.
- [x] Components built + storybook-style demo route `/kit`: PrimaryButton, Chip, Toggle,
      StatCell, WindRibbon (accepts `[{fraction, kind: tail|cross|head|shelter}]`), ScoreRing.
- [x] App shell: header, Plan/Results navigation, footer with "© OpenStreetMap contributors ·
      Weather by Open-Meteo (CC-BY 4.0)".
- [x] prefers-reduced-motion disables all animation; hit targets ≥ 44 px verified on the kit page.

## Test contract
Component render tests for WindRibbon (fractions sum handling, rounding) and ScoreRing
(0/50/100 arc math). Axe-style a11y smoke on the kit route.

## Technical notes
WindRibbon and ScoreRing are pure presentational (props in, SVG out) — they'll be reused by
Results, Ride and Summary screens. Keep them dependency-free.

## Out of scope
Real Plan inputs (WR-008); map (WR-009).

## Log
Shipped: `src/ui/tokens.css` (wind hues, Baltic Dusk core, aurora gradient, radii, 8-pt spacing,
type + motion tokens, `--hit-min: 44px`) as the sole raw-hex file; `scripts/check-tokens.mjs`
enforces this and is wired into `npm run lint`/CI. Self-hosted Space Grotesk 700 + Inter
400/600/700 (woff2, `src/ui/fonts.css`, `font-display: swap`, precached by the service worker) —
no runtime Google Fonts request. Built PrimaryButton, Chip, Toggle, StatCell, WindRibbon,
ScoreRing under `src/ui/components/`, dependency-free, with pure `ribbon.ts`/`ring.ts` helpers
unit-tested in isolation. App shell (`src/ui/AppShell.tsx`) with aurora header, Plan/Results/Kit
nav (`aria-current`), and the required attribution footer verbatim. Routing via a minimal
dependency-free hash router (`src/ui/useHashRoute.ts`) — see DEC-010. `/kit` is the component
gallery demo route; Plan/Results are placeholders pending WR-008/WR-009. Global
`prefers-reduced-motion` disables all animation/transition; 44 px hit targets enforced via
`--hit-min` and guarded by `src/ui/hitTargets.test.ts`. 18 tests passing (ribbon/ring math,
WindRibbon/ScoreRing render, KitScreen axe-core a11y + toggle interaction, hit-target CSS guard,
WR-001 engine constant); `npm run lint` and `npm run build` green.

Scope note: `check-tokens.mjs` only scans `src/` styling/components — the PWA manifest theme
colours in `index.html`/`vite.config.ts` are unavoidable literal hex (manifest/meta requirements)
and are intentionally out of scope.

Decision: kept the hash router dependency-free instead of adding `react-router` for a two/three
route shell — logged as DEC-010, DEFAULT-open, revisit if routing needs grow in WR-008/WR-009.

Follow-ups: WR-008 replaces the Plan placeholder with real inputs; WR-009 replaces the Results
placeholder with the MapLibre map and route cards, reusing WindRibbon/ScoreRing as-is.

### Fable 5 review pass — fixes
- Fonts: previous woff2 were byte-identical Inter variable files under static names plus a
  mislabeled Space Grotesk build. Replaced with proper latin-subset VARIABLE woff2 sourced from
  @fontsource-variable (OFL): `public/fonts/inter-latin-var.woff2` (wght 100–900) and
  `space-grotesk-latin-var.woff2` (wght 300–700); `src/ui/fonts.css` now declares variable
  `@font-face` with weight ranges; added `inter-OFL.txt`/`space-grotesk-OFL.txt`; temporary
  @fontsource dev deps removed after copying — still fully self-hosted, no runtime Google request.
- DESIGN §1 compliance: Toggle on-state track no longer uses wind hue `--tail`; uses core accent
  `--sky` (switch state isn't a wind relationship).
- a11y: primary nav is now real anchors (`<a href="#/plan">`) instead of buttons — copyable/
  openable links, announced as links; `onNavigate` prop removed; hashchange listener still drives
  the screen swap; `.wr-navlink` styled inline-flex, `text-decoration:none`.
- Token guard hardened: `scripts/check-tokens.mjs` also flags colour-function literals
  (rgb/rgba/hsl/hsla/hwb/lab/lch/oklab/oklch/color()) alongside hex, closing the bypass
  (`color-mix()` intentionally not matched).
- ScoreRing rounds the displayed numeral and aria-label (scoring will emit floats); arc geometry
  stays continuous.
- WindRibbon/`ribbon.ts` drops non-positive fractions instead of emitting zero-width rects or
  "0% ..." in the accessible label.
- Tests: axe a11y smoke now renders the full route (`<App/>` at `#/kit`) so header/nav/footer are
  scanned too; added a ScoreRing float-rounding test and a prefers-reduced-motion assertion in the
  design-guard test. Suite now 20 passing.
- `tokens.css`: added shared `--aurora-a`/`--aurora-b` endpoints used by both the aurora gradient
  and ScoreRing stops so a skin swap keeps them in sync.
- KitScreen copy uses ">=" (U+2265 is outside the latin font subset).
