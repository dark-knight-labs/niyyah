"""A versioned JSON snapshot of one user's planner data: the contract between Niyyah and anything that mirrors or backs it up.

Documented in docs/export-format.md. Calendar feed addresses are secrets, so only the host is exported.
"""
import hashlib
import json
from datetime import date
from urllib.parse import urlparse

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.planner import (
    EventOverlay, Goal, LogEntry, NotebookEntry, PlannerBlock, PlannerCalendarFeed, PlannerHabit, PlannerHabitCheck, PlannerScheduleBlock, PlannerScheduleSetting,
    Quarter, QuarterStream, Task,
)
from app.models.compass import Compass
from app.services import board_transfer
from app.models.persona import Persona
from app.models.user import User
from app.services.rules import checklist_from_text, checklist_progress, item_status
from app.models.vault import VaultDay

FORMAT_VERSION = 1


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


async def build_snapshot(db: AsyncSession, user: User) -> dict:
    uid = user.id

    async def rows(model, *order, where=None):
        stmt = select(model).where(model.user_id == uid)
        if where is not None:
            stmt = stmt.where(where)
        return list((await db.execute(stmt.order_by(*order))).scalars().all())

    # The planning chain lives on planner_tasks rows. `pipeline_items` and `week_objectives` below are derived from them, for
    # readers of the older shape (the Obsidian mirror, a rolled-back image); `planning_rows` carries the full rows.
    lane_rows = await rows(Task, Task.lane_position, Task.id, where=Task.lane.is_not(None))
    objective_rows = await rows(Task, Task.focus_week, Task.stream, where=Task.objective_text.is_not(None))
    planning = await rows(Task, Task.id, where=or_(Task.lane.is_not(None), Task.focus_week.is_not(None), Task.objective_text.is_not(None)))
    plain = await rows(Task, Task.id, where=and_(Task.lane.is_(None), Task.focus_week.is_(None), Task.objective_text.is_(None)))

    quarters: dict[str, dict] = {}
    for q in await rows(Quarter, Quarter.label):
        quarters[q.label] = {"label": q.label, "starts": _iso(q.starts), "ends": _iso(q.ends), "objective": q.objective,
                             "objective_ar": q.objective_ar, "streams": []}
    for s in await rows(QuarterStream, QuarterStream.quarter, QuarterStream.position):
        quarters.setdefault(s.quarter, {"label": s.quarter, "starts": None, "ends": None, "objective": "", "objective_ar": "", "streams": []})
        quarters[s.quarter]["streams"].append({
            "slug": s.slug, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly,
            "has_pipeline": s.has_pipeline, "in_note": s.in_note, "goal": s.goal, "status": s.status,
            "goal_checklist": list(s.goal_checklist or checklist_from_text(s.goal)),
            "checkpoints": [{**c, "checklist": c.get("checklist") or checklist_from_text(c.get("text", ""))} for c in s.checkpoints or []]})

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

    habit_checks: dict[int, dict[str, str]] = {}
    for c in await rows(PlannerHabitCheck, PlannerHabitCheck.day):
        habit_checks.setdefault(c.habit_id, {})[c.day.isoformat()] = c.level
    habits = [{"name": h.name, "block": h.block, "anchor": h.anchor, "per_week": h.per_week, "minimum": h.minimum, "stage": h.stage,
               "stream": h.stream, "gate_pct": h.gate_pct, "gate_weeks": h.gate_weeks, "trip_pct": h.trip_pct, "trip_weeks": h.trip_weeks,
               "started_on": _iso(h.started_on), "checks": habit_checks.get(h.id, {})}
              for h in await rows(PlannerHabit, PlannerHabit.position, PlannerHabit.id)]

    compass = (await db.execute(select(Compass).where(Compass.user_id == uid))).scalar_one_or_none()
    personas = (await db.execute(select(Persona).where(Persona.user_id == uid, Persona.stream.is_not(None))
                                 .order_by(Persona.order, Persona.id))).scalars().all()

    return {
        "version": FORMAT_VERSION,
        "user": {"email": user.email, "timezone": user.timezone},
        "blocks": [{"key": b.key, "label": b.label, "ring_name": b.ring_name, "color": b.color,
                    "counts_for_stars": b.counts_for_stars, "archived": b.archived} for b in await rows(PlannerBlock, PlannerBlock.position)],
        "schedule": schedule,
        "feeds": [{"name": f.name, "host": urlparse(f.url).hostname or "", "color": f.color, "email": f.email}
                  for f in await rows(PlannerCalendarFeed, PlannerCalendarFeed.position)],
        "goals": [{"title": g.title, "value": g.value, "caption": g.caption, "checklist": list(g.checklist or []),
                   "progress": checklist_progress(g.checklist) if g.checklist else g.progress}
                  for g in await rows(Goal, Goal.position)],
        "quarters": list(quarters.values()),
        "week_objectives": [{"week": o.focus_week, "stream": o.stream, "text": o.objective_text, "done": bool(o.objective_done),
                             "checkpoint": o.focus_checkpoint} for o in objective_rows],
        "pipeline_items": [{"id": p.id, "stream": p.stream, "lane": p.lane, "text": p.text, "description": p.description,
                            "products": list(p.products or []), "product": (p.products or [None])[0], "checkpoint": p.checkpoint, "added_on": _iso(p.added_on), "done_on": _iso(p.done_on),
                            "focus_week": p.focus_week, "done": p.done, "blocked_by": list(p.blocked_by or [])}
                           for p in sorted(lane_rows, key=lambda p: (p.stream, p.lane_position or 0, p.id))],
        "notebook_entries": [{"stream": n.stream, "id": n.ext_id, "kind": n.kind, "title": n.title, "body": n.body,
                              "date": n.entry_date, "open": n.is_open}
                             for n in await rows(NotebookEntry, NotebookEntry.stream, NotebookEntry.position)],
        "days": days,
        "tasks": [{"id": t.id, "text": t.text, "done": t.done, "due_on": _iso(t.due_on), "scheduled_on": _iso(t.scheduled_on),
                   "start_on": _iso(t.start_on), "done_on": _iso(t.done_on), "source_path": t.source_path, "stream": t.stream, "products": list(t.products or []), "description": t.description or "",
                   "status": item_status(t.done, t.status), "start_min": t.start_min, "end_min": t.end_min, "weight": t.weight,
                   "checklist": list(t.checklist or []), "parent_ref": t.parent_id}
                  for t in plain],
        "planning_rows": [{"id": t.id, "parent_ref": t.parent_id, "origin": t.origin, "stream": t.stream, "lane": t.lane, "lane_position": t.lane_position,
                           "text": t.text, "description": t.description or "", "products": list(t.products or []), "checkpoint": t.checkpoint,
                           "added_on": _iso(t.added_on), "done": t.done, "done_on": _iso(t.done_on), "status": item_status(t.done, t.status),
                           "focus_week": t.focus_week, "objective_text": t.objective_text, "objective_done": t.objective_done,
                           "focus_checkpoint": t.focus_checkpoint, "blocked_by": list(t.blocked_by or []), "due_on": _iso(t.due_on),
                           "scheduled_on": _iso(t.scheduled_on), "start_on": _iso(t.start_on), "source_path": t.source_path,
                           "start_min": t.start_min, "end_min": t.end_min, "weight": t.weight, "checklist": list(t.checklist or []),
                           "goal_ref": t.goal_ref, "label_month": t.label_month, "label_date": _iso(t.label_date)}
                          for t in planning],
        "habits": habits,
        "item_overlays": [{"key": o.event_key, "calendar": o.source_calendar, "title": o.title, "day": _iso(o.day), "status": o.status,
                           "weight": o.weight, "stream": o.stream, "products": list(o.products or []), "description": o.description or "",
                           "checklist": list(o.checklist or [])}
                          for o in await rows(EventOverlay, EventOverlay.event_key)],
        "compass": None if compass is None else {"mission": compass.mission, "vision": compass.vision, "vision_horizon": compass.vision_horizon},
        "persona_streams": [{"name": p.name, "stream": p.stream} for p in personas],
        "boards": await board_transfer.export_boards(db, uid),
    }


def etag_for(snapshot: dict) -> str:
    body = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return '"' + hashlib.sha256(body.encode()).hexdigest()[:32] + '"'
