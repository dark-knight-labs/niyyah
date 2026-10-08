"""Database read path: the data the vault notes hold, for one user, in the dict shapes the vault parsers return.

`line` carries the row id and `hash` is empty; the frontend moves to ids in phase 3.
"""
from datetime import date

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerCalendarFeed, Quarter, QuarterStream, PlannerScheduleBlock, PlannerScheduleSetting, Task,
    WeekObjective,
)
from app.services.vault_goals import MAX_GOALS
from app.services.vault_notebook import _URL
from app.services.vault_objectives import weekly_streams
from app.services.vault_pipeline import STALE_DAYS
from app.services.vault_quarter import quarter_for
from app.services.vault_streams import Stream, default_streams
from app.services.vault_tasks import line_hash


async def _all(db: AsyncSession, stmt) -> list:
    return list((await db.execute(stmt)).scalars().all())


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _stream(row: QuarterStream) -> Stream:
    return Stream(id=row.slug, name=row.name, color=row.color, icon=row.icon, slot=row.slot, weekly=row.weekly,
                  goal=row.has_pipeline, status=row.status)


async def streams_for(db: AsyncSession, user_id: int, today: date) -> list[Stream]:
    """The streams of today's quarter; the built-ins stand in until that quarter exists, as with the vault note."""
    rows = await _all(db, select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == quarter_for(today)).order_by(QuarterStream.position))
    return [_stream(r) for r in rows] or default_streams()


async def day_tasks(db: AsyncSession, user_id: int, day: date) -> list[dict]:
    rows = await _all(db, select(Task).where(
        Task.user_id == user_id, or_(Task.due_on == day, Task.scheduled_on == day, Task.start_on == day))
        .order_by(func.coalesce(Task.source_path, ""), Task.position))
    return [{"path": r.source_path or "", "line": r.id, "hash": "", "text": r.text, "done": r.done} for r in rows]


async def day_log(db: AsyncSession, user_id: int, day: date) -> list[dict]:
    rows = await _all(db, select(LogEntry).where(LogEntry.user_id == user_id, LogEntry.day == day).order_by(LogEntry.position))
    return [{"index": r.position, "hash": line_hash(r.text), "text": r.text} for r in rows]


async def goals(db: AsyncSession, user_id: int) -> list[dict]:
    rows = await _all(db, select(Goal).where(Goal.user_id == user_id).order_by(Goal.position))
    return [{"title": r.title, "value": r.value, "caption": r.caption, "progress": r.progress} for r in rows][:MAX_GOALS]


async def quarter_data(db: AsyncSession, user_id: int, label: str) -> dict | None:
    """What parse_quarter returns for the note, or None when this quarter was never imported or created."""
    quarter = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == label))).scalar_one_or_none()
    if quarter is None:
        return None
    rows = await _all(db, select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label, QuarterStream.in_note.is_(True)).order_by(QuarterStream.position))
    return {
        "quarter": label, "starts": _iso(quarter.starts), "ends": _iso(quarter.ends),
        "objective": quarter.objective, "objective_ar": quarter.objective_ar,
        "streams": [{"stream": r.slug, "info": _stream(r), "goal": r.goal, "status": r.status,
                     "checkpoints": list(r.checkpoints or [])} for r in rows],
    }


async def week_objectives(db: AsyncSession, user_id: int, week: str, streams: list[Stream]) -> list[dict]:
    """One {stream, text, done, checkpoint} per weekly stream, empty where nothing is stored (as parse_objectives does)."""
    stored = {r.stream: r for r in await _all(db, select(WeekObjective).where(
        WeekObjective.user_id == user_id, WeekObjective.week == week))}
    out = []
    for s in weekly_streams(streams):
        r = stored.get(s.id)
        out.append({"stream": s.id, "text": r.text, "done": r.done, "checkpoint": r.checkpoint} if r
                   else {"stream": s.id, "text": "", "done": False, "checkpoint": None})
    return out


async def pipeline_items(db: AsyncSession, user_id: int, today: date) -> dict[str, list[dict]]:
    rows = await _all(db, select(PipelineItem).where(PipelineItem.user_id == user_id).order_by(PipelineItem.position))
    out: dict[str, list[dict]] = {}
    for r in rows:
        age = (today - r.added_on).days if r.added_on else 0
        out.setdefault(r.stream, []).append({
            "product": r.product, "line": r.id, "hash": "", "text": r.text, "lane": r.lane, "checkpoint": r.checkpoint,
            "added": _iso(r.added_on), "done_on": _iso(r.done_on), "focus": r.focus_week, "done": r.done, "age_days": age,
            "description": r.description, "blocked_by": list(r.blocked_by or []),
            "stale": r.lane in ("next", "backlog") and r.checkpoint is None and age >= STALE_DAYS,
        })
    return out


async def notebook_entries(db: AsyncSession, user_id: int) -> dict[str, list[dict]]:
    rows = await _all(db, select(NotebookEntry).where(NotebookEntry.user_id == user_id).order_by(NotebookEntry.position))
    out: dict[str, list[dict]] = {}
    for r in rows:
        url = _URL.search(r.body)
        out.setdefault(r.stream, []).append({
            "line": r.id, "id": r.ext_id, "hash": "", "kind": r.kind, "title": r.title, "date": r.entry_date, "body": r.body,
            "open": r.is_open if r.kind == "blocker" else None, "url": url.group(0) if url else None,
        })
    return out


async def schedule(db: AsyncSession, user_id: int) -> dict | None:
    setting = (await db.execute(select(PlannerScheduleSetting).where(PlannerScheduleSetting.user_id == user_id))).scalar_one_or_none()
    if setting is None:
        return None
    rows = await _all(db, select(PlannerScheduleBlock).where(PlannerScheduleBlock.user_id == user_id).order_by(PlannerScheduleBlock.position))
    days: dict[str, list[dict]] = {}
    for r in rows:
        days.setdefault(r.day_type, []).append({"block": r.block, "start": r.start, "end": r.end, "what": r.what})
    return {"meta": dict(setting.meta), "days": days, "errors": []}


async def calendar_feeds(db: AsyncSession, user_id: int) -> list[dict]:
    rows = await _all(db, select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id).order_by(PlannerCalendarFeed.position))
    return [{"name": r.name, "url": r.url, "color": r.color, "email": r.email} for r in rows]
