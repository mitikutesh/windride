# exposure_grid — offline wind-exposure preprocessing (WR-018)

Turns the Uusimaa OpenStreetMap extract into a 250 m grid of wind-exposure factors, shipped as a
static JSON the app reads locally (no runtime Overpass, no latency, no quota). See SCORING_SPEC §2
(W_eff) and DEC-006.

**This is a manual, one-time step. Never run it in CI** (it downloads a Geofabrik extract and is
heavy). Commit the generated JSON.

## Run

```sh
cd tools/exposure_grid
python -m venv .venv && . .venv/bin/activate    # or: uv venv && . .venv/bin/activate
pip install -r requirements.txt                 # or: uv pip install -r requirements.txt

python build_grid.py                            # Uusimaa, 250 m -> public/data/exposure-uusimaa.json
python build_grid.py --bbox 24.5 60.1 25.3 60.4 --out public/data/exposure-helsinki.json
python build_grid.py --pbf /path/to/local.osm.pbf   # skip the download

pytest                                          # classifier unit tests (no network)
```

Runtime: record it in the WR-018 Log after the first real run.

## Factor mapping (config in `classify.py`)

| Category  | Factor | OSM tags (examples)                                   |
|-----------|--------|-------------------------------------------------------|
| forest    | 0.35   | `natural=wood`, `landuse=forest`                      |
| mixed     | 0.50   | `leisure=park/garden/pitch`                           |
| urban     | 0.45   | `landuse=industrial/commercial/retail`               |
| suburban  | 0.60   | `landuse=residential`                                 |
| open      | 1.00   | `landuse=farmland/meadow/grass`, `natural=grassland`  |
| water     | 1.15   | `natural=water`, coast/water **adjacency**            |

Each cell's factor is the **area-weighted mean** of the categories covering it (unclassified area
counts as open, 1.0). A cell that **touches** water is set to 1.15 — adjacency drives exposure, not
being on the water itself.

## Output format (`public/data/exposure-uusimaa.json`)

Read by `src/data/exposureGrid.ts`. Compact (< 5 MB): one byte per cell, base64-packed.

```jsonc
{
  "version": 1,
  "origin": { "lat": <minLat>, "lon": <minLon> },  // SW corner
  "dLat": <degrees per cell northward>,
  "dLon": <degrees per cell eastward>,
  "cols": <int>, "rows": <int>,
  "cellSizeM": 250,
  "quant": { "min": 0.35, "max": 1.15 },
  // rows*cols bytes, row-major from the origin (row 0 = southmost, col 0 = westmost),
  // byte b -> factor = min + b/255 * (max - min)
  "factorsB64": "<base64>"
}
```

## Spot-checks (record actual values in the WR-018 Log after a run)

- Nuuksio forest core cell → < 0.5
- An open farmland cell → ≈ 1.0
- A coastal cell (touches sea) → > 1.0 (1.15)
