"""Structural rules for the item tree, enforced by reading the source of app/."""
import re
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"
SOURCES = {p: p.read_text(encoding="utf-8") for p in APP.rglob("*.py")}

# a comparison, membership test or string/regex test on a field called period or horizon
SHAPE = re.compile(r"""\b(period|horizon)\b\s*(==|!=|\bin\b|\bis\b|\bnot in\b)|\b(period|horizon)\.(startswith|endswith|match)\b|"""
                   r"""(==|!=)\s*['"](now|next|someday)['"]""")


def test_only_item_rules_decides_a_kind_from_period_or_horizon():
    offenders = [f"{p.relative_to(APP)}:{n}: {l.strip()}" for p, src in SOURCES.items() if p.name != "item_rules.py"
                 for n, l in enumerate(src.splitlines(), 1) if SHAPE.search(l) and not l.lstrip().startswith("#")]
    assert not offenders, "ask app.services.item_rules instead:\n" + "\n".join(offenders)


def test_lint_pattern_catches_what_it_should():
    assert SHAPE.search("if item.period == '2026-Q4':") and SHAPE.search("x.horizon in ('now',)") and SHAPE.search("row.period.startswith('2026')")
    assert not SHAPE.search("period=item_rules.quarter_period(label)")


def test_nothing_writes_the_legacy_quarter_tables_behind_the_session():
    """The hook sees ORM instances in a flush. Core update()/raw SQL on these tables would leave the shadow stale."""
    bad = re.compile(r"update\(\s*(Quarter|QuarterStream)\b|planner_quarter|insert\(\s*(Quarter|QuarterStream)\b|Quarter(Stream)?\.__table__")
    offenders = [f"{p.relative_to(APP)}:{n}: {l.strip()}" for p, src in SOURCES.items()
                 if p.name != "tree_shadow.py" and p.parts[-3:-1] != ("app", "models")
                 for n, l in enumerate(src.splitlines(), 1) if bad.search(l)]
    assert not offenders, "\n".join(offenders)
    assert not re.search(r"\.query\(\s*(Quarter|QuarterStream)", "".join(SOURCES.values()))
