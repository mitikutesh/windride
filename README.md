# WindRide — Agentic Development Kit

**WindRide** is a wind-aware cycling route planner: it *generates* routes shaped by today's wind,
shelter, weather and daylight, then navigates you through them. Zero-cost personal build first
(PWA, bring-your-own free API keys). Planning and navigation run entirely in the browser and need
no account; an OPTIONAL free account adds a thin serverless backend (Epic 5, AWS) that syncs saved
routes across devices — API keys always stay in the browser and never sync (DEC-040).

This repository is a complete specification and story backlog for AI coding agents (Claude Code)
to build the app one story at a time. `WR-001` has bootstrapped the codebase — the scaffold and
quality gate (lint, tests, build, CI) are in place — and every later story builds on it.

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

## Strava upload (optional, 5-minute setup)

Finished rides can be sent to your own Strava with one tap — upload-only, nothing is ever read
back (see `docs/API_NOTES.md` §4 and `docs/DECISIONS.md` DEC-027).

1. Create a Strava API app at https://www.strava.com/settings/api (Authorization Callback Domain:
   `localhost`). Note its Client ID and Client Secret.
2. Run the one-time local OAuth helper (never in CI, never checked in):

   ```
   STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... node tools/strava-auth.mjs
   ```

3. Authorise the `activity:write` scope in the browser tab it opens. The script prints (and
   saves to gitignored `tools/.strava.json`) a `clientId` / `clientSecret` / `refreshToken` set.
4. Paste those three values into the app's **Kit → Strava settings** panel. They're stored in
   idb on your device only — never in `.env`/Vite env, never bundled, never sent anywhere but
   Strava's own API.

Once set up, finished rides in Ride History get a "Send to Strava" button.

## Deploy (GitHub Pages)

The WindRide app is a static PWA, so it hosts anywhere. A GitHub Pages workflow is included
(`.github/workflows/deploy.yml`); AWS S3+CloudFront hosting + the optional serverless backend live
in `infra/` (Epic 5, deployed separately). The app works fully without the backend.

1. One-time: repo **Settings → Pages → Source = "GitHub Actions"**.
2. Push to `main` (or run the "Deploy to GitHub Pages" workflow manually). It builds with
   `VITE_BASE=/windride/` and publishes to `https://<user>.github.io/windride/`.

**Keys are never baked into the deployed build.** It ships live-by-default (`VITE_LIVE_APIS=true`)
with no API key, so every visitor brings their own via **Kit → API keys** (stored in their own
browser only). First-timers see a prompt on the Plan screen linking there. Never put
`VITE_ORS_API_KEY` in the workflow — a `VITE_`-prefixed value is bundled into the public JS.

To host elsewhere (Netlify, Vercel, Cloudflare Pages): `npm run build` and serve `dist/` at the
site root (omit `VITE_BASE`); set `VITE_LIVE_APIS=true` for the build.

License: private personal project (no license granted). Map data © OpenStreetMap contributors
(ODbL). Weather by Open-Meteo (CC-BY 4.0) — attribution is wired into the UI by WR-002.
