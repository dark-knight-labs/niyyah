"""Load an export snapshot into one user's account: the inverse of planner_export.

The user's planner data is replaced as a whole, in the caller's transaction (the caller commits). Other users' rows are never touched.
"""
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerBlock, PlannerCalendarFeed, PlannerScheduleBlock, PlannerScheduleSetting,
    Quarter, QuarterStream, Task, WeekObjective,
)
from app.models.vault import VaultBlockVote, VaultDay
from app.schemas.snapshot import Snapshot

USER_TABLES = (PlannerBlock, PlannerCalendarFeed, Task, LogEntry, Goal, Quarter, QuarterStream, WeekObjective, PipelineItem,
               NotebookEntry, PlannerScheduleSetting, PlannerScheduleBlock)


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
    if len({b.key for b in snap.blocks}) != len(snap.blocks):
        raise ValueError("a block key appears twice")


def _blocks(snap: Snapshot, user_id: int) -> list[PlannerBlock]:
    """The snapshot's blocks, plus a plain block for any key its votes or schedule use that it does not list."""
    listed = {b.key for b in snap.blocks}
    voted = {k for d in snap.days for k in d.votes}
    scheduled = {r.block for rows in (snap.schedule.days.values() if snap.schedule else []) for r in rows}
    rows = [PlannerBlock(user_id=user_id, key=b.key, label=b.label, ring_name=b.ring_name, color=b.color,
                         counts_for_stars=b.counts_for_stars, position=n, archived=b.archived) for n, b in enumerate(snap.blocks)]
    for key in sorted((voted | scheduled) - listed):
        rows.append(PlannerBlock(user_id=user_id, key=key, label=key.replace("-", " ").title(), ring_name=key[:6].upper(), color="slate",
                                 counts_for_stars=key in voted, position=len(rows), archived=False))
    return rows


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
        streams += [QuarterStream(
            user_id=user_id, quarter=q.label, slug=s.slug, name=s.name, color=s.color, icon=s.icon, slot=s.slot, weekly=s.weekly,
            has_pipeline=s.has_pipeline, in_note=s.in_note, goal=s.goal, status=s.status,
            checkpoints=[c.model_dump() for c in s.checkpoints], position=n) for n, s in enumerate(q.streams)]

    pipeline = [PipelineItem(
        user_id=user_id, stream=i.stream, lane=i.lane, text=i.text, description=i.description, product=i.product, checkpoint=i.checkpoint,
        added_on=i.added_on, done_on=i.done_on, focus_week=i.focus_week, done=i.done, blocked_by=i.blocked_by, position=n)
        for n, i in enumerate(snap.pipeline_items)]
    notebook = [NotebookEntry(user_id=user_id, stream=e.stream, ext_id=e.id, kind=e.kind, title=e.title, body=e.body, entry_date=e.date,
                              is_open=e.open, position=n) for n, e in enumerate(snap.notebook_entries)]
    objectives = [WeekObjective(user_id=user_id, week=o.week, stream=o.stream, text=o.text, done=o.done, checkpoint=o.checkpoint)
                  for o in snap.week_objectives]
    tasks = [Task(user_id=user_id, text=t.text, done=t.done, due_on=t.due_on, scheduled_on=t.scheduled_on, start_on=t.start_on,
                  done_on=t.done_on, source_path=t.source_path, position=n) for n, t in enumerate(snap.tasks)]
    goals = [Goal(user_id=user_id, position=n, title=g.title, value=g.value, caption=g.caption, progress=g.progress) for n, g in enumerate(snap.goals)]
    feeds = [PlannerCalendarFeed(user_id=user_id, name=f.name, url=f.url, color=f.color, email=f.email, position=n) for n, f in enumerate(f for f in snap.feeds if f.url)]
    schedule_rows = []
    if snap.schedule:
        schedule_rows = [PlannerScheduleBlock(user_id=user_id, day_type=day, block=r.block, start=r.start, end=r.end, what=r.what,
                                              stream=r.stream, position=n) for day, rows in snap.schedule.days.items() for n, r in enumerate(rows)]
    blocks = _blocks(snap, user_id)

    groups = {"blocks": blocks, "schedule_blocks": schedule_rows, "feeds": feeds, "goals": goals, "quarters": quarters,
              "quarter_streams": streams, "week_objectives": objectives, "pipeline_items": pipeline, "notebook_entries": notebook,
              "days": days, "log_entries": logs, "tasks": tasks}
    for rows in groups.values():
        db.add_all(rows)
    if snap.schedule:
        db.add(PlannerScheduleSetting(user_id=user_id, meta=snap.schedule.meta))
    await db.flush()
    return {name: len(rows) for name, rows in groups.items()}
