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
| WR-005 | ORS routing adapter (round-trip diversity + dedupe) | 003 | L | TODO |
| WR-006 | Geometry engine: resample, bearings, grades, overlap | 003 | M | TODO |
| WR-007 | Scoring engine v1 + explanations | 006 | L | TODO |
| WR-008 | Plan screen (inputs → generate flow) | 002,003 | M | TODO |
| WR-009 | Results: MapLibre map, wind-coloured routes, cards | 007,008 | L | TODO |
| WR-010 | GPX export + route persistence (idb) | 009 | S | TODO |
| WR-011 | v0.1 acceptance harness (30/50/80 km eval) | 010 | M | TODO |

## Epic 2 · Navigator (v0.2) — "it guides me and I trust the ETA"
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-012 | GPX replay harness (build BEFORE any GPS code) | 011 | M | TODO |
| WR-013 | Location service + windowed snap + progress | 012 | M | TODO |
| WR-014 | Turn cue engine + TTS/beep | 013 | M | TODO |
| WR-015 | Off-route detect + rejoin-track reroute | 013 | M | TODO |
| WR-016 | Ride screen: glance zone, wind HUD, wake lock | 014,015 | L | TODO |
| WR-017 | Recorder: crash-safe idb, pause, GPX out | 013 | M | TODO |

## Epic 3 · Conditions Brain (v0.3)
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-018 | tools/: exposure-grid preprocessing (Python) | 011 | L | TODO |
| WR-019 | Shelter-aware effective wind + shelter sub-score | 018 | M | TODO |
| WR-020 | Start-time optimizer + heat strip UI | 011 | M | TODO |
| WR-021 | Gust-exposure safety flags | 019 | S | TODO |
| WR-022 | Feels-like elevation chart | 009 | M | TODO |
| WR-023 | Strava upload (single-player OAuth, GPX push) | 017 | M | TODO |
| WR-024 | Speed-model calibration from recorded rides | 017 | M | TODO |

## Epic 4 · Signature (v0.4)
| ID | Story | Deps | Size | Status |
|---|---|---|---|---|
| WR-025 | Forecast-robustness sub-score (±30°) | 007 | S | TODO |
| WR-026 | Downwind one-ways + Digitransit return ranking | 011 | L | TODO |
| WR-027 | Winter/Nordic mode | 020 | M | TODO |
| WR-028 | Novelty score (ridden-edges geohash set) | 017 | M | TODO |

## Sequencing rules
Epics close in order; inside an epic, dependency order wins over ID order if they conflict.
WR-012 (replay harness) is deliberately BEFORE all GPS work — navigation is developed at the
desk, validated on the bike. New stories: next WR number, same template, add a row here.
