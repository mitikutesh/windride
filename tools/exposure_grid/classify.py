"""Land-cover → wind-exposure classification (WR-018, SCORING_SPEC §2, DEC-006).

Pure functions, unit-tested with synthetic inputs (no .pbf needed). The grid builder
(build_grid.py) supplies per-cell category areas; here we turn OSM tags into a category and
category areas into a single exposure factor. Keep it simple — accuracy improves later.
"""

from __future__ import annotations

# Exposure factor per land-cover category (config; defaults from the story).
CATEGORY_FACTOR: dict[str, float] = {
    "forest": 0.35,     # dense forest — most sheltered
    "mixed": 0.50,      # mixed / semi-open (parks, gardens)
    "urban": 0.45,      # dense built-up
    "suburban": 0.60,   # residential
    "open": 1.00,       # open fields — reference exposure
    "water": 1.15,      # water surface / coast — most exposed
}

OPEN_FACTOR = CATEGORY_FACTOR["open"]
# A cell that TOUCHES water (coast adjacency) is treated as fully exposed, per the story's
# technical note — adjacency drives 1.15, not being on the water itself.
WATER_ADJACENCY_FACTOR = 1.15

FACTOR_MIN = 0.35
FACTOR_MAX = 1.15


def category_for_tags(tags: dict[str, str]) -> str | None:
    """Map an OSM feature's tags to an exposure category, or None if irrelevant."""
    landuse = tags.get("landuse")
    natural = tags.get("natural")
    leisure = tags.get("leisure")

    if natural == "wood" or landuse == "forest":
        return "forest"
    if natural in ("water", "bay", "strait", "wetland") or landuse in ("reservoir", "basin"):
        # Wetlands/water bodies count as water for adjacency; open water handled by the builder.
        return "water"
    if landuse == "residential":
        return "suburban"
    if landuse in ("industrial", "commercial", "retail"):
        return "urban"
    if landuse in ("meadow", "farmland", "farmyard", "grass", "greenfield") or natural in (
        "grassland",
        "heath",
        "scrub",
        "fell",
    ):
        return "open"
    if leisure in ("park", "garden", "pitch"):
        return "mixed"
    return None


def cell_factor(
    category_areas: dict[str, float], cell_area: float, touches_water: bool
) -> float:
    """Area-weighted mean exposure for one grid cell.

    Unclassified area counts as open (1.0). A cell adjacent to water is 1.15 regardless of its
    land cover (coastal exposure dominates).
    """
    if touches_water:
        return WATER_ADJACENCY_FACTOR
    if cell_area <= 0:
        return OPEN_FACTOR

    classified = sum(category_areas.values())
    weighted = sum(
        area * CATEGORY_FACTOR.get(cat, OPEN_FACTOR) for cat, area in category_areas.items()
    )
    weighted += max(0.0, cell_area - classified) * OPEN_FACTOR  # unclassified → open
    return weighted / cell_area


def quantize(factor: float) -> int:
    """Factor in [FACTOR_MIN, FACTOR_MAX] → byte 0..255 (matches src/data/exposureGrid.ts)."""
    clamped = max(FACTOR_MIN, min(FACTOR_MAX, factor))
    return round((clamped - FACTOR_MIN) / (FACTOR_MAX - FACTOR_MIN) * 255)
