from datetime import date

from app.services.vault_parser import parse_daily_note

FULL_DAY = """---
id: 20260823-daily
mode: full
stars: 0
possible: 21
---
# Sunday, 23rd August, 2026

> [!soul]+ Soul
> - [ ] ⭐ Prayed 5x Fard
> - [x] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah

> [!onething]+ ONE Thing
> - [ ] ⭐ Learned / read / practiced
> - [ ] ⭐⭐ Solid learning session
> - [x] ⭐⭐⭐ Deep study + built something

## Focus
- Most important thing today: ship the vault dashboard

## Tasks

## Log
- entry one
- entry two

## Captured (triage later)
"""

ALIAS_DRIFT_DAY = """---
mode: full
possible: 21
---
> [!mind]+ Mind
> - [ ] ⭐ Learned / read / practiced
> - [x] ⭐⭐ Solid learning session
> - [ ] ⭐⭐⭐ Deep study + built something

> [!operating]+ Operating
> - [x] ⭐ Bare minimum done
> - [ ] ⭐⭐ Good Enough
> - [ ] ⭐⭐⭐ Great work — extra mile
"""

MINIMAL_DAY_STALE_POSSIBLE = """---
mode: minimal
stars: 0
possible: 21
---
> [!soul]+ Soul
> - [x] ⭐ Prayed 5x Fard
> - [ ] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah
"""

UNCHECKED_DAY = """---
mode: full
possible: 21
---
> [!sleep]+ Sleep
> - [ ] ⭐ Slept
> - [ ] ⭐⭐ Slept within 30min of Isha
> - [ ] ⭐⭐⭐ Slept right after Isha
"""


def test_parses_canonical_blocks_and_takes_checked_star_level():
    parsed = parse_daily_note(FULL_DAY, date(2026, 8, 23))
    assert parsed.blocks["soul"] == 2
    assert parsed.blocks["onething"] == 3
    assert parsed.mode == "full"
    assert parsed.possible == 21
    assert parsed.total == 5


def test_normalizes_legacy_block_names():
    parsed = parse_daily_note(ALIAS_DRIFT_DAY, date(2026, 8, 10))
    assert parsed.blocks["onething"] == 2
    assert parsed.blocks["ops"] == 1
    assert "mind" not in parsed.blocks
    assert "operating" not in parsed.blocks


def test_possible_comes_from_mode_meta_not_stale_frontmatter():
    # frontmatter says possible: 21, but mode: minimal caps at 12 per MODE_META
    parsed = parse_daily_note(MINIMAL_DAY_STALE_POSSIBLE, date(2026, 8, 15))
    assert parsed.possible == 12


def test_block_with_no_checked_box_is_zero():
    parsed = parse_daily_note(UNCHECKED_DAY, date(2026, 8, 16))
    assert parsed.blocks["sleep"] == 0


def test_extracts_focus_and_log():
    parsed = parse_daily_note(FULL_DAY, date(2026, 8, 23))
    assert parsed.focus == "Most important thing today: ship the vault dashboard"
    assert parsed.log == "- entry one\n- entry two"


def test_block_never_mentioned_is_absent_not_zero():
    parsed = parse_daily_note(FULL_DAY, date(2026, 8, 23))
    assert "ops" not in parsed.blocks
    assert "body" not in parsed.blocks
