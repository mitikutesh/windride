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

## Fable 5 review pass — fixes

A Fable 5 review of this story returned REQUEST-CHANGES. All findings below are now fixed and
the gate is green.

- **BLOCKER 1 — overlap double-counting (data corruption), fixed three ways:** a feature tagged
  both `landuse=forest` and `natural=wood` was being counted once in the landuse GDF and once in
  the natural GDF, so a pure-forest cell read `0.70` instead of the correct `0.35` — every
  overlapping same-category feature silently inflated its own factor. Fixed by (1)
  `load_polygons` deduping features by OSM id across the landuse/natural GDFs before they ever
  reach the rasterizer, (2) `build()` unioning each category's per-cell intersections (shapely
  `union_all`) before measuring area, so same-category overlaps within a cell no longer
  double-count, and (3) `classify.cell_factor` now normalizes when the classified area exceeds
  the cell area — dividing by the classified total instead of padding with open space — so
  cross-category overlaps (e.g. a park fully over a residential cell) stay within the
  contributing categories' factor range instead of blowing past the `1.15` ceiling. Added a
  `cell_factor` overlap test: park `0.50` fully over residential `0.60` → `0.55`.
- **SHOULD-FIX 2 — open sea was invisible, breaking the coastal spot-check:** Geofabrik ships no
  sea polygon; the coast is `natural=coastline` LineStrings, which `category_for_tags` mapped to
  `None`, so coastal cells never tripped the `1.15` water-adjacency override — failing the
  story's own coastal spot-check requirement. Fixed: `category_for_tags` now maps
  `natural=coastline` to `water` (a LineString still `.intersects` a cell, so adjacency still
  works with no polygon needed). Also reclassified `natural=wetland` out of `water` into `open`
  — exposed low cover isn't water and conflating them was a latent NIT. Added classifier tests
  for both.
- **SHOULD-FIX 3 — no cross-language golden pinning writer and reader:** nothing guarded the
  Python writer's byte order/quantization against the JS reader silently drifting apart (the
  quiet-corruption failure class). Fixed: added `classify.pack_factors_b64` as the one stdlib-only
  packing contract, a Python test asserting the golden base64 string `"AID/QL9k"` for a known
  2×3 factor grid, a committed `fixtures/exposure/golden-grid.json`, and a JS test that decodes
  that same fixture and asserts the cell factors — writer and reader are now pinned to one shared
  golden instead of two independent implementations that happened to agree.
- **SHOULD-FIX 4 — `exposureGrid.ts` fetches directly (adapters-only fetch rule):** recorded as
  **DEC-023** (`docs/DECISIONS.md`) — first-party static asset reads under `src/data` are exempt
  from the adapters-only fetch rule (ARCHITECTURE §2); live third-party APIs are unaffected and
  still go through adapters.
- **SHOULD-FIX 5 — Status DONE with the JSON-generation acceptance sub-point unmet:** recorded as
  **DEC-024** (`docs/DECISIONS.md`) — the real `public/data/exposure-uusimaa.json` build is
  deferred (no network to Geofabrik this session) and degrades to neutral `1.0` until run. This
  is also tracked as an explicit follow-up so it can't rot: the **Follow-up** bullet in the Log
  above (record the actual runtime, output file size, and the three spot-checks) stays open, and
  WR-019 (shelter-aware effective wind) is blocked on real data from that manual run.
- **NITs addressed:** `loadExposureGrid` now `console.warn`s on a present-but-unparseable
  (corrupt) grid, so that failure mode is distinguishable from a merely absent asset;
  `build_grid.py` now prints the real JSON file size (`st_size`) instead of the raw packed byte
  count; `write_json` accepts a plain list-of-lists so the packer stays numpy-free and directly
  testable; `.gitignore` now ignores `.venv/`, `__pycache__/`, `.pytest_cache/`, and `*.pyc`;
  added JS out-of-region tests on all four sides plus the NE-corner cell.
- **NITs deferred (noted, not blocking):** `pyrosm`/numpy 2.x install compatibility — verify at
  the first real run; the per-cell pure-Python loop is slow (~hours over the full Uusimaa
  extract) — vectorize later if it becomes a problem; the wetland minimum-area threshold —
  revisit once real spot-checks are available.
- **Gate:** 265 tests, lint clean, build OK. `build_grid.py` still needs a manual, offline run
  to produce the real `public/data/exposure-uusimaa.json` (DEC-024) — nothing above changes that.
