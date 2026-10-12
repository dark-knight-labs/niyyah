"""Habits: what repeats. A habit lives in a day block, is checked off per day (done, or its minimum), and moves
installing -> rails -> retired. The gate (weeks at a percentage) and the tripwire (weeks under a percentage) are numbers the
user writes; this module counts them. Each function makes one change and flushes; the caller commits.
"""
import re
from datetime import date, timedelta

from sqlalchemy import delete, select

from app.models.planner import PlannerBlock, PlannerHabit, PlannerHabitCheck

STAGES = ("installing", "rails", "retired")
LEVELS = ("done", "min")
INSTALLING_LIMIT = 1  # the One Thing slot holds one install at a time; going over is a warning, never a block
HISTORY_WEEKS = 12
GONE = "this habit no longer exists; reload and try again"
STREAM = re.compile(r"^[a-z][a-z0-9-]{1,23}$")


def _week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _clean(fields: dict) -> dict:
    out = dict(fields)
    if "name" in out:
        out["name"] = " ".join(out["name"].split())
        if not 1 <= len(out["name"]) <= 200:
            raise ValueError("a habit needs a name of 1-200 characters")
    for key, limit in (("anchor", 60), ("minimum", 120)):
        if key in out:
            out[key] = " ".join((out[key] or "").split())
            if len(out[key]) > limit:
                raise ValueError(f"the {key} must be at most {limit} characters")
    if "per_week" in out and not 1 <= out["per_week"] <= 7:
        raise ValueError("per_week must be 1-7")
    if "stage" in out and out["stage"] not in STAGES:
        raise ValueError(f"unknown stage '{out['stage']}'")
    if "gate_pct" in out and not 1 <= out["gate_pct"] <= 100:
        raise ValueError("the gate percentage must be 1-100")
    if "gate_weeks" in out and not 1 <= out["gate_weeks"] <= 52:
        raise ValueError("the gate weeks must be 1-52")
    if out.get("trip_pct") is not None and not 1 <= out["trip_pct"] <= 100:
        raise ValueError("the tripwire percentage must be 1-100")
    if out.get("trip_weeks") is not None and not 1 <= out["trip_weeks"] <= 26:
        raise ValueError("the tripwire weeks must be 1-26")
    if out.get("stream") is not None and not STREAM.match(out["stream"]):
        raise ValueError("unknown stream")
    return out


async def _block_keys(db, user_id: int) -> set[str]:
    return set((await db.execute(select(PlannerBlock.key).where(PlannerBlock.user_id == user_id))).scalars().all())


async def _find(db, user_id: int, habit_id: int) -> PlannerHabit:
    row = (await db.execute(select(PlannerHabit).where(PlannerHabit.id == habit_id, PlannerHabit.user_id == user_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(GONE)
    return row


def _weeks(row: PlannerHabit, checks: dict[date, str], today: date) -> list[dict]:
    """The last HISTORY_WEEKS weeks, oldest first: how many days were checked and the share of the weekly target that is."""
    first = _week_start(today) - timedelta(weeks=HISTORY_WEEKS - 1)
    out = []
    for n in range(HISTORY_WEEKS):
        start = first + timedelta(weeks=n)
        count = sum(1 for d in range(7) if start + timedelta(days=d) in checks)
        pct = min(100, round(100 * count / row.per_week))
        out.append({"start": start.isoformat(), "count": count, "pct": pct, "current": start == _week_start(today)})
    return out


def _gate_run(row: PlannerHabit, weeks: list[dict]) -> int:
    """Consecutive weeks at the gate, ending now. The week in progress counts once it is met and never breaks the run before that."""
    run = 0
    for w in reversed(weeks):
        if w["pct"] >= row.gate_pct:
            run += 1
        elif w["current"]:
            continue
        else:
            break
    return run


def _tripwire(row: PlannerHabit, weeks: list[dict]) -> str | None:
    """None without a tripwire; 'fired' when each of the last trip_weeks finished weeks is under it, 'close' when all but one are."""
    if row.trip_pct is None or row.trip_weeks is None:
        return None
    since = _week_start(row.started_on).isoformat()  # weeks before the habit existed are not misses
    last = [w for w in weeks if not w["current"] and w["start"] >= since][-row.trip_weeks:]
    if len(last) < row.trip_weeks:
        return "quiet"
    under = sum(1 for w in last if w["pct"] < row.trip_pct)
    return "fired" if under == len(last) else "close" if under == len(last) - 1 and under > 0 else "quiet"


def _streak(checks: dict[date, str], today: date) -> int:
    """Days in a row with a check, ending today (an unchecked today does not break it)."""
    day, n = today, 0
    if day not in checks:
        day -= timedelta(days=1)
    while day in checks:
        n += 1
        day -= timedelta(days=1)
    return n


def _out(row: PlannerHabit, checks: dict[date, str], today: date) -> dict:
    weeks = _weeks(row, checks, today)
    run = _gate_run(row, weeks)
    span = HISTORY_WEEKS * 7 + today.weekday()
    return {
        "id": row.id, "name": row.name, "block": row.block, "anchor": row.anchor, "per_week": row.per_week, "minimum": row.minimum,
        "stage": row.stage, "stream": row.stream, "gate_pct": row.gate_pct, "gate_weeks": row.gate_weeks,
        "trip_pct": row.trip_pct, "trip_weeks": row.trip_weeks, "started_on": row.started_on.isoformat(),
        "today": checks.get(today), "streak": _streak(checks, today), "gate_run": run, "gate_met": run >= row.gate_weeks,
        "tripwire": _tripwire(row, weeks) if row.stage == "rails" else None, "weeks": weeks,
        "days": {d.isoformat(): lvl for d, lvl in checks.items() if (today - d).days < span},
    }


async def list_habits(db, user_id: int, today: date, include_retired: bool = True) -> list[dict]:
    rows = list((await db.execute(select(PlannerHabit).where(PlannerHabit.user_id == user_id)
                                  .order_by(PlannerHabit.position, PlannerHabit.id))).scalars().all())
    since = _week_start(today) - timedelta(weeks=HISTORY_WEEKS - 1)
    checks: dict[int, dict[date, str]] = {}
    for c in (await db.execute(select(PlannerHabitCheck).where(PlannerHabitCheck.user_id == user_id, PlannerHabitCheck.day >= since))).scalars():
        checks.setdefault(c.habit_id, {})[c.day] = c.level
    return [_out(r, checks.get(r.id, {}), today) for r in rows if include_retired or r.stage != "retired"]


async def add_habit(db, user_id: int, today: date, fields: dict) -> PlannerHabit:
    fields = _clean({"stage": "installing", "per_week": 7, "anchor": "", "minimum": "", "gate_pct": 80, "gate_weeks": 8, **fields})
    if "name" not in fields:
        raise ValueError("a habit needs a name")
    if fields.get("block") not in await _block_keys(db, user_id):
        raise ValueError(f"unknown block '{fields.get('block')}'")
    count = len((await db.execute(select(PlannerHabit.id).where(PlannerHabit.user_id == user_id))).scalars().all())
    row = PlannerHabit(user_id=user_id, started_on=today, position=count, **fields)
    db.add(row)
    await db.flush()
    return row


async def update_habit(db, user_id: int, today: date, habit_id: int, fields: dict, force: bool = False) -> PlannerHabit:
    row = await _find(db, user_id, habit_id)
    fields = _clean(fields)
    if "block" in fields and fields["block"] not in await _block_keys(db, user_id):
        raise ValueError(f"unknown block '{fields['block']}'")
    new_stage = fields.get("stage", row.stage)
    if new_stage == "rails" and row.stage == "installing":
        # Demoting needs a tripwire (written now, while you still care) and a met gate, unless you say why you are overriding.
        trip_pct = fields.get("trip_pct", row.trip_pct)
        trip_weeks = fields.get("trip_weeks", row.trip_weeks)
        if trip_pct is None or trip_weeks is None:
            raise ValueError("write the tripwire before moving this habit to rails")
        gate_pct = fields.get("gate_pct", row.gate_pct)
        if trip_pct >= gate_pct:
            raise ValueError("the tripwire must sit below the gate, or the first ordinary dip sends the habit back")
        if not force:
            current = next(h for h in await list_habits(db, user_id, today) if h["id"] == habit_id)
            if not current["gate_met"]:
                raise ValueError(f"the gate is not met yet: {current['gate_run']} of {row.gate_weeks} weeks at {row.gate_pct}%")
    for key, value in fields.items():
        setattr(row, key, value)
    await db.flush()
    return row


async def remove_habit(db, user_id: int, habit_id: int) -> None:
    row = await _find(db, user_id, habit_id)
    await db.execute(delete(PlannerHabitCheck).where(PlannerHabitCheck.habit_id == row.id))
    await db.delete(row)
    await db.flush()


async def set_check(db, user_id: int, habit_id: int, day: date, level: str | None) -> None:
    """Record `level` for the day, or clear it with None."""
    if level is not None and level not in LEVELS:
        raise ValueError("level must be 'done', 'min' or null")
    row = await _find(db, user_id, habit_id)
    existing = (await db.execute(select(PlannerHabitCheck).where(PlannerHabitCheck.habit_id == row.id, PlannerHabitCheck.day == day))).scalar_one_or_none()
    if level is None:
        if existing is not None:
            await db.delete(existing)
    elif existing is not None:
        existing.level = level
    else:
        db.add(PlannerHabitCheck(user_id=user_id, habit_id=row.id, day=day, level=level))
    await db.flush()
