"""Unit tests for the exposure classifier (run manually: `pytest` in this dir).

These are the WR-018 Python contract tests. They use synthetic tag dicts and area maps — no .pbf
fixture needed to exercise the classification logic, which is what carries the domain risk.
"""

from classify import category_for_tags, cell_factor, pack_factors_b64, quantize


def test_category_for_tags():
    assert category_for_tags({"natural": "wood"}) == "forest"
    assert category_for_tags({"landuse": "forest"}) == "forest"
    assert category_for_tags({"landuse": "residential"}) == "suburban"
    assert category_for_tags({"landuse": "industrial"}) == "urban"
    assert category_for_tags({"landuse": "farmland"}) == "open"
    assert category_for_tags({"natural": "water"}) == "water"
    assert category_for_tags({"natural": "coastline"}) == "water"  # open coast detection
    assert category_for_tags({"natural": "wetland"}) == "open"  # exposed, not water
    assert category_for_tags({"leisure": "park"}) == "mixed"
    assert category_for_tags({"highway": "primary"}) is None


def test_cell_factor_single_category():
    assert cell_factor({"forest": 1.0}, 1.0, touches_water=False) == 0.35
    assert cell_factor({"open": 1.0}, 1.0, touches_water=False) == 1.00


def test_cell_factor_area_weighted():
    # Half forest (0.35), half open (1.0) -> 0.675
    assert cell_factor({"forest": 0.5, "open": 0.5}, 1.0, touches_water=False) == 0.675


def test_cell_factor_unclassified_counts_as_open():
    # 40% forest, 60% unclassified (treated as open): 0.4*0.35 + 0.6*1.0 = 0.74
    assert abs(cell_factor({"forest": 0.4}, 1.0, touches_water=False) - 0.74) < 1e-9


def test_cell_factor_water_adjacency_overrides():
    assert cell_factor({"forest": 1.0}, 1.0, touches_water=True) == 1.15


def test_cell_factor_overlapping_categories_stay_in_range():
    # Park (0.50) fully overlapping residential (0.60), both covering the whole cell → areas sum to
    # 2x the cell. Must normalise to the weighted mean (0.55), never blow past the category range.
    f = cell_factor({"mixed": 1.0, "suburban": 1.0}, 1.0, touches_water=False)
    assert abs(f - 0.55) < 1e-9


def test_quantize_clamps():
    assert quantize(0.35) == 0
    assert quantize(1.15) == 255
    assert quantize(0.75) == round((0.75 - 0.35) / 0.8 * 255)
    assert quantize(2.0) == 255  # clamps
    assert quantize(0.0) == 0


def test_pack_factors_b64_golden():
    # Cross-language contract with src/data/exposureGrid.ts and fixtures/exposure/golden-grid.json.
    # Bytes [0,128,255,64,191,100] (row-major from SW) base64-encode to "AID/QL9k".
    factors = [
        [0.35 + b / 255 * 0.8 for b in (0, 128, 255)],
        [0.35 + b / 255 * 0.8 for b in (64, 191, 100)],
    ]
    assert pack_factors_b64(factors) == "AID/QL9k"
