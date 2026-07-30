# WR-052 · Curated Finland route catalog → static S3 asset → wind-scored discovery
Epic: 7 · Curated Routes | Status: DONE | Depends on: WR-047 | Size: L

## Goal
Give the planner a second discovery source besides AI bearings: real, officially curated Finnish
routes — Bikeland national routes and EuroVelo legs, plus OSM signed cycle-route networks.
True "high-rated" data (komoot highlights, Strava popularity) is locked behind partner-only or
restricted APIs, but "curated and physically signed" is a better quality signal anyway.
Crucially, users never call Bikeland or Overpass: a manual `tools/` script ingests and
normalises everything ONCE into a compact catalog JSON that ships as a static asset on the
existing S3+CloudFront deploy — the same pattern as the exposure grid. The client fetches the
same-origin catalog, filters to day-rideable routes near the start, and ranks the survivors
with the EXISTING engine. Known-good Finnish routes, ordered by today's wind.

## Context (read first)
- CLAUDE.md rules 3 (no live APIs in tests/CI) and 4 (fetch only in adapters) + domain warnings
  (loops cancel — never show "net tailwind" on a loop; Strava never enters scoring).
- WR-047 Log — `scoreBuiltRoutes` (`src/state/plan/scoreRoutes.ts`) scores pre-built routes
  through the same engine block as `runPlan`; the provenance-not-evidence display convention;
  the `disc-` id-prefix gating trick.
- WR-018 + `public/data/exposure-uusimaa.json` — the static-data-asset pattern this story
  copies; `tools/fetch_stations.mjs` — the manual fetch-script pattern (merge, never CI).
- DEC-056 (deploys are manual dispatch only), DEC-057 (ProviderError taxonomy),
  DEC-060 (this story's architecture decision + defaults).
- docs/API_NOTES.md — add sections for Overpass and Bikeland while implementing.

## Acceptance criteria
- [x] `tools/fetch_curated_routes.mjs` (manual, never CI — like `fetch_stations.mjs`) builds
      `public/data/curated-fi.json` from two sources: (a) Bikeland GPX files the owner
      downloads by hand into `tools/curated_in/` (gitignored; bikeland.fi has no API — no
      scraping, respect their terms), and (b) ONE polite Overpass query for signed cycle-route
      relations (`relation["route"="bicycle"]`, network icn/ncn/rcn) in a Finland bbox.
- [x] Catalog entries carry: stable id, name, source (`bikeland` | `osm`), curation tier
      (icn/ncn/rcn or `curated`), route kind (loop | linear), length km, bbox, simplified
      geometry, attribution string. Geometry is simplified (~15 m tolerance, endpoints kept
      exact) and the whole file stays under ~1.5 MB raw; the tool prints per-source counts +
      final size and FAILS the budget loudly — it never silently drops routes to fit.
- [x] New adapter `src/adapters/curatedRoutes.ts` — the only fetch; lazily loads + caches the
      same-origin catalog; typed parse with per-entry validation (a malformed entry is dropped
      with a console warning, never crashes the catalog); failures use the DEC-057 taxonomy.
- [x] Plan screen gains "Curated routes near me" (same equal-weight button pattern as AI
      discovery, DEC-055c): filter the catalog to routes passing within ~5 km of the start
      whose length fits the target-distance band (defaults in DEC-060), cap at 3, run them
      through `scoreBuiltRoutes` (WR-047), and publish to Results with provenance badges
      (source + official route name), ids prefixed `cur-` so curated provenance can never leak
      onto an ordinary plan's results.
- [x] Engine stays authoritative: catalog data never alters a score, an ETA, or a geometry;
      curation tier is provenance display only, never a score input. No Strava data anywhere
      in the path.
- [x] ODbL attribution for OSM-derived entries and a Bikeland credit appear via the
      attribution footer (WR-002) when curated data is shown.
- [x] Zero new infra: the catalog deploys as part of the existing app artefact via
      `deploy-aws.yml` manual dispatch (DEC-056). No new bucket, no Lambda, no key, no
      third-party runtime dependency.

## Test contract
Tool: the transform core is a pure, unit-testable function (GPX fixture + Overpass fixture in
`fixtures/curated/` → snapshot of catalog entries; an oversize-geometry fixture trips the size
guard). Adapter: contract tests on a catalog fixture (happy parse, malformed-entry drop, fetch
failure taxonomy). Store: filter logic (near/far start, too-long/too-short, cap at 3) + scored
publish with mocked providers, same style as the discoveryStore tests. No live calls anywhere
in tests/CI; the tool's live path is exercised manually (`node tools/fetch_curated_routes.mjs`).

## Technical notes
- Overpass: single bbox query with `out geom`, honest User-Agent, one retry with backoff —
  overpass-api.de usage policy is comfortable with a manual once-in-a-while script. Long
  relations (EuroVelo) arrive as many member ways: stitch them in order, tolerate small gaps.
- Simplification: `@turf/simplify` (already a dependency) on the stitched line.
- Long linear touring routes (the ~1100 km Coastal Route) will fail the length band and simply
  not appear near most starts — correct v1 behaviour; day-slicing is a follow-up story.
- Linear (A→B) day routes are legitimate candidates — the scorer and ETA handle them; loops
  obey the loops-cancel display rule as always.
- Catalog refresh = re-run tool + commit + manual deploy; these routes change ~yearly, so no
  automation, no cron, no cost.

## Out of scope
Day-slicing long touring routes into ride-length segments (follow-up) · LIPAS ingestion
(revisit if Bikeland+OSM coverage disappoints) · any per-user calls to Bikeland/Overpass ·
popularity/heatmap data (Strava-shaped — banned) · komoot (no public API).

## Log
Shipped 2026-07-30. A second discovery source that needs no key and no per-user third-party call:
138 officially signed Finnish cycle routes, ranked by today's wind through the existing engine.

**What shipped**
- `tools/curatedCatalog.mjs` — the PURE transform core (GPX parse, Overpass stitch, metric
  simplification, catalog assembly, size report). No I/O, no clock: that is what makes it testable.
- `tools/fetch_curated_routes.mjs` — the manual I/O runner (Bikeland GPX from `tools/curated_in/`,
  ONE Overpass query, report, write). `--cache` / `--from-cache` keep transform tuning offline;
  `--skip-overpass` builds from GPX alone. Never in CI.
- `public/data/curated-fi.json` — generated live: 138 routes (7 icn, 28 ncn, 103 rcn), 0.68 MB of
  the 1.5 MB budget, 26 of them inside a 40 km day-ride band. Bikeland GPX still to be added by
  hand (no API); the catalog is OSM-only until then.
- `src/adapters/curatedRoutes.ts` — the only fetch, same-origin, memoised on success only, per-entry
  validation (bad entry dropped + warned, never a dead catalog), DEC-057 failure taxonomy.
- `src/engine/curated.ts` — pure shortlist: bbox pre-reject → point-to-polyline distance → length
  band → 5 %-bucketed length fit, nearer start breaks ties → cap 3. Plus `curationLabel`.
- `src/state/curatedStore.ts` — load → shortlist → `scoreBuiltRoutes` (WR-047) → publish, with
  `cur-` ids and `curatedFailureReason` copy.
- UI: `CuratedRoutesButton` (Plan, always available — no key needed), `CuratedBadge` (Results
  provenance), `CuratedCredit` (footer attribution, gated on `cur-` results being on screen).

**Decisions made (folded into DEC-060)**
1. *The ±15 % hard distance filter is relaxed for curated candidates only.* `scoreCandidates`
   rejects anything outside ±15 % of target — correct for GENERATED round trips, fatal here: every
   selected route sits in the 0.6–1.6× band, so the button would reliably return "nothing fits".
   `ScoreRoutesOpts.distanceTolerancePct` now covers the selection band for this path; the distance
   sub-score still ranks by closeness, so an off-target route is shown but never wins on distance.
2. *Fragmented relations keep their longest chain and say so.* Gaps over 100 m are never bridged.
   When the kept chain is under 90 % of the relation's mapped length the entry gets `partial: true`
   and the badge reads "mapped in pieces — longest continuous section" (42 of 138 on the live run).
3. *No elevation, stated plainly.* The catalog stores geometry only, so curated ETAs are
   flat-profile. The badge says it rather than dressing it up.
4. *The empty state distinguishes its two causes* (`curatedCoverage` + `noMatchReason`). Testing
   against the real catalog showed the original "no curated routes, try a different distance" copy
   is a dead end: near Espoo three curated routes DO pass nearby and are simply too short, while
   near Helsinki centre nothing is mapped within 5 km at all. Those need different actions, so the
   message now names which it is — "3 curated routes pass near you, but none is 24–64 km. The
   closest is “Olarinbaana” at 8.5 km" vs "No curated route passes within 5 km of your start. The
   nearest is “Jakomäenbaana”, 7.2 km away."

**Coverage, measured (worth knowing before riding on it)**
OSM signed-network coverage is uneven and the catalog is OSM-only until Bikeland GPX is added by
hand. Oulu returns real 40 km candidates; Helsinki/Espoo do not — the capital's signed network is
mapped as short 5–12 km "baana" corridors, none of which reaches a day-ride band. This is a data
fact, not a bug, and it is exactly the trigger the story named for the LIPAS fallback. Adding the
Bikeland GPX (curated Uusimaa day routes) is the cheapest fix and needs only a manual download.

**Verification**
`npm test` 742 passing (105 files) · `npm run lint` clean · `npm run build` clean, and
`dist/data/curated-fi.json` ships in the artefact. `deploy-aws.yml` already excludes `data/*.json`
from the immutable re-stamp, so zero deploy changes were needed (DEC-056 dispatch still applies).

**Housekeeping / follow-ups**
- `vite.config.ts` test include now also matches `tools/**/*.test.mjs` (the tool tests are plain
  ESM so they exercise exactly the module `node tools/…` loads).
- `eslint.config.js` ignores `.claude/` (agent tooling, already Prettier-ignored) — it was failing
  the lint gate before this story.
- Follow-ups for the board: **day-slicing** the 1100–1670 km touring routes into ride-length
  segments (they exist in the catalog but can never match a day band); **elevation** for curated
  candidates (ORS elevation-along-track, or GPX `<ele>` where Bikeland provides it); **LIPAS**
  ingestion if coverage disappoints. A Finland bbox on relations also returns cross-border Swedish
  and Norwegian legs — real signed routes, kept deliberately, noted in API_NOTES §7.
