# WR-018 · Exposure-grid preprocessing (offline Python)
Epic: 3 · Conditions | Status: TODO | Depends on: WR-011 | Size: L

## Goal
The shelter model's data: a one-time script turning the Uusimaa OSM extract into a 250 m grid
of wind-exposure factors, shipped as static JSON the app looks up locally — no runtime
Overpass, no latency, no quota.

## Context (read first)
PRODUCT_SPEC §1 lever 2 · SCORING_SPEC §2 (W_eff) · DECISIONS DEC-006.

## Acceptance criteria
- [ ] `tools/exposure_grid/` Python project (uv or venv, pinned deps: pyrosm, shapely, numpy):
      download Geofabrik Uusimaa extract (cached), classify land cover per cell.
- [ ] Factor mapping (config, defaults): dense forest 0.35 · mixed/semi-open 0.50 · urban 0.45 ·
      suburban 0.60 · open fields 1.00 · water/coast adjacency 1.15; cell = area-weighted mean.
- [ ] Output `public/data/exposure-uusimaa.json`: {bbox, cellSizeM, origin, factors:
      Uint-style rows encoded compactly} — < 5 MB budget; README documents the format.
- [ ] `src/data/exposureGrid.ts`: load once, `exposureAt(lat, lon)` O(1), out-of-region ⇒ 1.0
      with a flag; unit tests on a tiny handcrafted grid fixture.
- [ ] Script re-runnable for other regions by bbox argument; runtime documented in Log.

## Test contract
Python: unit tests on the classifier with a small .pbf fixture snippet; JS: grid lookup tests
(corners, out-of-bounds, known cells). Spot-check in Log: Nuuksio core cell <0.5, an open-field
cell ≈1.0, a coastal cell >1.0.

## Technical notes
Keep the classifier simple (landuse/natural tags majority per cell); accuracy improves later.
Water ADJACENCY (cell touching water) drives 1.15, not being ON water.

## Out of scope
Runtime wiring into scoring (WR-019).

## Log
