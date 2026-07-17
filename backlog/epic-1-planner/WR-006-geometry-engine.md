# WR-006 · Geometry engine
Epic: 1 · Planner | Status: DONE | Depends on: WR-003 | Size: M

## Goal
Pure geometry toolbox: polyline → ~300 m Segments (bearing, grade, surface carried over),
plus overlap ratio and small helpers (angles, distance along) everything downstream trusts.

## Context (read first)
SCORING_SPEC §1 · ARCHITECTURE §4 (Segment) · CLAUDE.md rule 4 (pure!).

## Acceptance criteria
- [x] `resample(route, targetM=300)`: segments 200–500 m, Σ lengths ≈ route distance (±0.5%),
      bearings 0–360 from north, grade % from elevation deltas (smoothed over 3 segments),
      surface/wayClass majority-carried from source ranges.
- [x] `smallestAngle(a,b)` and bearing helpers with exhaustive edge tests (359↔1 etc.).
- [x] `overlapRatio(a,b)` per WR-005's need — buffered sampling, symmetric, 0..1.
- [x] Zero imports from adapters/ui/state; no Date/now, no randomness.

## Test contract
Golden fixture: a hand-made 10-point polyline with precomputed segment table (lengths,
bearings) — exact match. Property tests: resampling twice is stable; reversing a polyline
flips bearings by 180±ε. Grade smoothing kills single-point elevation spikes.

## Technical notes
Use turf for distance/bearing/along but wrap it — engine API stays turf-free for callers.
Elevation from ORS is the 3rd coordinate; guard missing elevation (grade 0 + flag).

## Out of scope
Wind math (WR-007 uses SCORING_SPEC §2 in wind.ts).

## Log

Shipped `src/engine/geometry.ts` as a pure toolbox: no I/O, no DOM, no Date, no randomness,
zero imports from adapters/ui/state.

- Angle helpers (`deg2rad`, `rad2deg`, `normalizeDeg` → [0,360), `smallestAngle` → 0..180
  including the 359↔1 wrap and antipodal cases) plus `haversineM`, `bearingDeg` (0..360 from
  true north), `polylineLengthM`.
- `resample(geo, targetM=300)`: segment lengths clamped to [200,500] and summing to route
  distance (±0.5%); bearings 0..360; grade % smoothed over a 3-segment window to kill
  single-point elevation spikes; surface/wayClass majority-carried by distance from source
  edges; exposure defaults to 1.0 (until Epic 3); missing elevation → grade 0.
- turf (`along`, `bearing`, `distance`, `length`, `lineString`, `pointToLineDistance`) is used
  internally but never leaks — the public API takes/returns plain `LatLon`, `Segment`, and
  numbers only, per the technical note ("wrap it, stay turf-free for callers").
- Per-edge extras convention: `RouteGeometry` carries surfaces/wayClasses as per-EDGE arrays
  (not per-point). `expandRangesToEdges(ranges, pointCount, map, fallback)` converts ORS
  extra_info point-indexed ranges to this per-edge array (length `pointCount-1`); edge `e`
  takes the code of the range with `start <= e < end` — documents and guards the off-by-one
  that WR-005 must respect when building `extras`.
- `overlapRatio(a, b, {bufferM=30, sampleM=50})` → 0..1: symmetric buffered-line sampling
  (averages fraction-of-A-within-B and vice versa); 1 = identical, 0 = disjoint. This is the
  dedupe primitive WR-005 consumes directly.
- **`overlapRatio`, `expandRangesToEdges`, and `RouteGeometry` are the coordinated signatures
  WR-005 (ORS routing adapter dedupe) is built against.**
- Tests: 13 new (67 total in repo) — angle edge cases; bearing N/E; resample golden (sum
  ±0.5%, lengths in [200,500], north-line bearings ~0); reverse-polyline flips bearings ~180;
  resample-twice stability; grade-smoothing bounds a spike; degenerate polyline → `[]`;
  surface majority per edge; `expandRangesToEdges` off-by-one; `overlapRatio`
  identical/disjoint/partial. `npm test` (67 passing), `npm run lint`, `npm run build` all
  green.
- **Sequencing note:** implemented WR-006 before WR-005, even though WR-005 has the lower
  (earlier) ID, because WR-005's candidate dedupe depends on `overlapRatio`/
  `expandRangesToEdges` defined here — per BACKLOG.md "Sequencing rules," dependency order
  wins over ID order when they conflict. Recorded as DEC-012.
