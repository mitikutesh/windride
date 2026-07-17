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

## Log — Fable 5 review pass — fixes

A Fable 5 review of WR-006 raised one BLOCKER and several SHOULD-FIXes; all are fixed and the
gate (`npm test` = 76 passing, `npm run lint`, `npm run build`) is green.

- **BLOCKER (perf) — `overlapRatio` was O(S·N) via turf `along` + `pointToLineDistance`,
  costing ~1.6–7 s per pair — unusable for WR-005's pairwise candidate dedupe. Rewritten to
  O(|A|+|B|+samples): a single-walk `sampleAlong` emits sample points along each line in one
  pass, and B's samples are indexed in a planar `spatialHash` (cell size = `bufferM`, 3×3
  neighbourhood lookup) so membership tests are ~O(1) instead of scanning every point of the
  other line. Dropped the turf `along`/`length`/`lineString`/`pointToLineDistance` imports;
  only `distance` and `bearing` remain. Benchmark: 28 pairs of 1200-point lines now run in
  ~67 ms total (was tens of seconds). Output values are unchanged: identical lines → 1,
  disjoint → 0, the metric stays symmetric, and a reversed loop → ~1.
- **SHOULD-FIX (bearings)** — segment bearing is now the length-weighted circular mean of the
  underlying edge bearings (`segmentBearing`), with a fallback to the dominant (longest) edge's
  bearing when the vector sum collapses (chord ≈ 0, e.g. an out-and-back turnaround). Previously
  a chord (start→end) bearing was used, which goes garbage on folds and curves and would have
  poisoned WR-007's wind decomposition on any there-and-back segment.
- **SHOULD-FIX (elevations)** — `resample` now throws when `elevations.length !==
  polyline.length` instead of silently grading 0; corrupt/misaligned adapter output is loud.
  Absent elevations (the normal "no elevation data" case) still yield grade 0 as before.
- **SHOULD-FIX (tests)** — the grade-smoothing test was un-failable (bound of 16.7% against an
  actual smoothed value of ~4.4%); tightened to `<6%` so it actually guards the 3-segment
  smoothing window. Added a golden bendy-path bearing test (north-then-east legs with known
  0°/90° leg bearings) and a fold/turnaround bearing test (asserts a sane, non-garbage bearing
  instead of a chord artifact). Documented and tested the "<200 m route ⇒ single whole-length
  segment" invariant explicitly.
- **NIT (coverage)** — added tests for `deg2rad`/`rad2deg` round-trip, `haversineM` against a
  known short distance, `smallestAngle` with negative and >360 inputs, `overlapRatio` symmetry,
  and `expandRangesToEdges` gap-fallback / out-of-range-clipping / off-by-one behaviour.
- **Direction-blind note** — `overlapRatio` is direction-blind by design (a reversed loop scores
  ~1); this is now called out explicitly in the doc comment. WR-005 should use it purely to
  dedupe geometry (same/near-same path regardless of direction), then decide separately how to
  handle CW vs CCW traversal for the sequencing subscore.
- Test count: 76 passing total (up from 67); `npm run lint` and `npm run build` green.
