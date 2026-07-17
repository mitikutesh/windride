# WR-001 · Repo scaffold: Vite + TS + PWA, lint, tests, CI
Epic: 1 · Planner | Status: TODO | Depends on: — | Size: M

## Goal
A running empty PWA with the full quality gate, so every later story lands in a tested,
lint-clean, installable app. This story creates `src/` per ARCHITECTURE §2.

## Context (read first)
CLAUDE.md (all) · ARCHITECTURE §1–3 · DECISIONS DEC-001/002/008 · API_NOTES §6.

## Acceptance criteria
- [ ] `npm create vite` React+TS strict; folder tree exactly per ARCHITECTURE §2 (empty
      modules may export placeholder types, no dead sample code left behind).
- [ ] vite-plugin-pwa configured: installable, offline shell, app name "WindRide", theme
      colour `#0A1220`; placeholder icon set generated.
- [ ] ESLint + Prettier + `npm run lint` clean; import-boundary rule (or documented convention
      check) preventing `src/engine` → adapters/ui imports.
- [ ] Vitest wired with one trivial engine test passing; `npm test` green.
- [ ] `.env.example` per API_NOTES §6; `.env` gitignored; `.gitignore` sane (node, dist, .env).
- [ ] GitHub Actions workflow: install → lint → test → build on push.
- [ ] CLAUDE.md command table verified accurate; README "Prerequisites" still true.

## Test contract
CI green on a fresh clone with no `.env` (tests never require keys — CLAUDE.md rule 3).

## Technical notes
Node 20. Keep dependencies to DEC-002 list + dev tooling; each later story adds its own libs.
Register `maplibre-gl` and `@turf/turf` now (used from WR-005/006 on) but import nowhere yet.

## Out of scope
Any UI beyond a "WindRide" placeholder screen; tokens (WR-002); adapters (WR-003).

## Log
