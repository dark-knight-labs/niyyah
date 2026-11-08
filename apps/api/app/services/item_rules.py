"""The one place that decides what an item IS. An item has no stored kind: its kind follows from the shape of its fields.

Rules (first match wins):
  quarter goal   period is a quarter ("2026-Q4") and no parent
  checkpoint     parent is a quarter goal and period is a month ("2026-10")
  checklist line parent set, no period, no horizon
  work item      horizon set and period is not a quarter
  other          anything else (not produced by any writer yet)
A Super Objective is a quarter goal with no area. A week focus is a work item with horizon "now" and a week period.
Goals carry a commitment instead of a horizon, so a goal never shows up as work as well.
Every other module asks this one; a test fails if one of them branches on period or horizon itself.
"""
import re

GOAL, CHECKPOINT, LINE, WORK, OTHER = "goal", "checkpoint", "line", "work", "other"
HORIZONS = ("now", "next", "someday")
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")

_QUARTER = re.compile(r"^\d{4}-Q[1-4]$")
_MONTH = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_WEEK = re.compile(r"^\d{4}-W\d{2}$")


def kind_of(period: str | None, horizon: str | None, has_parent: bool, parent_kind: str | None = None) -> str:
    is_quarter = bool(period and _QUARTER.match(period))
    if is_quarter and not has_parent:
        return GOAL
    if has_parent and parent_kind == GOAL and period and _MONTH.match(period):
        return CHECKPOINT
    if has_parent and not period and not horizon:
        return LINE
    if horizon and not is_quarter:
        return WORK
    return OTHER


def is_super_objective(kind: str, area: str | None) -> bool:
    return kind == GOAL and area is None


def is_week_focus(kind: str, period: str | None, horizon: str | None) -> bool:
    return kind == WORK and horizon == "now" and bool(period and _WEEK.match(period))


def quarter_period(label: str) -> str:
    """The period of a quarter goal: the legacy label itself."""
    return label


def month_period(label: str, month: str) -> str | None:
    """'oct' in '2026-Q4' -> '2026-10'. A month outside the quarter keeps its computed YYYY-MM. None for an unknown month."""
    if month not in MONTHS:
        return None
    return f"{label[:4]}-{MONTHS.index(month) + 1:02d}"


def month_key(period: str) -> str:
    """'2026-10' -> 'oct'."""
    return MONTHS[int(period[5:7]) - 1]
