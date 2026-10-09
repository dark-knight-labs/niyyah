from app.services.planner_defaults import COLOR_KEYS, STARTER_BLOCKS, STARTER_WEEKDAY, STARTER_WEEKEND
from app.services.rules import COLORS, SLUG


def test_colour_keys_match_the_stream_palette():
    assert tuple(COLOR_KEYS) == COLORS


def test_every_starter_block_is_well_formed():
    keys = [b["key"] for b in STARTER_BLOCKS]
    assert len(keys) == len(set(keys))
    for b in STARTER_BLOCKS:
        assert SLUG.match(b["key"]) and b["color"] in COLOR_KEYS and 1 <= len(b["ring_name"]) <= 6 and b["label"].strip()


def test_starter_schedule_only_uses_starter_blocks():
    keys = {b["key"] for b in STARTER_BLOCKS}
    assert {r["block"] for r in STARTER_WEEKDAY + STARTER_WEEKEND} <= keys
