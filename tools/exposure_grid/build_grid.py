#!/usr/bin/env python3
"""Build the wind-exposure grid JSON from an OSM extract (WR-018, offline one-time).

Downloads the Geofabrik Uusimaa extract (cached by pyrosm), classifies land cover onto a 250 m
grid, and writes public/data/exposure-uusimaa.json in the compact format src/data/exposureGrid.ts
reads. Re-runnable for other regions via --region / --bbox.

    uv run build_grid.py                        # Uusimaa, 250 m, default output
    uv run build_grid.py --region Uusimaa --cell 250
    uv run build_grid.py --bbox 24.5 60.1 25.3 60.4 --out public/data/exposure-helsinki.json

NEVER run in CI (network + heavy). This is a manual preprocessing step; commit the output JSON.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from shapely import union_all
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


def load_polygons(region: str | None, pbf: str | None):
    """Return (features, water_geoms): classified polygons and water polygons, via pyrosm."""
    from pyrosm import OSM, get_data  # imported lazily so tests don't need pyrosm

    fp = pbf or get_data(region or "Uusimaa")
    osm = OSM(fp)
    landuse = osm.get_landuse()
    natural = osm.get_natural()

    features = []  # (category, shapely geometry)
    water = []
    seen: set = set()  # dedupe features shared across GDFs (e.g. landuse=forest + natural=wood)
    for gdf in (landuse, natural):
        if gdf is None:
            continue
        for _, row in gdf.iterrows():
            geom = row.geometry
            if geom is None or geom.is_empty:
                continue
            oid = row.get("id")
            if oid is not None and oid in seen:
                continue
            if oid is not None:
                seen.add(oid)
            tags = {
                k: row[k]
                for k in ("landuse", "natural", "leisure")
                if isinstance(row.get(k), str)
            }
            cat = category_for_tags(tags)
            if cat == "water":
                water.append(geom)
            elif cat is not None:
                features.append((cat, geom))
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

            touches_water = False
            if water_tree is not None:
                touches_water = any(water[i].intersects(cell) for i in water_tree.query(cell))

            areas: dict[str, float] = {}
            if not touches_water and feat_tree is not None:
                # Union each category's intersections before measuring area, so overlapping
                # same-category polygons aren't double-counted (BLOCKER: forest+wood duplicates).
                per_cat: dict[str, list] = {}
                for i in feat_tree.query(cell):
                    inter = feat_geoms[i].intersection(cell)
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
    ap.add_argument("--region", default="Uusimaa", help="pyrosm/Geofabrik region name")
    ap.add_argument("--pbf", help="path to a local .osm.pbf instead of downloading")
    ap.add_argument("--cell", type=float, default=250.0, help="cell size in metres")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("MINLON", "MINLAT", "MAXLON", "MAXLAT"))
    ap.add_argument("--out", default="public/data/exposure-uusimaa.json")
    args = ap.parse_args()

    features, water = load_polygons(args.region, args.pbf)
    if args.bbox:
        bbox = tuple(args.bbox)
    else:
        # Derive bbox from the union of feature bounds.
        geoms = [g for _, g in features] + water
        xs1, ys1, xs2, ys2 = zip(*(g.bounds for g in geoms))
        bbox = (min(xs1), min(ys1), max(xs2), max(ys2))

    factors, meta = build(features, water, bbox, args.cell)
    write_json(factors, meta, Path(args.out))


if __name__ == "__main__":
    main()
