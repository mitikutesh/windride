# External providers — verified facts, budgets, keys

Facts below were verified mid-2026; APIs drift. Each adapter story includes a "verify against
live response once, then freeze fixture" step. If the live shape differs from fixtures, update
the fixture + parser together and note it in the story Log.

## 1. Open-Meteo (weather & wind) — no key
- Free for non-commercial use, < 10,000 calls/day. **Attribution CC-BY 4.0 required** (UI footer,
  wired in WR-002).
- Forecast endpoint `https://api.open-meteo.com/v1/forecast`. Multi-point: comma-separated
  `latitude`/`longitude` lists — sample a whole route in ONE call.
- Hourly params used: `wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,
  apparent_temperature,precipitation_probability` · daily: `sunrise,sunset` ·
  `wind_speed_unit=ms&timezone=auto`. (Param names were renamed in the past — verify once.)
- `wind_direction_10m` is meteorological (FROM). See CLAUDE.md domain warnings.
- Budget: 1–2 calls per planning session (all hourly slots arrive in the same response —
  the start-time optimizer costs zero extra calls).

## 2. openrouteservice (route candidates) — key required (`VITE_ORS_API_KEY`)
- Free tier: 2,500 req/day, 40,000/month. **Round-trip routes capped at 100 km.**
- `POST /v2/directions/{profile}/geojson`, profiles: `cycling-regular` (gravel-ish),
  `cycling-road`. Body of interest:
  `options.round_trip: { length: <metres>, points: 3–5, seed: <int> }`,
  `elevation: true`, `extra_info: ["surface","waytype","steepness"]`, `instructions: true`.
- Diversity recipe (WR-005): vary seed × points; plus out-and-back variants: route to a point
  `distance/2` along bearings {45°,135°,225°,315° relative to wind_to}, return.
- Budget: 6–8 calls per planning session; ≤ ~30 per dev session. Cache by (start,km,seed).

## 3. Digitransit / HSL (Epic 4 transit return) — free key on registration
- GraphQL routing API; used only in WR-026 to rank downwind endpoints by return service.

## 4. Strava (upload-only) — `VITE_STRAVA_CLIENT_ID` (+ secret kept out of the repo)
- New API apps are single-player (athlete capacity 1) — fine, it's us. A Strava subscription is
  a prerequisite for API access. Rate: 200 req/15 min, 2,000/day (we'll use ~1/ride).
- **Terms: no Strava data in AI/ML or recommendation logic; display only to the athlete.**
  Consequence: upload finished GPX via OAuth (`activity:write`), nothing else, ever.
- Pure-client OAuth needs the client secret for token exchange → WR-023 uses a one-time local
  helper (`tools/strava-auth.mjs`, runs on localhost, stores the refresh token locally). No server.

## 5. Map tiles — no key
- MapLibre GL JS + OpenFreeMap style `https://tiles.openfreemap.org/styles/liberty` (the Streets base).
  OSM attribution (ODbL) must remain visible on the map.
- Results-map basemap switcher (DEC-035), all free/keyless raster layers over the vector base:
  - **Cycling** — CyclOSM `https://{a,b,c}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`
    (attr: "CyclOSM | © OpenStreetMap contributors"). Bike-focused: cycleways, lanes, surface, MTB.
  - **Satellite** — Esri World Imagery `.../World_Imagery/MapServer/tile/{z}/{y}/{x}` (note {z}/{y}/{x});
    attr: "Imagery © Esri, Maxar, Earthstar Geographics".
  - **Terrain** — OpenTopoMap `https://{a,b,c}.tile.opentopomap.org/{z}/{x}/{y}.png` (attr: "© OpenTopoMap (CC-BY-SA)").
  - Each source's `attribution` is set so MapLibre surfaces the licence. Definitions in `src/ui/basemaps.ts`.
  - Live traffic is NOT included — no free/keyless provider exists (needs a paid Google/TomTom/HERE key).

## 6. .env contract (mirrored in .env.example)
VITE_ORS_API_KEY= · VITE_STRAVA_CLIENT_ID= · VITE_LIVE_APIS=false (tests must pass with false)

## 7. Overpass API (curated route catalog, WR-052) — no key, BUILD TIME ONLY
- Endpoint `https://overpass-api.de/api/interpreter` (POST, body = Overpass QL). Free community
  infrastructure; the usage policy asks for an identifiable client and no hammering, so the query
  runs **only** from `tools/fetch_curated_routes.mjs` (manual, ~yearly), with an honest User-Agent
  and exactly one retry after a 30 s backoff on 429/502/503/504. **The app never calls Overpass** —
  the browser only fetches the same-origin `data/curated-fi.json` this script produces (DEC-060).
- The query (one bbox, one `out geom`):
  ```
  [out:json][timeout:600];
  relation["route"="bicycle"]["network"~"^(icn|ncn|rcn)$"](59.7,19.0,70.1,31.6);
  out geom;
  ```
  `out geom` inlines each member way's coordinates, so no second `way`/`node` round-trip is needed.
- Shape: `elements[]` of `type:"relation"` with `tags` and `members[]`; way members carry
  `geometry:[{lat,lon},…]` and a `role` (`""`, `"forward"`, `"alternative"`, `"excursion"`, …).
- Gotchas: (a) member ways are stored in **either direction** — stitch by matching endpoints, not by
  order; (b) relations are routinely mapped in **disconnected pieces**, so gaps over ~100 m start a
  new chain (never bridge them — that invents geometry) and the entry is flagged `partial`;
  (c) a bbox on relations also returns **cross-border** routes (Swedish/Norwegian legs near the
  border) — real signed routes, kept; (d) `network` may hold several tokens (`"rcn;lcn"`).
- Licence: ODbL. Derived entries carry `© OpenStreetMap contributors (ODbL)` and the footer shows it
  while curated routes are on screen. Use `--cache` / `--from-cache` when tuning the transform so
  re-runs never re-hit the endpoint.
- Measured 2026-07-30 (Finland bbox, icn|ncn|rcn): 193 relations → 138 catalog routes ≥ 5 km,
  0.68 MB of the 1.5 MB budget, 42 flagged partial.

## 8. Bikeland (bikeland.fi) — no API, manual GPX only
- Bikeland publishes Finland's curated national cycling routes but exposes **no public API**, so
  nothing is scraped. Download the GPX by hand into `tools/curated_in/` (gitignored) and re-run
  `node tools/fetch_curated_routes.mjs`; the parser reads `<trk>`/`<rte>` points and the track name.
- Entries are credited `Route data © Bikeland (bikeland.fi)` in the attribution footer.
- komoot is deliberately absent: its highlights/popularity data is partner-only. Strava data is
  banned from scoring and any ML/AI path by their terms (CLAUDE.md) — upload-only, as ever.
