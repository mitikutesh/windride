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
| DEC-012 | WR-006 sequenced before WR-005 (despite the higher ID): the ORS candidate dedupe (WR-005) depends on `engine/geometry.overlapRatio`, so dependency order beats ID order per BACKLOG.md Sequencing rules. | DECIDED |
| DEC-013 | WR-005's live ORS probe (`npm run probe:ors`) is deferred — no `VITE_ORS_API_KEY` in this build environment. The `ors.ts` parser is verified against a hand-crafted closed-loop fixture (`fixtures/ors/roundtrip-sample.geojson`) until the probe can run with a real key and capture small/medium loop fixtures. | DEFAULT-open |
| DEC-014 | `ProviderError` gained an optional machine-readable `code` field (first use: `'roundtrip-cap'`) so the UI can phrase specific unrecoverable errors instead of the generic per-kind retry; the three error kinds (`quota`/`network`/`badResponse`) are unchanged. | DECIDED |
| DEC-015 | WR-007 scoring defaults left underdetermined by SCORING_SPEC: crosswind-safety threshold `crossThreshold = 5 m/s`; `TRAFFIC_WEIGHT` wayClass table (`state road`/`road` 3/2 "heavy", `construction`/`steps` 2, `footway` 1.5, `street`/`unknown` 1, `track`/`path` 0.3, `cycleway` 0, `ferry` 3) — §4's "primary/secondary without cycleway = heavy" rule is PROXIED by ORS waytype since cycleway-adjacency isn't available, so `'state road'`/`'road'` get the heavy weight; Gaussian match sigmas: climb `max(50, 0.4·target)`, distance `0.15·target`; `headwindEmphasis` ramp `1 → 2` linearly over delta 150°–180°. | DEFAULT-open |
| DEC-016 | WR-008 `runPlan` v0.1 samples weather at a single shared column: one `windAlong([start], hours)` call, every segment reads that same start-point hourly series (spatially uniform wind), consistent with `exposure = 1.0` until Epic 3's per-point/shelter-adjusted weather (grid, WR-018/019) replaces it. | DEFAULT-open |
| DEC-017 | WR-009's `src/ui/windColors.ts` is the second sanctioned raw-hex location (after `tokens.css`): MapLibre's WebGL paint can't read CSS custom properties, so it holds a JS mirror of the four semantic wind hues; whitelisted by `scripts/check-tokens.mjs`, kept in sync by a test asserting equality with `tokens.css`. | DECIDED |
| DEC-018 | Route wind-colouring (`classifyWindKind`) classifies each segment by the along/cross angle delta: tail ≤60°, head ≥120°, else cross — so a mildly tailwind-positive 60–90° reads as cross on the map. This is a display threshold for the ribbon/map colouring, distinct from the scoring math's headwind emphasis ramp (DEC-015). | DEFAULT-open |
| DEC-019 | WR-010 planned-route GPX elevation is integrated from segment grade (relative, starting at 0), because `CandidateRoute` stores grade, not absolute per-point elevation; a captured ride's GPX (WR-017) will carry true (device/GPS-derived) elevation instead. | DEFAULT-open |
