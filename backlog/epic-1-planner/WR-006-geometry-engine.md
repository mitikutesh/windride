# WR-006 · Geometry engine
Epic: 1 · Planner | Status: TODO | Depends on: WR-003 | Size: M

## Goal
Pure geometry toolbox: polyline → ~300 m Segments (bearing, grade, surface carried over),
plus overlap ratio and small helpers (angles, distance along) everything downstream trusts.

## Context (read first)
SCORING_SPEC §1 · ARCHITECTURE §4 (Segment) · CLAUDE.md rule 4 (pure!).

## Acceptance criteria
- [ ] `resample(route, targetM=300)`: segments 200–500 m, Σ lengths ≈ route distance (±0.5%),
      bearings 0–360 from north, grade % from elevation deltas (smoothed over 3 segments),
      surface/wayClass majority-carried from source ranges.
- [ ] `smallestAngle(a,b)` and bearing helpers with exhaustive edge tests (359↔1 etc.).
- [ ] `overlapRatio(a,b)` per WR-005's need — buffered sampling, symmetric, 0..1.
- [ ] Zero imports from adapters/ui/state; no Date/now, no randomness.

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
