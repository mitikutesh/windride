# Decision log

Agents: check here before guessing. To add: next DEC number, one line of context, the decision,
status (DECIDED / DEFAULT-open), date, story that triggered it.

| ID | Decision | Status |
|---|---|---|
| DEC-001 | Platform: **PWA-first** (Vite + `vite-plugin-pwa`). Dev/testing on desktop + Android Chrome. iOS = install-to-home-screen, screen-on navigation is acceptable. Native wrap only if screen-off recording ever becomes essential. | DECIDED |
| DEC-002 | Framework: **React 18 + TypeScript (strict) + Vite**. State: **zustand**. Map: **MapLibre GL JS** with OpenFreeMap `liberty` style. Geometry: **@turf/turf**. Storage: **idb**. Tests: **Vitest**. | DECIDED |
| DEC-003 | App name: **WindRide** (owner verified stores/domains separately). Package `windride`. | DECIDED |
| DEC-004 | Baseline rider speeds (flat, still air): road 27 km/h, gravel 21 km/h; assumed power 180 W for the physics model. Stored in settings, calibrated in WR-024. | DEFAULT-open |
| DEC-005 | Visual direction: **Direction 01 "Baltic Dusk" tokens** for v0.1 (simplest to implement); Directions 02/03 remain candidates post-v0.2. Tokens isolated in `src/ui/tokens.css` so a swap is one file. | DEFAULT-open |
| DEC-006 | Exposure grid: Uusimaa only, 250 m cells, shipped as static JSON (< 5 MB budget). | DEFAULT-open |
| DEC-007 | No backend of any kind before the commercial gate (PRODUCT_SPEC). Anything needing a server is out of scope or redesigned client-side. | DECIDED |
| DEC-008 | Units: SI internally; degrees clockwise from true north; UI converts at the edge. | DECIDED |
| DEC-009 | Module boundaries enforced via ESLint `no-restricted-imports`/`no-restricted-properties` in `eslint.config.js` (no separate boundaries plugin); `engine/constants.ts` is the one file beyond the exact ARCHITECTURE §2 list, holding shared SCORING_SPEC constants. | DECIDED |
| DEC-010 | App shell routing (WR-002): default to a minimal dependency-free hash router (`src/ui/useHashRoute.ts`) over adding `react-router` for the plan/results/kit shell. Revisit if routing needs grow in WR-008/WR-009. | DEFAULT-open |
| DEC-011 | Domain types (WR-003) live at `src/domain.ts` (root), not under `adapters/`, so `engine/**` can import them without violating the engine-never-imports-adapters module-boundary rule. | DECIDED |
