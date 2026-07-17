# WR-005 · openrouteservice routing adapter — candidate diversity
Epic: 1 · Planner | Status: DONE | Depends on: WR-003 | Size: L

## Goal
6–8 genuinely different candidate loops per request: ORS round-trip with seed/points variation,
out-and-back bearing variants, parsed to CandidateRoute with surfaces + elevation + steps,
deduplicated by geometric overlap.

## Context (read first)
API_NOTES §2 · ARCHITECTURE §4–5 · PRODUCT_SPEC §3 v0.1 · CLAUDE.md rule 3 (call budget!).

## Acceptance criteria
- [x] `ors.ts` implements RouteProvider.roundTrip (+ pointToPoint for later): geojson request
      with round_trip options, `elevation:true`, `extra_info: surface,waytype,steepness`,
      instructions kept as TurnStep[].
- [x] Candidate generator `generateCandidates(start, lengthM, profile)`: N seeds × points
      variation + 2 out-and-back bearing variants; parallel with per-call timeout; partial
      failures tolerated (≥3 candidates still returned).
- [x] Overlap dedupe: shared-geometry ratio via buffered-line sampling; drop >70% pairs keeping
      the one that later scores higher (expose overlap fn from engine/geometry — coordinate
      with WR-006 signature).
- [ ] ONE probe run captures 2 real responses to fixtures (small + medium loop); parser verified.
      — DEFERRED: no VITE_ORS_API_KEY; probe implemented, parser verified vs the closed-loop
      illustrative fixture.
- [x] Requests cached (start,lengthM,seed,profile) in idb, TTL 24 h; live-call counter logged
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
Shipped `src/adapters/routing/ors.ts` (`OrsRouteProvider`): `roundTrip` + `pointToPoint` POST to
`/v2/directions/{profile}/geojson` with `round_trip` options, `elevation:true`,
`extra_info: [surface,waytype,steepness]`, `instructions:true`. Exported `parseOrsRoute` maps the
geojson into `CandidateRoute` — polyline + per-point elevations from the 3rd coordinate (guarded),
per-edge surface/wayClass via `engine/geometry.expandRangesToEdges` plus ORS code tables
(`mapSurface`/`mapWayType`), resampled `Segment[]` carrying surface + grade, `steps` → `TurnStep[]`,
`distanceM`/`ascentM` from the summary with an `ascentFromSegments` fallback. Round-trip lengths
> 100 km are rejected with a typed `ProviderError`; network/quota(429)/badResponse are mapped;
per-request timeout via `Promise.race`; a live-call counter (`getOrsLiveCallCount`) logs in dev so
the free-tier budget stays visible.

`generateCandidates(provider, start, lengthM, profile, opts)` runs seed × points-variation
round trips plus 2 out-and-back bearing variants (turf.destination, mirrored there-and-back legs)
in parallel via `allSettled` so partial failures are tolerated, then dedupes with
`dedupeByOverlap(items, {threshold=0.7, score})` — a greedy overlap-ratio drop (engine/geometry's
`overlapRatio` from WR-006) keeping the higher-scoring member of any pair over 70% shared geometry.

Pulled the caching logic out into a generic `src/adapters/idbCache.ts` (`createIdbCache<T>`) —
in-memory + IndexedDB, degrades to memory-only if idb is unavailable, prunes expired rows — so both
the weather and routing adapters share one cache implementation. ORS requests are keyed by
start(3dp)+lengthM+seed+points+profile, 24 h TTL.

Replaced the old non-closed illustrative `fixtures/ors-roundtrip-sample.geojson` with a
hand-crafted **closed** round-trip loop at `fixtures/ors/roundtrip-sample.geojson` (start == end,
elevation in the 3rd coordinate, surface extras switching asphalt→gravel across the loop, cycleway
waytype) and repointed `MockRouteProvider` at it — the old fixture wasn't a real loop and would have
let a start/end-mismatch bug slip through.

Added `scripts/probe-ors.mjs` (`npm run probe:ors`), gated on `VITE_LIVE_APIS=true` and
`VITE_ORS_API_KEY`, with `--force` to overwrite; it's built to capture 2 real loops (small +
medium). **Deferred**: this environment has no `VITE_ORS_API_KEY`, so the probe has not been run
and no real captures exist yet (`fixtures/ors/real-small.json` / `real-medium.json` are still
pending). Recorded as DEC-013. The parser is otherwise fully verified against the hand-crafted
closed-loop fixture (extras alignment, elevation/grade, 100 km cap, cache-hit, error paths).

91 tests total (up from WR-004's baseline); adapters/routing coverage 91.8%. `npm test`,
`npm run lint`, `npm run build` all green.

Coordination notes for later stories: WR-006's `overlapRatio`/`expandRangesToEdges`/resample are
now load-bearing for this adapter — don't change their signatures without touching `ors.ts` and its
tests. WR-008 will make the 2 out-and-back bearing variants wind-relative (currently fixed
bearings) and should re-run `dedupeByOverlap` after scoring is available, since dedupe here has no
score input yet and falls back to first-wins tie-breaking.

Follow-up: run `npm run probe:ors` once a `VITE_ORS_API_KEY` exists, capture real small/medium
loops, and verify the parser against them per fixtures/README.md's freeze policy.
