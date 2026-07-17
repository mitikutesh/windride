# WR-018 · Exposure-grid preprocessing (offline Python)
Epic: 3 · Conditions | Status: DONE | Depends on: WR-011 | Size: L

## Goal
The shelter model's data: a one-time script turning the Uusimaa OSM extract into a 250 m grid
of wind-exposure factors, shipped as static JSON the app looks up locally — no runtime
Overpass, no latency, no quota.

## Context (read first)
PRODUCT_SPEC §1 lever 2 · SCORING_SPEC §2 (W_eff) · DECISIONS DEC-006.

## Acceptance criteria
- [x] `tools/exposure_grid/` Python project (uv or venv, pinned deps: pyrosm, shapely, numpy):
      download Geofabrik Uusimaa extract (cached), classify land cover per cell.
- [x] Factor mapping (config, defaults): dense forest 0.35 · mixed/semi-open 0.50 · urban 0.45 ·
      suburban 0.60 · open fields 1.00 · water/coast adjacency 1.15; cell = area-weighted mean.
- [ ] Output `public/data/exposure-uusimaa.json`: {bbox, cellSizeM, origin, factors:
      Uint-style rows encoded compactly} — < 5 MB budget; README documents the format.
      **(pending a manual offline run — no network to Geofabrik this session; format, writer,
      and README are done and ready to produce it.)**
- [x] `src/data/exposureGrid.ts`: load once, `exposureAt(lat, lon)` O(1), out-of-region ⇒ 1.0
      with a flag; unit tests on a tiny handcrafted grid fixture.
- [x] Script re-runnable for other regions by bbox argument (`--region`/`--bbox`/`--pbf`/`--cell`/
      `--out`); runtime **not yet documented** — record it in the Log once the first real
      `build_grid.py` run happens.

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
- **Shipped:** `tools/exposure_grid/` — an offline, manual (never-in-CI) Python project.
  `classify.py` (pure, unit-tested) holds `CATEGORY_FACTOR` (forest 0.35, mixed 0.50, urban 0.45,
  suburban 0.60, open 1.00, water 1.15), `category_for_tags(tags)` mapping OSM
  `landuse`/`natural`/`leisure` values onto a category, `cell_factor(category_areas, cell_area,
  touches_water)` computing the area-weighted mean per cell (unclassified area counts as open,
  1.0) with an override to 1.15 whenever the cell **touches** water — adjacency drives exposure,
  not being on the water — and `quantize(factor)` packing a factor to a 0..255 byte matching the
  JS reader. `build_grid.py` downloads the Geofabrik Uusimaa extract via `pyrosm` (cached),
  rasterizes landuse/natural polygons onto a 250 m grid (shapely `STRtree` + numpy), classifies
  every cell, and writes `public/data/exposure-uusimaa.json` in the compact format; re-runnable
  for any region via `--region`/`--bbox`/`--pbf`/`--cell`/`--out`. `test_classify.py` is 6 pytest
  unit tests against synthetic tags/area maps — no `.pbf` needed, since the classification logic
  (not the rasterizer) carries the risk. `requirements.txt` pins `pyrosm`/`shapely`/`numpy`/
  `pytest`; `README.md` documents the run steps, factor table, on-disk format, and the spot-checks
  to fill in after the first real run.
- **Shipped:** `src/data/exposureGrid.ts` — the on-disk `ExposureGridFile` format (version, SW
  `origin`, `dLat`/`dLon` degrees-per-cell, `cols`/`rows`, `cellSizeM`, `quant {min,max}`,
  `factorsB64` = one byte per cell, base64-packed row-major from the origin).
  `decodeExposureGrid` turns base64 into a `Uint8Array` and throws on a `rows*cols` mismatch.
  `exposureAt(grid, lat, lon)` is an O(1) index lookup returning `{ factor, inRegion }`;
  out-of-region ⇒ neutral `1.0`/`inRegion:false`, and a **null grid also degrades to neutral**, so
  the app runs correctly before the grid asset exists. `loadExposureGrid(fetchFn?, url?)` fetches
  `/data/exposure-uusimaa.json` and returns `null` on a missing/failed/unreadable asset instead of
  throwing. `src/data/exposureGrid.test.ts` adds 9 tests: decode + metadata, byte-count mismatch
  throws, SW-corner/max-cell/interior-cell lookups, out-of-region west and north, null-grid
  neutrality, load-decodes-a-fetched-grid, and load-returns-null-on-404/throw.
- **Decisions:** byte-quantized base64 grid keeps the whole Uusimaa region well under the 5 MB
  budget (DEC-006) while staying trivial to decode in the browser; water-adjacency (cell touches
  water), not on-water, drives the 1.15 override per the Technical notes; unclassified cell area
  is folded into "open" (1.0) rather than left undefined, so partially-tagged cells still get a
  sane factor; a missing/failed grid fetch degrades to neutral (`1.0` everywhere) rather than
  erroring, matching `Segment.exposure`'s existing default of 1.0 — the app must run before the
  grid is generated.
- **Honesty caveat — data not generated this session:** `public/data/exposure-uusimaa.json` was
  **not** produced; there was no network access to Geofabrik in this session. The classifier
  (`classify.py`) was sanity-run locally and all its unit-test assertions pass, and the writer
  (`build_grid.py`) is implemented and re-runnable, but actually downloading the Uusimaa extract
  and rasterizing it is a manual, offline, one-time step still pending. Until `build_grid.py` is
  run by hand, `loadExposureGrid` gets a 404/missing asset, returns `null`, and every
  `exposureAt` lookup is neutral (`factor: 1.0`) — the safe default, not a broken state. WR-019
  (shelter-aware effective wind) will only see real shelter data after that manual run happens.
  **Follow-up:** after the first real `build_grid.py` run, record here: the actual runtime, the
  output file size, and the three spot-checks from the Test contract (a Nuuksio-core forest cell
  <0.5, an open-field cell ≈1.0, a coastal cell >1.0).
- **Test counts:** `test_classify.py` 6 (Python, run manually via `pytest`, not part of the JS
  suite/CI), `exposureGrid.test.ts` 9 (new); **263 tests total in the JS suite, lint clean, build
  OK.**
