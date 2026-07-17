# WindRide — Product Spec (agent-facing condensation)

## 1. Thesis and physics

Naive pitch ("routes with the most tailwind") is impossible for loops: on any closed loop in
steady uniform wind, tailwind- and headwind-projected distances cancel. WindRide's real promise
is **the least suffering for today's conditions**, via five levers:

1. Convert direct headwind → crosswind through route shape.
2. **Shelter the upwind legs** (forest/urban vs. exposed coast — the biggest lever in Uusimaa).
3. Sequence: headwind early, tailwind home; exploit forecast shifts mid-ride.
4. Weight everything by **time**, not distance (headwind km cost more minutes).
5. Point-to-point escapes the constraint → downwind one-ways with transit return (Epic 4).

**Differentiator:** every competitor (myWindsock, Epic Ride Weather, WindAhead, Headwind…)
*analyzes* existing routes. WindRide *generates* them. Generation + navigation in one app is
the open gap.

## 2. Scope

- Cycling only (road + gravel). Running/MTB deferred. One user (the owner). No accounts.
- No backend. Client-side PWA + free APIs + IndexedDB. Zero monthly cost.
- Strava = optional upload target for finished rides. Nothing more (see API_NOTES §4).
- No LLM/NL assistant: route explanations are rule-based templates from scoring data.
- Region focus: Uusimaa/southern Finland (exposure grid, HSL transit); code stays region-agnostic.

## 3. Feature set by version

### v0.1 Planner (Epic 1)
Inputs (distance slider, loop/out-and-back, road/gravel, elevation & traffic prefs, start time,
"home before dark") → 6–8 candidate loops via openrouteservice round-trip with seed/bearing
diversity → segment + score against Open-Meteo wind (SCORING_SPEC) → top 3 on a MapLibre map
with per-segment wind colouring, wind-aware ETA, ribbon, rule-based explanation → GPX export.

### v0.2 Navigator (Epic 2)
GPX replay test harness FIRST, then: 1 Hz GPS, windowed snap-to-track, TTS turn cues, off-route
detection that reroutes **back to the track** (never to the finish), live wind HUD
("tailwind in 2.3 km"), wake lock, ride recorder with crash-safe persistence.

### v0.3 Conditions Brain (Epic 3)
Precomputed land-use exposure grid (offline Python) → shelter-adjusted effective wind →
start-time optimizer (score × hour heat strip, joint recommendation) → gust safety flags →
feels-like elevation chart → Strava upload → speed-model calibration from own rides.

### v0.4 Signature (Epic 4)
Forecast-robustness score (wind ±30°, take min) · downwind one-ways with HSL/Digitransit return ·
winter/Nordic mode (ice heuristic, daylight hard constraint) · novelty score (unridden roads).

## 4. Explicitly out (do not build, do not suggest)

Social features/leaderboards · Strava data import into logic (ToS) · NL chat assistant ·
accounts/backend/payments · running/walking/MTB modes · AI coach · humidity/visibility UI.

## 5. UX principles

Colour always means wind relationship (tail/cross/head/shelter) — never decoration. Every
duration shown is wind-aware. Glove-first hit targets ≥ 44 px. Dark-first (DESIGN.md).
Explanations state facts from scoring ("9 km upwind runs through Nuuksio forest, effective
wind 4 m/s instead of 9"), never vibes.

## 6. Acceptance bar for v0.1 (WR-011 encodes this)

From a fixed Espoo start in a synthetic 8 m/s SW wind fixture, for 30/50/80 km targets:
produce ≥3 geometrically distinct candidates (<70% mutual overlap) in <10 s wall-clock using
fixtures, ranked such that the winner beats the median candidate on time-weighted headwind by
a visible margin, with a truthful one-line explanation for each.
