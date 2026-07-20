#!/usr/bin/env python3
"""Build the wind-exposure grid JSON from an OSM extract (WR-018, offline one-time).

Downloads the Geofabrik Uusimaa extract (cached under .cache/), reads land cover with GDAL's OSM
driver via geopandas/pyogrio, classifies it onto a 250 m grid, and writes
public/data/exposure-uusimaa.json in the compact format src/data/exposureGrid.ts reads.
Re-runnable for other regions via --region / --pbf / --bbox.

    uv run build_grid.py                        # Uusimaa, 250 m, default output
    uv run build_grid.py --region Uusimaa --cell 250
    uv run build_grid.py --pbf /path/to/local.osm.pbf   # skip the download
    uv run build_grid.py --bbox 24.5 60.1 25.3 60.4 --out public/data/exposure-helsinki.json

NEVER run in CI (network + heavy). This is a manual preprocessing step; commit the output JSON.
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from pathlib import Path

import numpy as np
from shapely import make_valid, union_all
from shapely.geometry import box
from shapely.strtree import STRtree

from classify import (
    FACTOR_MAX,
    FACTOR_MIN,
    OPEN_FACTOR,
    category_for_tags,
    cell_factor,
    pack_factors_b64,
)

M_PER_DEG_LAT = 111_320.0

# Region .osm.pbf extracts (keyless, public). Geofabrik does NOT subdivide Finland, so Uusimaa comes
# from the OSM-France extract server (proper maakunta extracts). Add regions here, or pass --pbf.
EXTRACTS = {
    "Uusimaa": "http://download.openstreetmap.fr/extracts/europe/finland/uusimaa-latest.osm.pbf",
}
CACHE_DIR = Path(__file__).resolve().parent / ".cache"

# Grid coverage when --bbox isn't given: the Helsinki region / core Uusimaa where rides actually
# happen (Espoo–Helsinki–Vantaa–Sipoo + Nuuksio + the coast). Deriving from the full extract bounds
# would cover the whole maakunta (Hanko→Loviisa) and blow up the cell count for little benefit —
# routes outside the grid degrade to neutral shelter in exposureGrid.ts. (minLon, minLat, maxLon, maxLat)
DEFAULT_BBOX = (24.3, 60.0, 25.4, 60.5)


def _resolve_pbf(region: str | None, pbf: str | None) -> str:
    """Return a local .osm.pbf path — a passed --pbf, or the cached/downloaded region extract."""
    if pbf:
        return pbf
    name = region or "Uusimaa"
    url = EXTRACTS.get(name)
    if not url:
        raise SystemExit(f"No extract URL for region {name!r}; pass --pbf /path/to.osm.pbf")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = CACHE_DIR / Path(url).name
    if not dest.exists():
        print(f"downloading {url}\n     -> {dest}")
        urllib.request.urlretrieve(url, dest)
        # A redirect to an HTML index (region not found) writes a tiny page, not a PBF — fail loud.
        if dest.stat().st_size < 1_000_000:
            dest.unlink(missing_ok=True)
            raise SystemExit(f"Download from {url} was not a PBF (too small) — check the URL/region.")
    return str(dest)


def load_polygons(region: str | None, pbf: str | None, bbox: tuple[float, float, float, float]):
    """Return (features, water_geoms) from an OSM .pbf via GDAL's OSM driver (geopandas/pyogrio).

    Reads only features within `bbox` (spatial filter at read time). Land-cover areas come from the
    `multipolygons` layer (landuse/natural/leisure are promoted columns there). The open sea has no
    polygon in the extract, so the coast is `natural=coastline` LINES — GDAL keeps those in the
    `lines` layer with the tag inside `other_tags`; we pull them into `water` so coastal cells get
    the adjacency override (classify.py).
    """
    import geopandas as gpd  # lazy so the classifier unit tests need no geo deps

    fp = _resolve_pbf(region, pbf)
    features = []  # (category, shapely geometry)
    water = []

    polys = gpd.read_file(
        fp,
        layer="multipolygons",
        engine="pyogrio",
        columns=["landuse", "natural", "leisure"],
        bbox=bbox,
    )
    for geom, landuse, natural, leisure in zip(
        polys.geometry, polys["landuse"], polys["natural"], polys["leisure"]
    ):
        if geom is None or geom.is_empty:
            continue
        geom = make_valid(geom)  # raw OSM polygons self-intersect; GEOS ops throw on invalid input
        tags = {
            k: v
            for k, v in (("landuse", landuse), ("natural", natural), ("leisure", leisure))
            if isinstance(v, str)
        }
        cat = category_for_tags(tags)
        if cat == "water":
            water.append(geom)
        elif cat is not None:
            features.append((cat, geom))

    lines = gpd.read_file(fp, layer="lines", engine="pyogrio", columns=["other_tags"], bbox=bbox)
    for geom, other in zip(lines.geometry, lines["other_tags"]):
        if geom is not None and not geom.is_empty and isinstance(other, str):
            if '"natural"=>"coastline"' in other:
                water.append(geom)
    return features, water


def build(features, water, bbox, cell_m: float):
    min_lon, min_lat, max_lon, max_lat = bbox
    mid_lat = (min_lat + max_lat) / 2
    d_lat = cell_m / M_PER_DEG_LAT
    d_lon = cell_m / (M_PER_DEG_LAT * math.cos(math.radians(mid_lat)))
    cols = max(1, math.ceil((max_lon - min_lon) / d_lon))
    rows = max(1, math.ceil((max_lat - min_lat) / d_lat))

    feat_geoms = [g for _, g in features]
    feat_tree = STRtree(feat_geoms) if feat_geoms else None
    water_tree = STRtree(water) if water else None

    factors = np.full((rows, cols), OPEN_FACTOR, dtype=np.float64)
    for r in range(rows):
        for c in range(cols):
            cell = box(
                min_lon + c * d_lon,
                min_lat + r * d_lat,
                min_lon + (c + 1) * d_lon,
                min_lat + (r + 1) * d_lat,
            )
            cell_area = cell.area

            # GEOS can still throw on a stray invalid geometry even after make_valid; skip the
            # offending polygon for this cell rather than aborting a multi-minute run.
            touches_water = False
            if water_tree is not None:
                for i in water_tree.query(cell):
                    try:
                        if water[i].intersects(cell):
                            touches_water = True
                            break
                    except Exception:
                        continue

            areas: dict[str, float] = {}
            if not touches_water and feat_tree is not None:
                # Union each category's intersections before measuring area, so overlapping
                # same-category polygons aren't double-counted (BLOCKER: forest+wood duplicates).
                per_cat: dict[str, list] = {}
                for i in feat_tree.query(cell):
                    try:
                        inter = feat_geoms[i].intersection(cell)
                    except Exception:
                        continue
                    if not inter.is_empty:
                        per_cat.setdefault(features[i][0], []).append(inter)
                for cat, geoms in per_cat.items():
                    areas[cat] = union_all(geoms).area

            factors[r, c] = cell_factor(areas, cell_area, touches_water)

    return factors, {
        "origin": {"lat": min_lat, "lon": min_lon},
        "dLat": d_lat,
        "dLon": d_lon,
        "cols": cols,
        "rows": rows,
        "cellSizeM": cell_m,
    }


def write_json(factors, meta: dict, out: Path) -> None:
    rows = len(factors)
    cols = len(factors[0]) if rows else 0
    doc = {
        "version": 1,
        **meta,
        "quant": {"min": FACTOR_MIN, "max": FACTOR_MAX},
        # factors[r][c] works for both a numpy 2-D array and a list of lists.
        "factorsB64": pack_factors_b64([[factors[r][c] for c in range(cols)] for r in range(rows)]),
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    size_mb = out.stat().st_size / 1e6  # budget is on the JSON, not the raw bytes
    print(f"wrote {out} ({rows}x{cols} cells, {size_mb:.2f} MB JSON)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the WindRide wind-exposure grid.")
    ap.add_argument("--region", default="Uusimaa", help="extract region name (see EXTRACTS)")
    ap.add_argument("--pbf", help="path to a local .osm.pbf instead of downloading")
    ap.add_argument("--cell", type=float, default=250.0, help="cell size in metres")
    ap.add_argument(
        "--bbox",
        nargs=4,
        type=float,
        metavar=("MINLON", "MINLAT", "MAXLON", "MAXLAT"),
        help=f"grid coverage; defaults to the Helsinki region {DEFAULT_BBOX}",
    )
    ap.add_argument("--out", default="public/data/exposure-uusimaa.json")
    args = ap.parse_args()

    bbox = tuple(args.bbox) if args.bbox else DEFAULT_BBOX
    features, water = load_polygons(args.region, args.pbf, bbox)
    factors, meta = build(features, water, bbox, args.cell)
    write_json(factors, meta, Path(args.out))


if __name__ == "__main__":
    main()
