# WindRide — Agentic Development Kit

**WindRide** is a wind-aware cycling route planner: it *generates* routes shaped by today's wind,
shelter, weather and daylight, then navigates you through them. Zero-cost personal build first
(PWA, free APIs, no backend), commercial option preserved.

This repository contains **no application code yet — by design.** It is a complete specification
and story backlog for AI coding agents (Claude Code) to build the app one story at a time.
The first story (`WR-001`) bootstraps the codebase.

## How to use this kit

1. **Prerequisites:** Node 20+, git, a free openrouteservice API key (openrouteservice.org →
   sign up → token). Copy `.env.example` to `.env` and fill it in.
2. **Open this folder with Claude Code** (or your Claude agent of choice).
3. **Paste the kickoff prompt:**

   > Read CLAUDE.md fully, then skim docs/. Pick the lowest-numbered story in backlog/ whose
   > dependencies are DONE (start: WR-001) and execute it end-to-end following the session
   > ritual in CLAUDE.md. Work on exactly one story. Stop when its Definition of Done is met.

4. **Repeat.** Each session = one story. Say *"next story"* and the agent finds its own work
   from `backlog/BACKLOG.md`.

## What's where

| Path | Contents |
|---|---|
| `CLAUDE.md` | The agent operating manual — rules, conventions, session ritual, domain warnings |
| `docs/PRODUCT_SPEC.md` | What WindRide is, the physics thesis, features in/out |
| `docs/ARCHITECTURE.md` | Stack, folder map, module boundaries, adapter interfaces |
| `docs/SCORING_SPEC.md` | The wind-scoring algorithm: math, weights, must-pass test cases |
| `docs/NAVIGATION_SPEC.md` | Track-following navigation spec |
| `docs/DESIGN.md` | Design tokens (semantic wind colours), components, UI rules |
| `docs/API_NOTES.md` | Verified provider facts: limits, endpoints, budgets, keys |
| `docs/DECISIONS.md` | Decision log — check here before asking or guessing |
| `backlog/BACKLOG.md` | Story index, status board, sequencing rules |
| `backlog/epic-*/WR-0xx-*.md` | 28 stories with acceptance criteria and test contracts |
| `fixtures/` | Illustrative API response shapes (replaced by captured ones in WR-004/005) |
| `tools/` | Offline preprocessing (exposure grid) — created by WR-018 |

## Roadmap shape

- **Epic 1 · Planner (v0.1)** — WR-001…011: inputs → candidates → scoring → top-3 map → GPX
- **Epic 2 · Navigator (v0.2)** — WR-012…017: replay harness first, then GPS, cues, recording
- **Epic 3 · Conditions Brain (v0.3)** — WR-018…024: shelter grid, start-time optimizer, Strava
- **Epic 4 · Signature (v0.4)** — WR-025…028: robustness, downwind one-ways, winter, novelty

License: private personal project (no license granted). Map data © OpenStreetMap contributors
(ODbL). Weather by Open-Meteo (CC-BY 4.0) — attribution is wired into the UI by WR-002.
