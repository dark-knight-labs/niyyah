"""Load an export snapshot into one user's account: the inverse of planner_export.

The user's planner data is replaced as a whole, in the caller's transaction (the caller commits). Other users' rows are never touched.
"""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    EventOverlay, Goal, LogEntry, NotebookEntry, PipelineItem, PlannerBlock, PlannerCalendarFeed, PlannerHabit, PlannerHabitCheck, PlannerScheduleBlock, PlannerScheduleSetting,
    Quarter, QuarterStream, Task, WeekObjective,
)
from app.models.vault import VaultBlockVote, VaultDay
from app.schemas.snapshot import Snapshot
from app.services.planner_mapping import map_planning
from app.services.rules import (
    MAX_ITEM_TAGS, checklist_from_text, checklist_text, clean_checklist, clean_minutes, clean_products, clean_subtasks, item_status,
)

USER_TABLES = (PlannerHabitCheck, PlannerHabit, PlannerBlock, PlannerCalendarFeed, Task, LogEntry, Goal, Quarter, QuarterStream, WeekObjective, PipelineItem,
               NotebookEntry, PlannerScheduleSetting, PlannerScheduleBlock, EventOverlay)


async def _wipe(db: AsyncSession, user_id: int) -> None:
    day_ids = select(VaultDay.id).where(VaultDay.user_id == user_id)
    await db.execute(delete(VaultBlockVote).where(VaultBlockVote.vault_day_id.in_(day_ids)))
    await db.execute(delete(VaultDay).where(VaultDay.user_id == user_id))
    for model in USER_TABLES:
        await db.execute(delete(model).where(model.user_id == user_id))


def _check(snap: Snapshot) -> None:
    dates = [d.date for d in snap.days]
    if len(dates) != len(set(dates)):
        raise ValueError("a date appears twice in days")
    if len({q.label for q in snap.quarters}) != len(snap.quarters):
        raise ValueError("a quarter appears twice")
    for q in snap.quarters:
        if len({s.slug for s in q.streams}) != len(q.streams):
            raise ValueError(f"a stream appears twice in {q.label}")
    ids = [(e.stream, e.id) for e in snap.notebook_entries]
    if len(ids) != len(set(ids)):
        raise ValueError("a notebook entry id appears twice in one stream")
    seen = [(o.week, o.stream) for o in snap.week_objectives]
    if len(seen) != len(set(seen)):
        raise ValueError("a weekly objective appears twice")
    if snap.planning_rows is not None:
        marked = [(r.stream, r.focus_week) for r in snap.planning_rows if r.focus_week]
        if len(marked) != len(set(marked)):
            raise ValueError("a stream has two small dominoes for one week in planning_rows")
        for r in snap.planning_rows:
            clean_minutes(r.start_min, r.end_min)
            if r.start_min is not None and r.scheduled_on is None:
                raise ValueError("a planning row with a time needs a scheduled_on date")
            if r.lane is None and not (r.focus_week and r.objective_text is not None):
                raise ValueError("a planning row without a lane must be a week objective (focus_week and objective_text)")
    if len({b.key for b in snap.blocks}) != len(snap.blocks):
        raise ValueError("a block key appears twice")
    if len({o.key for o in snap.item_overlays}) != len(snap.item_overlays):
        raise ValueError("an event key appears twice in item_overlays")
    for t in snap.tasks:
        clean_minutes(t.start_min, t.end_min)
        if t.start_min is not None and t.scheduled_on is None:
            raise ValueError("a task with a time needs a scheduled_on date")


def _lines(checklist, text: str) -> list[dict]:
    """The snapshot's lines, or one line made from older plain text when it carries none."""
    return clean_checklist([i.model_dump() for i in checklist]) if checklist else checklist_from_text(text)


def _stream_row(user_id: int, label: str, s, position: int) -> QuarterStream:
    goal_lines = _lines(s.goal_checklist, s.goal)
    checkpoints = []
    for c in s.checkpoints:
        lines = _lines(c.checklist, c.text)
        checkpoints.append({"month": c.month, "text": checklist_text(lines), "checklist": lines})
    return QuarterStream(user_id=user_id, quarter=label, slug=s.slug, name=s.name, color=s.color, icon=s.icon, slot=s.slot,
                         weekly=s.weekly, has_pipeline=s.has_pipeline, in_note=s.in_note, goal=checklist_text(goal_lines),
                         goal_checklist=goal_lines, status=s.status, checkpoints=checkpoints, position=position)


def _blocks(snap: Snapshot, user_id: int) -> list[PlannerBlock]:
    """The snapshot's blocks, plus a plain block for any key its votes, schedule or habits use that it does not list."""
    listed = {b.key for b in snap.blocks}
    voted = {k for d in snap.days for k in d.votes}
    scheduled = {r.block for rows in (snap.schedule.days.values() if snap.schedule else []) for r in rows}
    rows = [PlannerBlock(user_id=user_id, key=b.key, label=b.label, ring_name=b.ring_name, color=b.color,
                         counts_for_stars=b.counts_for_stars, position=n, archived=b.archived) for n, b in enumerate(snap.blocks)]
    habited = {h.block for h in snap.habits}
    for key in sorted((voted | scheduled | habited) - listed):
        rows.append(PlannerBlock(user_id=user_id, key=key, label=key.replace("-", " ").title(), ring_name=key[:6].upper(), color="slate",
                                 counts_for_stars=key in voted, position=len(rows), archived=False))
    return rows


def _planning_rows(snap: Snapshot, user_id: int) -> list[Task]:
    """The chain rows: `planning_rows` when the export has them, else the older pipeline_items + week_objectives mapped
    by the same function the migration uses."""
    if snap.planning_rows is not None:
        return [Task(
            user_id=user_id, stream=r.stream, lane=r.lane, lane_position=r.lane_position, text=r.text, description=r.description,
            products=clean_products(r.products, MAX_ITEM_TAGS), checkpoint=r.checkpoint, added_on=r.added_on, done=r.done, done_on=r.done_on,
            status=item_status(r.done, r.status), focus_week=r.focus_week, objective_text=r.objective_text, objective_done=r.objective_done,
            focus_checkpoint=r.focus_checkpoint, blocked_by=r.blocked_by, due_on=r.due_on, scheduled_on=r.scheduled_on, start_on=r.start_on,
            source_path=r.source_path, start_min=r.start_min, end_min=r.end_min, weight=r.weight,
            checklist=clean_subtasks([i.model_dump() for i in r.checklist]), origin=r.origin, position=0) for r in snap.planning_rows]
    pipeline = [{"id": i.id, "user_id": user_id, "stream": i.stream, "lane": i.lane, "text": i.text, "description": i.description,
                 "products": clean_products(i.products or ([i.product] if i.product else [])), "checkpoint": i.checkpoint,
                 "added_on": i.added_on, "done_on": i.done_on, "focus_week": i.focus_week, "done": i.done, "blocked_by": i.blocked_by,
                 "position": n} for n, i in enumerate(snap.pipeline_items)]
    objectives = [{"id": None, "user_id": user_id, "week": o.week, "stream": o.stream, "text": o.text, "done": o.done,
                   "checkpoint": o.checkpoint} for o in snap.week_objectives]
    rows, _dropped = map_planning(pipeline, objectives)
    return [Task(**row) for row in rows]


async def _link_pieces(db: AsyncSession, rows: list[tuple[Task, int | None, int | None]]) -> None:
    """Set parent_id from the export's ids (which only mean something inside the export); a missing parent leaves the row unlinked."""
    by_ref = {ref: task for task, ref, _ in rows if ref is not None}
    linked = False
    for task, _ref, parent_ref in rows:
        parent = by_ref.get(parent_ref) if parent_ref is not None else None
        if parent is not None and parent is not task and parent.parent_id is None:
            task.parent_id = parent.id
            linked = True
    if linked:
        await db.flush()


async def import_snapshot(db: AsyncSession, user_id: int, snap: Snapshot) -> dict[str, int]:
    _check(snap)
    await _wipe(db, user_id)

    days = []
    logs = []
    for d in snap.days:
        row = VaultDay(user_id=user_id, date=d.date, mode=d.mode, possible=d.possible, total=d.total, focus=d.focus,
                       log="\n".join(f"- {t}" for t in d.log) or None)
        row.block_votes = [VaultBlockVote(block=b, stars=s) for b, s in d.votes.items()]
        days.append(row)
        logs += [LogEntry(user_id=user_id, day=d.date, position=n, text=t) for n, t in enumerate(d.log)]

    quarters, streams = [], []
    for q in snap.quarters:
        quarters.append(Quarter(user_id=user_id, label=q.label, starts=q.starts, ends=q.ends, objective=q.objective, objective_ar=q.objective_ar))
        streams += [_stream_row(user_id, q.label, s, n) for n, s in enumerate(q.streams)]

    notebook = [NotebookEntry(user_id=user_id, stream=e.stream, ext_id=e.id, kind=e.kind, title=e.title, body=e.body, entry_date=e.date,
                              is_open=e.open, position=n) for n, e in enumerate(snap.notebook_entries)]
    tasks = [Task(user_id=user_id, text=t.text, done=t.done, due_on=t.due_on, scheduled_on=t.scheduled_on, start_on=t.start_on,
                  done_on=t.done_on, source_path=t.source_path, stream=t.stream, products=clean_products(t.products, MAX_ITEM_TAGS),
                  description=t.description, position=n, status=item_status(t.done, t.status), start_min=t.start_min, end_min=t.end_min,
                  weight=t.weight, checklist=clean_subtasks([i.model_dump() for i in t.checklist])) for n, t in enumerate(snap.tasks)]
    planning = _planning_rows(snap, user_id)
    overlays = [EventOverlay(user_id=user_id, event_key=o.key, source_calendar=o.calendar, title=o.title, day=o.day, status=o.status,
                             weight=o.weight, stream=o.stream, products=clean_products(o.products, MAX_ITEM_TAGS), description=o.description,
                             checklist=clean_subtasks([i.model_dump() for i in o.checklist])) for o in snap.item_overlays]
    goals = [Goal(user_id=user_id, position=n, title=g.title, value=g.value, caption=g.caption, progress=g.progress,
                  checklist=clean_checklist([i.model_dump() for i in g.checklist])) for n, g in enumerate(snap.goals)]
    feeds = [PlannerCalendarFeed(user_id=user_id, name=f.name, url=f.url, color=f.color, email=f.email, position=n) for n, f in enumerate(f for f in snap.feeds if f.url)]
    schedule_rows = []
    if snap.schedule:
        schedule_rows = [PlannerScheduleBlock(user_id=user_id, day_type=day, block=r.block, start=r.start, end=r.end, what=r.what,
                                              stream=r.stream, position=n) for day, rows in snap.schedule.days.items() for n, r in enumerate(rows)]
    blocks = _blocks(snap, user_id)

    groups = {"blocks": blocks, "schedule_blocks": schedule_rows, "feeds": feeds, "goals": goals, "quarters": quarters,
              "quarter_streams": streams, "notebook_entries": notebook,
              "days": days, "log_entries": logs, "tasks": tasks, "item_overlays": overlays}
    for rows in groups.values():
        db.add_all(rows)
    db.add_all(planning)  # after the plain tasks, so their ids stay the first ones
    groups["week_objectives"] = [r for r in planning if r.objective_text is not None]
    groups["pipeline_items"] = [r for r in planning if r.lane is not None]
    if snap.schedule:
        db.add(PlannerScheduleSetting(user_id=user_id, meta=snap.schedule.meta))
    await db.flush()
    await _link_pieces(db, [(t, o.id, o.parent_ref) for t, o in zip(tasks, snap.tasks)]
                       + [(t, o.id, o.parent_ref) for t, o in zip(planning, snap.planning_rows or [])])

    habits = [PlannerHabit(user_id=user_id, name=h.name, block=h.block, anchor=h.anchor, per_week=h.per_week, minimum=h.minimum, stage=h.stage,
                           stream=h.stream, gate_pct=h.gate_pct, gate_weeks=h.gate_weeks, trip_pct=h.trip_pct, trip_weeks=h.trip_weeks,
                           started_on=h.started_on, position=n) for n, h in enumerate(snap.habits)]
    db.add_all(habits)
    await db.flush()  # the habits get their ids, which the checks need
    checks = [PlannerHabitCheck(user_id=user_id, habit_id=row.id, day=day, level=level)
              for row, h in zip(habits, snap.habits) for day, level in h.checks.items()]
    db.add_all(checks)
    await db.flush()
    groups["habits"], groups["habit_checks"] = habits, checks
    return {name: len(rows) for name, rows in groups.items()}
