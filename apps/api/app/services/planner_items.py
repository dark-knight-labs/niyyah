"""Items: the user's own tasks and the calendar events they annotated, read over a range of days and written by one set of rules.

An own item is a planner_tasks row. A time (start_min/end_min) belongs to its `scheduled_on` date only: a task that also
has a due or start date shows on those days too, all day. A calendar event's title and time always come from its feed;
the user's additions live in planner_event_overlays, matched by event key. Writes flush; the caller commits.
"""
from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import EventOverlay, Task
from app.services.planner_day import _known_stream, _task_fields, set_status
from app.services.rules import (
    HASHTAG, MAX_DESCRIPTION_CHARS, clean_minutes, clean_status, clean_subtasks, clean_weight, item_status, item_tags,
)

MAX_RANGE_DAYS = 14
MAX_KEY_CHARS = 400
MAX_ORPHAN_LOOKUPS = 10  # Calendar API lookups per read for overlays the range did not show

# Run after every rollout, rollback or roll-forward: older code writes only `done`, so `status` is made to agree (`done` wins).
RECONCILE_SQL = ("UPDATE planner_tasks SET status = CASE WHEN done THEN 'done' WHEN status = 'done' THEN 'open' ELSE status END "
                 "WHERE done <> (status = 'done')")


class ItemNotFound(LookupError):
    """No such item for this user (another user's item is reported the same way)."""


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def task_item(task: Task, day: date | None) -> dict:
    """A task as an item on `day`; its time shows only on its scheduled date."""
    timed = task.start_min is not None and task.scheduled_on is not None and task.scheduled_on == day
    return {
        "kind": "task", "id": task.id, "key": None, "day": _iso(day), "title": task.text,
        "status": item_status(task.done, task.status), "done": task.done, "weight": task.weight, "stream": task.stream,
        "products": list(task.products or []), "description": task.description or "", "checklist": list(task.checklist or []),
        "all_day": not timed, "start_min": task.start_min if timed else None, "end_min": task.end_min if timed else None,
        "due_on": _iso(task.due_on), "scheduled_on": _iso(task.scheduled_on), "start_on": _iso(task.start_on),
        "path": task.source_path or "",
    }


def _home_day(task: Task) -> date | None:
    return task.scheduled_on or task.due_on or task.start_on


def written_task(task: Task) -> dict:
    return task_item(task, _home_day(task))


def overlay_fields(overlay: EventOverlay | None) -> dict:
    """The annotation an event carries; defaults when it has none."""
    if overlay is None:
        return {"annotated": False, "status": "open", "done": False, "weight": 0, "stream": None, "products": [], "description": "", "checklist": []}
    return {"annotated": True, "status": item_status(overlay.status == "done", overlay.status), "done": overlay.status == "done", "weight": overlay.weight, "stream": overlay.stream,
            "products": list(overlay.products or []), "description": overlay.description or "", "checklist": list(overlay.checklist or [])}


def overlay_out(overlay: EventOverlay) -> dict:
    return {"key": overlay.event_key, "calendar": overlay.source_calendar, "title": overlay.title, "day": _iso(overlay.day),
            **overlay_fields(overlay)}


def event_item(event: dict, overlay: EventOverlay | None) -> dict:
    return {
        "kind": "event", "id": None, "key": event["key"], "day": event["day"].isoformat(), "title": event["title"],
        "event_id": event["id"], "uid": event["uid"], "instance": event["instance"], "calendar": event["calendar"],
        "color": event["color"], "location": event["location"], "meeting_url": event["meeting_url"],
        "all_day": event["all_day"], "start_min": event["start_min"], "end_min": event["end_min"], **overlay_fields(overlay),
    }


def check_range(first: date, last: date) -> None:
    if last < first:
        raise ValueError("`to` must not be before `from`")
    if (last - first).days + 1 > MAX_RANGE_DAYS:
        raise ValueError(f"at most {MAX_RANGE_DAYS} days at a time")


async def tasks_in_range(db: AsyncSession, user_id: int, first: date, last: date) -> list[dict]:
    """Own items per day: a task shows on each of its due, scheduled and start dates that fall in the range."""
    inside = lambda col: and_(col >= first, col <= last)  # noqa: E731
    rows = (await db.execute(select(Task).where(Task.user_id == user_id, or_(inside(Task.due_on), inside(Task.scheduled_on), inside(Task.start_on)))
                             .order_by(func.coalesce(Task.source_path, ""), Task.position, Task.id))).scalars().all()
    out = []
    for task in rows:
        for day in sorted({d for d in (task.due_on, task.scheduled_on, task.start_on) if d is not None and first <= d <= last}):
            out.append(task_item(task, day))
    return out


async def overlays_for(db: AsyncSession, user_id: int) -> list[EventOverlay]:
    return list((await db.execute(select(EventOverlay).where(EventOverlay.user_id == user_id).order_by(EventOverlay.id))).scalars().all())


def key_uid(key: str) -> str | None:
    """The UID a key was made from; None for a no-UID key (`t|...`)."""
    if key.startswith("t|"):
        return None
    uid, sep, instance = key.rpartition("|")
    return uid if sep and instance[:8].isdigit() else key


def orphan_candidates(overlays: list[EventOverlay], seen: set[str], errors: list[str], uids: set[str], first: date, last: date) -> tuple[list[EventOverlay], list[EventOverlay]]:
    """(orphans, to_check). An overlay is only in question when every feed was read, it was last seen in the range and its key
    did not show. A UID a feed still holds (the event moved, or another occurrence shows) is not an orphan; one no read
    feed holds goes to `to_check` (the caller asks Google, if one is connected) or is an orphan."""
    if errors:
        return [], []
    orphans, to_check = [], []
    for overlay in overlays:
        if overlay.event_key in seen or overlay.day is None or not first <= overlay.day <= last:
            continue
        uid = key_uid(overlay.event_key)
        if uid is None:
            orphans.append(overlay)
        elif uid not in uids:
            to_check.append(overlay)
    return orphans, to_check


# --- Writes -------------------------------------------------------------------------------------------------------

async def _own_task(db: AsyncSession, user_id: int, task_id: int) -> Task:
    task = (await db.execute(select(Task).where(Task.user_id == user_id, Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise ItemNotFound("no such item")
    return task


def _description(text: str) -> str:
    if len(text) > MAX_DESCRIPTION_CHARS:
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    return text.strip()


async def _annotate(db: AsyncSession, user_id: int, row, fields: dict, text_tags: list[str] | None = None) -> None:
    """Fields shared by tasks and overlays: weight, stream, tags (a list and #words in the notes), notes, sub-tasks."""
    if "weight" in fields:
        row.weight = clean_weight(fields["weight"])
    if "stream" in fields:
        row.stream = await _known_stream(db, user_id, fields["stream"])
    if "description" in fields:
        row.description = _description(fields["description"] or "")
    if "checklist" in fields:
        row.checklist = clean_subtasks(fields["checklist"])
    if "products" in fields or "description" in fields or text_tags:
        listed = fields["products"] if "products" in fields else list(row.products or [])
        noted = HASHTAG.findall(fields["description"] or "") if "description" in fields else []
        row.products = item_tags(listed or [], text_tags or [], noted)


def _set_time(task: Task, fields: dict) -> None:
    if "start_min" in fields or "end_min" in fields:
        task.start_min, task.end_min = clean_minutes(fields.get("start_min"), fields.get("end_min"))
    if task.start_min is not None and task.scheduled_on is None:
        raise ValueError("a time needs a scheduled day: send `day` too")


async def create_item(db: AsyncSession, user_id: int, day: date, fields: dict, today: date) -> Task:
    """A new own item scheduled on `day`; `#word`s in its text become tags. No time = all day."""
    label, tags = _task_fields(fields["text"])
    top = (await db.execute(select(func.max(Task.position)).where(Task.user_id == user_id))).scalar()
    task = Task(user_id=user_id, text=label, products=[], done=False, status="open", scheduled_on=day, weight=0, checklist=[],
                description="", source_path=f"Calendar/Daily/{day.isoformat()}.md", position=0 if top is None else top + 1)
    _set_time(task, fields)
    await _annotate(db, user_id, task, fields, tags)
    if fields.get("status"):
        set_status(task, fields["status"], today)
    db.add(task)
    await db.flush()
    return task


async def update_item(db: AsyncSession, user_id: int, task_id: int, fields: dict, today: date) -> Task:
    """Change the fields sent. `day` reschedules (scheduled_on; due and start dates stay); a time needs a scheduled day."""
    task = await _own_task(db, user_id, task_id)
    text_tags = None
    if "text" in fields:
        task.text, text_tags = _task_fields(fields["text"])
    if fields.get("day") is not None:
        task.scheduled_on = fields["day"]
    _set_time(task, fields)
    await _annotate(db, user_id, task, fields, text_tags)
    if "status" in fields:
        set_status(task, fields["status"], today)
    await db.flush()
    return task


async def remove_item(db: AsyncSession, user_id: int, task_id: int) -> None:
    await db.delete(await _own_task(db, user_id, task_id))
    await db.flush()


async def upsert_overlay(db: AsyncSession, user_id: int, key: str, fields: dict) -> EventOverlay:
    """Annotate a calendar event: create its overlay on first write. `title`, `day` and `calendar` are cached for orphans and exports."""
    key = key.strip()
    if not key or len(key) > MAX_KEY_CHARS:
        raise ValueError(f"event key must be 1-{MAX_KEY_CHARS} characters")
    overlay = (await db.execute(select(EventOverlay).where(EventOverlay.user_id == user_id, EventOverlay.event_key == key))).scalar_one_or_none()
    if overlay is None:
        overlay = EventOverlay(user_id=user_id, event_key=key, source_calendar="", title="", status="open", weight=0, products=[],
                               description="", checklist=[])
        db.add(overlay)
    if fields.get("title") is not None:
        overlay.title = " ".join(fields["title"].split())[:300]
    if fields.get("calendar") is not None:
        overlay.source_calendar = fields["calendar"].strip()[:120]
    if fields.get("day") is not None:
        overlay.day = fields["day"]
    if "status" in fields:
        overlay.status = clean_status(fields["status"])
    await _annotate(db, user_id, overlay, fields)
    await db.flush()
    return overlay
