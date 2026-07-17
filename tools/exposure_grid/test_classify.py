"""Unit tests for the exposure classifier (run manually: `pytest` in this dir).

These are the WR-018 Python contract tests. They use synthetic tag dicts and area maps — no .pbf
fixture needed to exercise the classification logic, which is what carries the domain risk.
"""

from classify import category_for_tags, cell_factor, quantize


def test_category_for_tags():
    assert category_for_tags({"natural": "wood"}) == "forest"
    assert category_for_tags({"landuse": "forest"}) == "forest"
    assert category_for_tags({"landuse": "residential"}) == "suburban"
    assert category_for_tags({"landuse": "industrial"}) == "urban"
    assert category_for_tags({"landuse": "farmland"}) == "open"
    assert category_for_tags({"natural": "water"}) == "water"
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


def test_quantize_round_trip():
    assert quantize(0.35) == 0
    assert quantize(1.15) == 255
    assert quantize(0.75) == round((0.75 - 0.35) / 0.8 * 255)
    assert quantize(2.0) == 255  # clamps
    assert quantize(0.0) == 0
