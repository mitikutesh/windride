# CLAUDE.md — WindRide agent operating manual

You are building **WindRide**, a wind-aware cycling route planner PWA. It generates candidate
routes, scores them against today's wind/shelter/weather using time-weighted physics, shows the
top 3 with honest wind-aware ETAs, and later navigates the chosen track with live wind cues.
Personal-use, zero-cost: client-side only, free API tiers, no backend, local data.

Read `docs/PRODUCT_SPEC.md` for the why. This file is the how.

## Golden rules

1. **One story per session.** Pick the lowest-numbered `TODO` story in `backlog/` whose
   `Depends on` list is all `DONE`. Never work on two stories at once. Never skip ahead.
2. **Read before you write.** Read the story file AND every doc section it links before coding.
3. **Never call live APIs from tests or CI.** Engine and adapter tests run on `fixtures/` only.
   Live calls happen only in `npm run dev` with a real key in `.env`. Free tiers are a budget:
   stay under ~30 openrouteservice calls per dev session.
4. **Module boundaries are law** (see `docs/ARCHITECTURE.md`): `src/engine/**` is pure functions
   — no I/O, no DOM, fully unit-tested. `src/adapters/**` is the only place `fetch` may appear.
   UI never fetches directly.
5. **TypeScript strict. No `any` in `src/engine`.** Lint and tests must pass before a story closes.
6. **Secrets:** only via `.env` (gitignored). `.env.example` documents required keys. Never
   commit or print keys.
7. **Don't stall on ambiguity.** Check `docs/DECISIONS.md`. If undecided, add a `DEC-xxx` entry
   with your proposed default + rationale, proceed with it, and flag it in the story Log.
8. **Update the board.** On completion: tick the story's acceptance boxes, set its Status to
   DONE, update the row in `backlog/BACKLOG.md`, append a short `## Log` entry (what/decisions/
   follow-ups) to the story file.

## Domain warnings (bugs waiting to happen — respect these)

- **Wind direction convention.** Forecast `wind_direction` is meteorological: the direction wind
  comes FROM. Travel frame: `wind_to = (wind_from + 180) % 360`. Tailwind when the angular
  difference between segment bearing and `wind_to` is small. The must-pass case in
  `docs/SCORING_SPEC.md §2` (bearing 45°, wind_from 225° ⇒ pure tailwind) guards the sign.
- **Loops cancel.** On any closed loop in uniform wind, along-wind projected distance sums to
  ~zero: `Σ Lᵢ·cos(Δᵢ) ≈ 0`. Never present or compute "net tailwind" for a loop. The product
  levers are crosswind conversion, shelter, sequencing, time-weighting (PRODUCT_SPEC §1).
- **Weight by time, not distance.** Headwind kilometres take longer; every score and ETA uses
  segment *time* from the speed model.
- **Self-crossing routes.** Navigation snap must use a windowed search along the polyline
  (±300 m of last progress), never global nearest-point (NAVIGATION_SPEC §2).
- **Strava is upload-only.** Single-player API app; Strava data must never enter scoring or any
  ML/AI path (their terms). Our own recordings are the primary data.

## Testing policy (pyramid)

- **Engine (`src/engine`)**: many fast unit tests; golden cases from SCORING_SPEC; property-style
  sanity tests (loop cancellation, monotonicity: more headwind ⇒ never higher WindComfort).
- **Adapters**: contract tests against `fixtures/` (shape parsing, error paths, retry/cache).
  One manually-run integration script per adapter (`npm run probe:ors` etc.) for live checks.
- **Navigation**: integration tests driven by the GPX replay harness (WR-012) — no bike needed.
- **UI**: light — render + key interaction tests for Plan/Results screens; no visual regression.
- Coverage target: engine ≥ 90% lines, adapters ≥ 80%. Do not chase UI coverage numbers.

## Conventions

- Commits: Conventional Commits scoped by story — `feat(WR-007): time-weighted wind subscore`.
  One story may span several commits; the final commit closes it: `feat(WR-007): ... [closes WR-007]`.
- Branch: work on `main` (solo project), keep it green.
- Code style: Prettier defaults + ESLint (configured in WR-001). Filenames: `camelCase.ts`,
  components `PascalCase.tsx`.
- Units: SI internally (metres, m/s, seconds, degrees 0–360 clockwise from north). Convert at
  the UI edge only (km, km/h, h:mm).
- Every user-facing time estimate must come from the speed model — no naive distance/speed math.

## Session ritual

1. Announce: story ID, goal, files you expect to touch, test plan.
2. Implement. Write engine tests first for engine stories.
3. `npm test && npm run lint && npm run build` — all green (after WR-001 exists).
4. Update story file (boxes, Status, Log) + BACKLOG.md row.
5. Summarize: what shipped, decisions made, anything discovered for future stories.

## Commands (defined by WR-001; keep this table in sync)

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (PWA) |
| `npm test` | Vitest, fixtures only |
| `npm run lint` | ESLint + Prettier check |
| `npm run build` | Production build |
| `npm run replay` | GPX replay harness (after WR-012) |
| `npm run probe:<adapter>` | Manual live API smoke check (never in CI) |

## Repo map

docs/ (specs) · backlog/ (stories — the work queue) · src/ (created by WR-001) ·
fixtures/ (API samples, golden cases) · tools/ (offline preprocessing, Python) ·
public/ (PWA assets)
