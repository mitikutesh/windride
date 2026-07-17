# WR-005 · openrouteservice routing adapter — candidate diversity
Epic: 1 · Planner | Status: TODO | Depends on: WR-003 | Size: L

## Goal
6–8 genuinely different candidate loops per request: ORS round-trip with seed/points variation,
out-and-back bearing variants, parsed to CandidateRoute with surfaces + elevation + steps,
deduplicated by geometric overlap.

## Context (read first)
API_NOTES §2 · ARCHITECTURE §4–5 · PRODUCT_SPEC §3 v0.1 · CLAUDE.md rule 3 (call budget!).

## Acceptance criteria
- [ ] `ors.ts` implements RouteProvider.roundTrip (+ pointToPoint for later): geojson request
      with round_trip options, `elevation:true`, `extra_info: surface,waytype,steepness`,
      instructions kept as TurnStep[].
- [ ] Candidate generator `generateCandidates(start, lengthM, profile)`: N seeds × points
      variation + 2 out-and-back bearing variants; parallel with per-call timeout; partial
      failures tolerated (≥3 candidates still returned).
- [ ] Overlap dedupe: shared-geometry ratio via buffered-line sampling; drop >70% pairs keeping
      the one that later scores higher (expose overlap fn from engine/geometry — coordinate
      with WR-006 signature).
- [ ] ONE probe run captures 2 real responses to fixtures (small + medium loop); parser verified.
- [ ] Requests cached (start,lengthM,seed,profile) in idb, TTL 24 h; live-call counter logged
      in dev so budget is visible.

## Test contract
Fixture parsing incl. extras alignment to coordinates; dedupe unit tests on synthetic
polylines (identical, disjoint, 50%, 80% overlap); generator returns ≥3 on 50% simulated failures.

## Technical notes
ORS extras arrive as index ranges over the geometry — map them to per-point then per-segment
values carefully (off-by-one trap; test it). Respect the 100 km round-trip cap: reject larger
targets with a typed error the UI can phrase.

## Out of scope
Scoring; downwind one-ways (WR-026).

## Log
