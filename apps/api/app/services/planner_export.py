"""A versioned JSON snapshot of one user's planner data: the contract between Niyyah and anything that mirrors or backs it up.

Documented in docs/export-format.md. Calendar feed addresses are secrets, so only the host is exported.
"""
import hashlib
import json
from datetime import date
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerBlock, PlannerCalendarFeed, PlannerScheduleBlock, PlannerScheduleSetting,
    Quarter, QuarterStream, Task, WeekObjective,
)
from app.models.user import User
from app.models.vault import VaultDay

FORMAT_VERSION = 1


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


async def build_snapshot(db: AsyncSession, user: User) -> dict:
    uid = user.id

    async def rows(model, *order):
        return list((await db.execute(select(model).where(model.user_id == uid).order_by(*order))).scalars().all())

    quarters: dict[str, dict] = {}
    for q in await rows(Quarter, Quarter.label):
        quarters[q.label] = {"label": q.label, "starts": _iso(q.starts), "ends": _iso(q.ends), "objective": q.objective,
                             "objective_ar": q.objective_ar, "streams": []}
    for s in await rows(QuarterStream, QuarterStream.quarter, QuarterStream.position):
        quarters.setdefault(s.quarter, {"label": s.quarter, "starts": None, "ends": None, "objective": "", "objective_ar": "", "streams": []})
        quarters[s.quarter]["streams"].append({
            "slug": s.slug, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly,
            "has_pipeline": s.has_pipeline, "in_note": s.in_note, "goal": s.goal, "status": s.status,
            "checkpoints": list(s.checkpoints or [])})

    setting = (await db.execute(select(PlannerScheduleSetting).where(PlannerScheduleSetting.user_id == uid))).scalar_one_or_none()
    schedule = None
    if setting is not None:
        schedule = {"meta": dict(setting.meta), "days": {}}
        for r in await rows(PlannerScheduleBlock, PlannerScheduleBlock.position):
            schedule["days"].setdefault(r.day_type, []).append({"block": r.block, "start": r.start, "end": r.end, "what": r.what, "stream": r.stream})

    log: dict[date, list[str]] = {}
    for e in await rows(LogEntry, LogEntry.day, LogEntry.position):
        log.setdefault(e.day, []).append(e.text)
    day_rows = (await db.execute(select(VaultDay).options(selectinload(VaultDay.block_votes))
                                 .where(VaultDay.user_id == uid).order_by(VaultDay.date))).scalars().all()
    days = [{"date": d.date.isoformat(), "mode": d.mode, "possible": d.possible, "total": d.total, "focus": d.focus,
             "votes": {v.block: v.stars for v in sorted(d.block_votes, key=lambda v: v.block)}, "log": log.get(d.date, [])}
            for d in day_rows]

    return {
        "version": FORMAT_VERSION,
        "user": {"email": user.email, "timezone": user.timezone},
        "blocks": [{"key": b.key, "label": b.label, "ring_name": b.ring_name, "color": b.color,
                    "counts_for_stars": b.counts_for_stars, "archived": b.archived} for b in await rows(PlannerBlock, PlannerBlock.position)],
        "schedule": schedule,
        "feeds": [{"name": f.name, "host": urlparse(f.url).hostname or "", "color": f.color, "email": f.email}
                  for f in await rows(PlannerCalendarFeed, PlannerCalendarFeed.position)],
        "goals": [{"title": g.title, "value": g.value, "caption": g.caption, "progress": g.progress}
                  for g in await rows(Goal, Goal.position)],
        "quarters": list(quarters.values()),
        "week_objectives": [{"week": o.week, "stream": o.stream, "text": o.text, "done": o.done, "checkpoint": o.checkpoint}
                            for o in await rows(WeekObjective, WeekObjective.week, WeekObjective.stream)],
        "pipeline_items": [{"id": p.id, "stream": p.stream, "lane": p.lane, "text": p.text, "description": p.description,
                            "product": p.product, "checkpoint": p.checkpoint, "added_on": _iso(p.added_on), "done_on": _iso(p.done_on),
                            "focus_week": p.focus_week, "done": p.done, "blocked_by": list(p.blocked_by or [])}
                           for p in await rows(PipelineItem, PipelineItem.stream, PipelineItem.position)],
        "notebook_entries": [{"stream": n.stream, "id": n.ext_id, "kind": n.kind, "title": n.title, "body": n.body,
                              "date": n.entry_date, "open": n.is_open}
                             for n in await rows(NotebookEntry, NotebookEntry.stream, NotebookEntry.position)],
        "days": days,
        "tasks": [{"id": t.id, "text": t.text, "done": t.done, "due_on": _iso(t.due_on), "scheduled_on": _iso(t.scheduled_on),
                   "start_on": _iso(t.start_on), "done_on": _iso(t.done_on), "source_path": t.source_path}
                  for t in await rows(Task, Task.id)],
    }


def etag_for(snapshot: dict) -> str:
    body = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return '"' + hashlib.sha256(body.encode()).hexdigest()[:32] + '"'
