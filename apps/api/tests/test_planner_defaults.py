from app.services.planner_defaults import COLOR_KEYS, DEFAULT_BLOCKS, STARTER_BLOCKS, STARTER_WEEKDAY, STARTER_WEEKEND, legacy_stream
from app.services.vault_streams import COLORS, SLUG


def test_colour_keys_match_the_stream_palette():
    assert tuple(COLOR_KEYS) == COLORS


def test_every_default_and_starter_block_is_well_formed():
    for blocks in (DEFAULT_BLOCKS, STARTER_BLOCKS):
        keys = [b["key"] for b in blocks]
        assert len(keys) == len(set(keys))
        for b in blocks:
            assert SLUG.match(b["key"]) and b["color"] in COLOR_KEYS and 1 <= len(b["ring_name"]) <= 6 and b["label"].strip()


def test_starter_schedule_only_uses_starter_blocks():
    keys = {b["key"] for b in STARTER_BLOCKS}
    assert {r["block"] for r in STARTER_WEEKDAY + STARTER_WEEKEND} <= keys


def test_legacy_rule_gives_the_ot_slot_to_kahf_on_weekdays_and_alisha_on_weekends():
    assert legacy_stream("ot", "weekday") == "kahf" and legacy_stream("ot", "weekend") == "alisha"
    assert legacy_stream("soul", "weekday") is None
