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
- MapLibre GL JS + OpenFreeMap style `https://tiles.openfreemap.org/styles/liberty`.
  OSM attribution (ODbL) must remain visible on the map.

## 6. .env contract (mirrored in .env.example)
VITE_ORS_API_KEY= · VITE_STRAVA_CLIENT_ID= · VITE_LIVE_APIS=false (tests must pass with false)
