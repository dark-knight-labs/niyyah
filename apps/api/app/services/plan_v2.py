"""Plan v2: a task's goal and label, reordering within a lane, and a new quarter that carries last quarter's blocks.

A task is a planner_tasks row with a lane (see planner_work). `goal_ref` nests it under one quarter goal (the id of a line
of its stream's goal checklist); `label_month` ('YYYY-MM') or `label_date` labels it, never both. Same contract as
planner_work: flush, never commit; a ValueError carries the message the API returns as a 422.
"""
import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models.planner import QuarterStream, Task
from app.services import planner_work
from app.services.rules import MONTHS, checklist_from_text, quarter_for

MONTH_LABEL = re.compile(r"^[0-9]{4}-(0[1-9]|1[0-2])$")


def month_label(year: int, month_key: str) -> str:
    """('2026', 'nov') -> '2026-11'."""
    return f"{year}-{MONTHS.index(month_key) + 1:02d}"


def checkpoint_of(label: str | None, label_quarter: str) -> str | None:
    """The 3-letter month of a 'YYYY-MM' label when it falls in `label_quarter` ('2026-Q4'), else None: the legacy checkpoint."""
    if not label or quarter_for(date(int(label[:4]), int(label[5:]), 1)) != label_quarter:
        return None
    return MONTHS[int(label[5:]) - 1]


def goal_lines(row: QuarterStream) -> list[dict]:
    return list(row.goal_checklist or checklist_from_text(row.goal))


async def set_goal(db, user_id: int, stream: str, item_id: int, goal_ref: str | None, today: date) -> None:
    """Nest an item under one of its stream's goals this quarter, or un-nest it (None)."""
    row = await planner_work.item_row(db, user_id, stream, item_id)
    if goal_ref is not None:
        stream_row = next((r for r in await planner_work._stream_rows(db, user_id, quarter_for(today)) if r.slug == stream), None)
        if stream_row is None or goal_ref not in {g["id"] for g in goal_lines(stream_row)}:
            raise ValueError(f"'{goal_ref}' is not a goal of {stream} this quarter")
    row.goal_ref = goal_ref


async def set_label(db, user_id: int, stream: str, item_id: int, month: str | None, day: date | None, today: date) -> None:
    """Label an item with a month ('YYYY-MM') or a day; neither clears the label. The legacy checkpoint follows the month."""
    if month is not None and day is not None:
        raise ValueError("send a month or a date, not both")
    if month is not None and not MONTH_LABEL.match(month):
        raise ValueError("month must look like 2026-11")
    row = await planner_work.item_row(db, user_id, stream, item_id)
    row.label_month = month
    row.label_date = day
    row.checkpoint = checkpoint_of(month, quarter_for(today))


async def reorder(db, user_id: int, stream: str, item_id: int, direction: str) -> None:
    """Move an item one place up or down among the stream's items in its lane (the order Next is prioritised in)."""
    if direction not in ("up", "down"):
        raise ValueError("direction must be up or down")
    row = await planner_work.item_row(db, user_id, stream, item_id)
    rows = list((await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream == stream, Task.lane == row.lane)
        .order_by(Task.lane_position, Task.id))).scalars().all())
    at = next(i for i, r in enumerate(rows) if r.id == row.id)
    to = at - 1 if direction == "up" else at + 1
    if not 0 <= to < len(rows):
        return
    rows[at], rows[to] = rows[to], rows[at]
    slots = sorted(r.lane_position or 0 for r in rows)
    if len(set(slots)) != len(slots):  # equal positions cannot hold an order: renumber the lane from its first slot
        slots = [slots[0] + i for i in range(len(rows))]
    for r, slot in zip(rows, slots):
        r.lane_position = slot


async def carry_streams(db, user_id: int, today: date) -> int:
    """A quarter with no blocks starts from the latest earlier quarter's: same blocks, empty goals and checkpoints.

    Idempotent: nothing happens when the quarter has blocks. Two requests racing to do it hit the unique (user, quarter,
    slug) index; the loser's insert is rolled back to a savepoint and it reads what the winner wrote. Returns blocks added."""
    label = quarter_for(today)
    mine = (await db.execute(select(QuarterStream.id).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label).limit(1))).first()
    if mine is not None:
        return 0
    earlier = (await db.execute(select(QuarterStream.quarter).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter < label).order_by(QuarterStream.quarter.desc()).limit(1))).scalar()
    if earlier is None:
        return 0
    source = await planner_work._stream_rows(db, user_id, earlier)
    try:
        async with db.begin_nested():
            await planner_work.ensure_quarter(db, user_id, label)
            db.add_all([QuarterStream(
                user_id=user_id, quarter=label, slug=r.slug, name=r.name, color=r.color, icon=r.icon, slot=r.slot, weekly=r.weekly,
                has_pipeline=r.has_pipeline, in_note=r.in_note, status=r.status, goal="", goal_checklist=[], checkpoints=[],
                position=r.position) for r in source])
            await db.flush()
    except IntegrityError:
        return 0
    return len(source)

