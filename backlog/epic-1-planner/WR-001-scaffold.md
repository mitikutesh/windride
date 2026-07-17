# WR-001 · Repo scaffold: Vite + TS + PWA, lint, tests, CI
Epic: 1 · Planner | Status: DONE | Depends on: — | Size: M

## Goal
A running empty PWA with the full quality gate, so every later story lands in a tested,
lint-clean, installable app. This story creates `src/` per ARCHITECTURE §2.

## Context (read first)
CLAUDE.md (all) · ARCHITECTURE §1–3 · DECISIONS DEC-001/002/008 · API_NOTES §6.

## Acceptance criteria
- [x] `npm create vite` React+TS strict; folder tree exactly per ARCHITECTURE §2 (empty
      modules may export placeholder types, no dead sample code left behind).
- [x] vite-plugin-pwa configured: installable, offline shell, app name "WindRide", theme
      colour `#0A1220`; placeholder icon set generated.
- [x] ESLint + Prettier + `npm run lint` clean; import-boundary rule (or documented convention
      check) preventing `src/engine` → adapters/ui imports.
- [x] Vitest wired with one trivial engine test passing; `npm test` green.
- [x] `.env.example` per API_NOTES §6; `.env` gitignored; `.gitignore` sane (node, dist, .env).
- [x] GitHub Actions workflow: install → lint → test → build on push.
- [x] CLAUDE.md command table verified accurate; README "Prerequisites" still true.

## Test contract
CI green on a fresh clone with no `.env` (tests never require keys — CLAUDE.md rule 3).

## Technical notes
Node 20. Keep dependencies to DEC-002 list + dev tooling; each later story adds its own libs.
Register `maplibre-gl` and `@turf/turf` now (used from WR-005/006 on) but import nowhere yet.

## Out of scope
Any UI beyond a "WindRide" placeholder screen; tokens (WR-002); adapters (WR-003).

## Log
- Shipped: manual Vite 5 + React 18 + TS strict scaffold (no interactive-CLI leftovers); full
  `src/` tree per ARCHITECTURE §2 (adapters/{weather,routing,transit,strava}, engine/, nav/,
  state/, ui/{screens,components,tokens.css}, data/, utils/), each placeholder stub naming its
  owning story. vite-plugin-pwa wired (installable, autoUpdate SW, offline shell, name
  "WindRide", theme/background `#0A1220`); placeholder icon set generated (192/512/maskable/
  apple-touch/favicon, Baltic Dusk + aurora accent). ESLint 9 flat config + Prettier clean via
  `npm run lint`; Vitest wired with one trivial engine test green. `.env.example` per
  API_NOTES §6; `.env`, `*.tsbuildinfo`, `dev-dist/` gitignored. `.github/workflows/ci.yml`
  runs install → lint → test → build on Node 20 for push/PR to main, no `.env` needed. Deps
  match DEC-002 (react, react-dom, zustand, maplibre-gl, @turf/turf, idb) + dev tooling;
  maplibre-gl/@turf/turf installed but unused until WR-005/006. CLAUDE.md command table and
  README Prerequisites verified accurate.
- Decisions: added `src/engine/constants.ts` (SEGMENT_TARGET_M/MIN/MAX per SCORING_SPEC §1) as
  the one file beyond the exact ARCHITECTURE §2 list — home for shared engine constants and the
  scaffold's trivial test subject. Import-boundary rule implemented via ESLint
  `no-restricted-imports`/`no-restricted-properties` (engine can't import adapters/ui/state/nav/
  data or call `Date.now`; ui can't import adapters) rather than a separate boundary plugin —
  simpler, zero extra dependency, enforced and verified to fire.
- Follow-ups: WR-002 owns tokens.css content + app shell; WR-003 fills adapter interfaces/mock
  providers; WR-005/006 give maplibre-gl and @turf/turf their first real imports; WR-012+ add
  `npm run replay` and `npm run probe:<adapter>` to the command table.
- Fable 5 review follow-up (post-close hardening): found and fixed two module-boundary
  enforcement gaps in `eslint.config.js` — (1) the engine-purity rule only blocked deep imports
  like `../state/x`, not bare-directory barrel imports like `../state` or `../nav`; group
  patterns extended to cover both `**/x` and `**/x/**` for adapters/ui/state/nav/data; (2) the
  "UI never imports adapters" rule didn't cover the src-root entry/App files, only `src/ui/**`;
  `files` glob extended with `src/*.{ts,tsx}` and its group blocks both `**/adapters` and
  `**/adapters/**`. Both gaps verified to fire (deep and barrel imports alike are now caught).
  Also corrected a misleading comment implying `state/**` can't import adapters (stores do call
  adapters per ARCHITECTURE §3). Minor nits: added `apple-touch-icon` link in `index.html`;
  added `environmentMatchGlobs` in `vite.config.ts` so future UI tests (WR-008/009) run under
  jsdom while engine/adapter tests stay on node; DEC-009 added to DECISIONS.md and README's
  "no application code yet" line corrected to reflect the scaffold now existing. Quality gate
  (test/lint/build) re-verified green after fixes.
