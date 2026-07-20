# WindRide backlog — story board

**How agents work this board:** pick the lowest-numbered TODO whose dependencies are all DONE.
One story per session. Close it per CLAUDE.md §Session ritual, flip Status here, append to the
story's Log. Sizes: S ≤ 2 h · M ≈ half-day · L ≈ full day (agent-driven).

Story files use one shared template: Goal · Context (read first) · Acceptance criteria ·
Test contract · Technical notes · Out of scope · Log.

## Epic 1 · Planner (v0.1) — "3 good routes for right now, on a map, in <10 s"
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-001 | Repo scaffold: Vite+TS+PWA, lint, vitest, CI | — | M | DONE |
| WR-002 | Design tokens + app shell + attribution footer | 001 | M | DONE |
| WR-003 | Domain types + adapter interfaces + mock providers | 001 | M | DONE |
| WR-004 | Open-Meteo weather adapter (multipoint, hourly) | 003 | M | DONE |
| WR-005 | ORS routing adapter (round-trip diversity + dedupe) | 003 | L | DONE |
| WR-006 | Geometry engine: resample, bearings, grades, overlap | 003 | M | DONE |
| WR-007 | Scoring engine v1 + explanations | 006 | L | DONE |
| WR-008 | Plan screen (inputs → generate flow) | 002,003 | M | DONE |
| WR-009 | Results: MapLibre map, wind-coloured routes, cards | 007,008 | L | DONE |
| WR-010 | GPX export + route persistence (idb) | 009 | S | DONE |
| WR-011 | v0.1 acceptance harness (30/50/80 km eval) | 010 | M | DONE |

## Epic 2 · Navigator (v0.2) — "it guides me and I trust the ETA"
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-012 | GPX replay harness (build BEFORE any GPS code) | 011 | M | DONE |
| WR-013 | Location service + windowed snap + progress | 012 | M | DONE |
| WR-014 | Turn cue engine + TTS/beep | 013 | M | DONE |
| WR-015 | Off-route detect + rejoin-track reroute | 013 | M | DONE |
| WR-016 | Ride screen: glance zone, wind HUD, wake lock | 014,015 | L | DONE |
| WR-017 | Recorder: crash-safe idb, pause, GPX out | 013 | M | DONE |

## Epic 3 · Conditions Brain (v0.3)
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-018 | tools/: exposure-grid preprocessing (Python) | 011 | L | DONE |
| WR-019 | Shelter-aware effective wind + shelter sub-score | 018 | M | DONE |
| WR-020 | Start-time optimizer + heat strip UI | 011 | M | DONE |
| WR-021 | Gust-exposure safety flags | 019 | S | DONE |
| WR-022 | Feels-like elevation chart | 009 | M | DONE |
| WR-023 | Strava upload (single-player OAuth, GPX push) | 017 | M | DONE |
| WR-024 | Speed-model calibration from recorded rides | 017 | M | DONE |

## Epic 4 · Signature (v0.4)
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-025 | Forecast-robustness sub-score (±30°) | 007 | S | DONE |
| WR-026 | Downwind one-ways + Digitransit return ranking | 011 | L | DONE |
| WR-027 | Winter/Nordic mode | 020 | M | DONE |
| WR-028 | Novelty score (ridden-edges geohash set) | 017 | M | DONE |

## Epic 5 · Accounts & Cloud (v0.5) — "optional free account; your keys never leave the browser"
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-037 | AWS static hosting + custom domain (S3/CloudFront/ACM, OIDC deploy) | — | M | DONE |
| WR-038 | Serverless backend skeleton (CDK, Lambda Function URLs, DynamoDB) | 037 | L | DONE |
| WR-039 | Auth: free registration + login (Cognito), progressive | 038 | L | DONE |
| WR-040 | User profile + free-subscription entitlement | 039 | M | DONE |
| WR-041 | Cross-device sync of non-secret data (keys never sync) | 040 | L | DONE |
| WR-042 | GDPR: privacy policy, data export, account deletion | 040 | M | DONE |
| WR-043 | Accounts-era UX + honest copy update | 041,042 | S | DONE |

## Epic 6 · AI Copilot (v0.6) — bring-your-own key, backend-independent
Needs only WR-044 (no backend), so it ships on the current static app and may run in
parallel with Epic 5.
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-044 | AI adapter + Kit provider selector + 'ai' key wiring (per-user provider, validated) | — | M | DONE |
| WR-045 | AI ride briefing (clothing, fuel, safety) | 044 | M | DONE |
| WR-046 | Natural-language planning (text → Plan inputs) | 044 | M | DONE |
| WR-047 | AI route discovery → validate → wind-scored | 044 | L | DONE |
| WR-048 | Scenic photos + POI highlights (Wikimedia/Mapillary) | 047 | M | DONE |
| WR-049 | Post-ride AI summary (plan vs ride) | 044 | S | DONE |
| WR-050 | Capability readiness + honest missing/failing messaging (AI, Strava, keys) | 044 | M | DONE |

## Sequencing rules
Epics close in order; inside an epic, dependency order wins over ID order if they conflict.
Exception: Epic 6 is backend-independent (needs only WR-044) and may proceed in parallel
with Epic 5 (DEC-043).
WR-012 (replay harness) is deliberately BEFORE all GPS work — navigation is developed at the
desk, validated on the bike. New stories: next WR number, same template, add a row here.

Note: WR-006 was done before WR-005 despite the higher ID — WR-005's ORS candidate dedupe
depends on `engine/geometry.overlapRatio` from WR-006, so dependency order won (see DEC-012).
