"""What a capture device may read and change after it created a task: only tasks that device made (device_captures), only its owner's rows.

Reads and writes go through planner_items, so a pipeline item keeps the pipeline's rules (done moves it to the Done lane). Writes flush; the caller commits."""
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import QuarterStream, Task
from app.models.user import DeviceCapture
from app.services import device_tokens, planner_items, planner_products, planner_work
from app.services.rules import quarter_for, week_for


def capture_task(task: Task, client_id: str) -> dict:
    item = planner_items.written_task(task)
    return {
        "client_id": client_id, "id": task.id, "text": item["title"], "status": item["status"], "done": task.done,
        "link": task.link, "deadline_at": item["deadline_at"], "tracked_seconds": item["tracked_seconds"],
        "timer_started_at": item["timer_started_at"], "due_on": task.due_on, "scheduled_on": task.scheduled_on,
        "lane": task.lane, "stream": task.stream, "products": list(task.products or []),
    }


async def list_for_device(db: AsyncSession, user_id: int, token_id: int, include_done: bool, limit: int) -> list[dict]:
    """This device's tasks, newest capture first. The join on user_id is a second lock: a mapping never exposes another user's task."""
    query = (select(Task, DeviceCapture.client_id)
             .join(DeviceCapture, DeviceCapture.task_id == Task.id)
             .where(DeviceCapture.device_token_id == token_id, Task.user_id == user_id))
    if not include_done:
        query = query.where(Task.done.is_(False), Task.status == "open")
    rows = (await db.execute(query.order_by(DeviceCapture.id.desc()).limit(limit))).all()
    return [capture_task(task, client_id) for task, client_id in rows]


async def patch_for_device(db: AsyncSession, user_id: int, token_id: int, client_id: str, fields: dict, today: date) -> dict | None:
    """Change the fields sent on the task this device created for `client_id`; None when this device has no such task."""
    task = await device_tokens.captured_task(db, user_id, token_id, client_id)
    if task is None:
        return None
    changes = {k: v for k, v in fields.items() if k != "done"}
    if "done" in fields and not (fields["done"] and task.done):  # ticking a done task again changes nothing (done_on stays)
        changes["status"] = "done" if fields["done"] else "open"
    task = await planner_items.update_item(db, user_id, task.id, changes, today)
    return capture_task(task, client_id)


def capture_target(day: date | None, fields: dict, today: date) -> tuple[date, dict]:
    """A device capture is always a task on a day (`day`, else today) with an optional stream; it never becomes a pipeline item.

    The Plan page's pipelines (lanes now/next/someday) are not part of capture: a `lane` an older client still sends is ignored,
    not refused. The stream is the link that matters (the weekly log groups by it); products stay optional tags."""
    fields = {k: v for k, v in fields.items() if k != "lane"}
    return day or today, fields


async def capture_streams(db: AsyncSession, user_id: int, today: date) -> list[dict]:
    """Every stream the user can file a capture under: this quarter's non-archived streams, plus the latest earlier quarter's that
    this quarter has no row for yet (the Plan page copies those over when it loads, a capture picker must not wait for that).
    Unlike the pipelines, a stream without a quarter goal or pipeline is included. Each carries its products (optional second pick)."""
    label = quarter_for(today)

    async def rows(quarter: str) -> list[QuarterStream]:
        return list((await db.execute(select(QuarterStream).where(
            QuarterStream.user_id == user_id, QuarterStream.quarter == quarter).order_by(QuarterStream.position))).scalars().all())

    mine = await rows(label)
    earlier = (await db.execute(select(QuarterStream.quarter).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter < label).order_by(QuarterStream.quarter.desc()).limit(1))).scalar()
    have = {r.slug for r in mine}
    carried = [r for r in (await rows(earlier) if earlier else []) if r.in_note and r.slug not in have]
    products: dict[str, list[dict]] = {}
    for p in await planner_products.rows_of(db, user_id):
        products.setdefault(p.block, []).append({"slug": p.slug, "name": p.name})
    return [{"slug": r.slug, "name": r.name, "color": r.color, "products": products.get(r.slug, [])}
            for r in [*mine, *carried] if r.status != "archived"]


async def weekly_log(db: AsyncSession, user_id: int, today: date, week: str | None) -> dict:
    """The tasks of one week (Sunday to Saturday, as the Plan page counts weeks) under the stream each belongs to.

    A task sits on the day it was finished (`done_on`) or, while it is open, on the day it is for (`scheduled_on`, else the day it
    was added). Skipped tasks, week objectives and tasks without a stream are left out. Per stream: `done` finished this week,
    `total` listed this week (finished + still open)."""
    start, end, label = _week(today, week)
    rows = (await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream.is_not(None), Task.status != "skipped",
        Task.done_on.between(start, end) | (Task.done.is_(False) & (Task.scheduled_on.between(start, end) |
                                                                     (Task.scheduled_on.is_(None) & Task.added_on.between(start, end)))))
        .order_by(Task.id))).scalars().all()
    streams = {r.slug: r for r in (await _all_stream_rows(db, user_id))}
    days: dict[date, list[dict]] = {start + timedelta(days=n): [] for n in range(7)}
    totals: dict[str, dict] = {}
    for t in rows:
        if not t.text.strip() or planner_work.is_objective_only(t):
            continue
        on = t.done_on if t.done else (t.scheduled_on or t.added_on)
        if on not in days:
            continue
        info = streams.get(t.stream)
        days[on].append({"id": t.id, "text": t.text, "stream": t.stream, "done": t.done, "on": "done" if t.done else "captured",
                         "link": t.link, "tracked_seconds": t.tracked_seconds or 0})
        row = totals.setdefault(t.stream, {"stream": t.stream, "name": info.name if info else t.stream, "color": info.color if info else "slate",
                                           "done": 0, "total": 0})
        row["total"] += 1
        row["done"] += 1 if t.done else 0
    return {"week": label, "start": start, "end": end, "prev_week": week_for(start - timedelta(days=1))[2],
            "next_week": week_for(end + timedelta(days=1))[2], "streams": list(totals.values()),
            "days": [{"day": d, "entries": days[d]} for d in sorted(days)]}


def _week(today: date, week: str | None) -> tuple[date, date, str]:
    """Bounds of `week` ('2026-W48'; default: the week holding `today`)."""
    if week is None:
        return week_for(today)
    try:
        year, number = int(week[:4]), int(week[6:])
        if week[4:6] != "-W" or not 1 <= number <= 53:
            raise ValueError
        # week_for numbers a Sunday-Saturday week by the ISO week of its Tuesday
        tuesday = date.fromisocalendar(year, number, 2)
    except (ValueError, IndexError):
        raise ValueError("week must look like 2026-W48")
    return week_for(tuesday)


async def _all_stream_rows(db: AsyncSession, user_id: int) -> list[QuarterStream]:
    """One row per stream slug, the latest quarter's winning (names and colours for a week that may span a quarter edge)."""
    rows = list((await db.execute(select(QuarterStream).where(QuarterStream.user_id == user_id).order_by(QuarterStream.quarter))).scalars().all())
    return list({r.slug: r for r in rows}.values())
