"""Database writes for streams' work: pipeline items, week objectives, the quarter and notebooks.

Same contract as planner_day: flush, never commit; a ValueError carries the vault path's message.

Pipeline items and week objectives are planner_tasks rows (see planner_mapping): an item is a row with a `lane`; a week's
objective sits on the row that is that week's small domino (`focus_week`, `objective_*`), or alone on a row with no lane when
no item carries it. Every function here keeps the outcome the two old tables gave.
"""
import re
from datetime import date

from sqlalchemy import func, select, update

from app.models.planner import NotebookEntry, Quarter, QuarterStream, Task
from app.services import planner_store
from app.services.rules import (
    BLOCKER_ID, FIELD_KEYS, LANES, checklist_from_text, checklist_text, clean_checklist, MAX_DESCRIPTION_CHARS, MAX_OBJECTIVE_CHARS, HASHTAG, MONTHS, PRODUCT, SLUG, clean_entry, clean_products, clean_item, split_tags,
    make_stream, new_id, one_line_field, quarter_months, validate_field, week_for, weekly_streams,
)

ITEM_GONE = "that item changed or moved; reload and try again"


def is_planning(task: Task) -> bool:
    """A pipeline item (has a lane). The generic task and item writes hand these to the functions below."""
    return task.lane is not None


def is_objective_only(task: Task) -> bool:
    """A week objective no pipeline item carries: it is not an item anyone can see or edit as one."""
    return task.lane is None and task.focus_week is not None


async def item_row(db, user_id: int, stream: str, item_id: int) -> Task:
    row = (await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream == stream, Task.id == item_id, Task.lane.is_not(None)))).scalar_one_or_none()
    if row is None:
        raise ValueError(ITEM_GONE)
    return row


async def _next_position(db, user_id: int, stream: str) -> int:
    top = (await db.execute(select(func.max(Task.lane_position)).where(
        Task.user_id == user_id, Task.stream == stream, Task.lane.is_not(None)))).scalar()
    return 0 if top is None else top + 1


def _description(text: str) -> str:
    text = text.strip("\n").rstrip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    return "\n".join(line.rstrip() for line in text.split("\n")) if text.strip() else ""


def _done_state(row: Task, done: bool) -> None:
    row.done = done
    row.status = "done" if done else "open"


def _objective_row(user_id: int, stream: str, week: str, text: str, done: bool, checkpoint: str | None) -> Task:
    """A row that holds only a week's objective (no lane): it shows in the objectives view and nowhere else."""
    return Task(user_id=user_id, stream=stream, text=text, done=done, status="done" if done else "open", focus_week=week,
                objective_text=text, objective_done=done, focus_checkpoint=checkpoint, products=[], description="", blocked_by=[])


def _carry(row: Task) -> tuple[str, bool, str | None] | None:
    return None if row.objective_text is None else (row.objective_text, bool(row.objective_done), row.focus_checkpoint)


def _drop_objective(row: Task) -> None:
    row.objective_text = row.objective_done = row.focus_checkpoint = None


def _write_objective(row: Task, text: str, done: bool, checkpoint: str | None) -> None:
    row.objective_text, row.objective_done, row.focus_checkpoint = text, done, checkpoint
    if row.lane is None:  # an objective-only row has no other meaning: its own text and tick mirror the objective
        row.text = text
        _done_state(row, done)


async def add_rows(db, user_id: int, stream: str, texts: list[str], lane: str, today: date,
                   descriptions: list[str] | None = None) -> list[Task]:
    if lane not in LANES or lane == "done":
        raise ValueError(f"cannot add to lane '{lane}'")
    if descriptions is not None and len(descriptions) != len(texts):
        raise ValueError("descriptions must line up with texts")
    notes = descriptions or [""] * len(texts)
    cleaned = []
    for text, note in zip(texts, notes):
        if not text.strip():
            continue
        bare, products = split_tags(text)
        title, month = clean_item(bare)
        cleaned.append((title, products, month, _description(note)))
    if not cleaned:
        raise ValueError("nothing to add")
    position = await _next_position(db, user_id, stream)
    created = []
    for title, products, month, note in cleaned:
        created.append(Task(user_id=user_id, stream=stream, lane=lane, lane_position=position, text=title, description=note, products=products,
                            checkpoint=month, added_on=today, done=False, status="open", blocked_by=[]))
        position += 1
    db.add_all(created)
    await db.flush()
    return created


async def add_items(db, user_id: int, stream: str, texts: list[str], lane: str, today: date,
                    descriptions: list[str] | None = None) -> None:
    await add_rows(db, user_id, stream, texts, lane, today, descriptions)


async def _move_row(db, row: Task, lane: str, today: date) -> None:
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    done = lane == "done"
    row.lane = lane
    _done_state(row, done)
    row.done_on = (row.done_on or today) if done else None
    row.lane_position = await _next_position(db, row.user_id, row.stream)


async def move_item(db, user_id: int, stream: str, item_id: int, lane: str, today: date) -> None:
    """Move an item to the end of `lane`; Done ticks it and stamps the date, any other lane reopens it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    await _move_row(db, await item_row(db, user_id, stream, item_id), lane, today)


async def move_and_tick(db, user_id: int, row: Task, lane: str, today: date, streams) -> None:
    """Move an item; finishing (or reopening) this week's small domino ticks (or unticks) the objective with it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    if row.focus_week == week_for(today)[2] and (lane == "done") != row.done:
        await update_objective(db, user_id, today, row.stream, None, lane == "done", None, streams)
    await _move_row(db, row, lane, today)


async def set_row_done(db, user_id: int, row: Task, done: bool, today: date) -> None:
    """The generic tick of a pipeline item (a day's task list, an item's status): Done, or back to Now, like the pipeline move."""
    if done == row.done:
        return
    streams = await planner_store.streams_for(db, user_id, today)
    await move_and_tick(db, user_id, row, "done" if done else "now", today, streams)


async def set_checkpoint(db, user_id: int, stream: str, item_id: int, checkpoint: str | None) -> None:
    row = await item_row(db, user_id, stream, item_id)
    row.checkpoint = clean_item(f"x #{checkpoint}")[1] if checkpoint else None


async def _delete_row(db, row: Task) -> None:
    """Delete a row; an objective it carries stays (alone on a row of its own), as the objective table kept it."""
    carry, week, stream, user_id = _carry(row), row.focus_week, row.stream, row.user_id
    await db.execute(update(Task).where(Task.parent_id == row.id).values(parent_id=None))
    await db.delete(row)
    await db.flush()
    if carry is not None and week is not None:
        db.add(_objective_row(user_id, stream, week, *carry))
        await db.flush()


async def remove_item(db, user_id: int, stream: str, item_id: int) -> None:
    await _delete_row(db, await item_row(db, user_id, stream, item_id))


async def remove_row(db, user_id: int, row: Task, today: date) -> None:
    """The generic delete of a pipeline item: as the pipeline remove, a small domino of this week empties the objective's text first."""
    if row.focus_week == week_for(today)[2] and row.objective_text is not None:
        _write_objective(row, "", bool(row.objective_done), None)
        if not row.objective_done:
            _drop_objective(row)
    await _delete_row(db, row)


async def set_description(db, user_id: int, stream: str, item_id: int, text: str) -> None:
    row = await item_row(db, user_id, stream, item_id)
    row.description = _description(text)


async def set_blocked_by(db, user_id: int, stream: str, item_id: int, ids: list[str]) -> None:
    row = await item_row(db, user_id, stream, item_id)
    clean: list[str] = []
    for blocker in ids:
        if not BLOCKER_ID.match(blocker):
            raise ValueError(f"'{blocker}' is not a blocker id")
        if blocker not in clean:
            clean.append(blocker)
    row.blocked_by = clean


def set_text_row(row: Task, text: str) -> None:
    """Rename in place, keeping lane, dates and products; a #month typed in the text replaces the checkpoint."""
    bare, typed_products = split_tags(text)
    title, typed_month = clean_item(bare)
    row.text = title
    row.checkpoint = typed_month or row.checkpoint
    if typed_products:
        row.products = typed_products


async def set_text(db, user_id: int, stream: str, item_id: int, text: str) -> None:
    set_text_row(await item_row(db, user_id, stream, item_id), text)


async def pipeline_streams(db, user_id: int, today: date) -> set[str]:
    """The streams a pipeline item may belong to: this quarter's, with a pipeline, not archived."""
    streams = await planner_store.streams_for(db, user_id, today)
    return {s.id for s in streams if s.goal and not s.archived}


async def set_row_stream(db, user_id: int, row: Task, stream: str | None, today: date) -> None:
    """Move a pipeline item to another stream's pipeline (the pipeline rule: this quarter, has a pipeline)."""
    if stream is None:
        raise ValueError("a pipeline item needs a stream")
    if stream not in await pipeline_streams(db, user_id, today):
        raise ValueError(f"unknown stream '{stream}'")
    if stream == row.stream:
        return
    if row.focus_week is not None and await _week_row(db, user_id, stream, row.focus_week) is not None:
        raise ValueError(f"{stream} already has a small domino for {row.focus_week}")
    row.stream = stream
    row.lane_position = await _next_position(db, user_id, stream)


async def focused_item(db, user_id: int, stream: str, week: str) -> Task | None:
    return (await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream == stream, Task.focus_week == week, Task.lane.is_not(None))
        .order_by(Task.lane_position, Task.id))).scalars().first()


async def _week_row(db, user_id: int, stream: str, week: str) -> Task | None:
    """The row holding the week's marker: the small domino item, or the row that carries only the objective."""
    return (await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream == stream, Task.focus_week == week).order_by(Task.id))).scalars().first()


async def _clear_focus(db, row: Task) -> None:
    """Take the week marker off an item. A ticked (or non-empty) objective it carried stays, alone on a row of its own."""
    week, carry = row.focus_week, _carry(row)
    row.focus_week = None
    _drop_objective(row)
    await db.flush()
    if carry is not None and week is not None and (carry[0] or carry[1]):
        db.add(_objective_row(row.user_id, row.stream, week, *carry))
        await db.flush()


async def set_focus(db, user_id: int, stream: str, item_id: int, week: str, today: date) -> None:
    """Make this item the week's small domino: the marker leaves any other item and the item goes to Now, reopened.

    The week's objective moves onto the item. A row that carried only that objective folds into the item and is deleted; an
    objective the item carried for another week stays behind, alone on a row of its own."""
    row = await item_row(db, user_id, stream, item_id)
    if row.focus_week is not None and row.focus_week != week:
        old_week, old = row.focus_week, _carry(row)
        row.focus_week = None
        _drop_objective(row)
        await db.flush()
        if old is not None:
            db.add(_objective_row(user_id, stream, old_week, *old))
            await db.flush()
    carry = None
    others = (await db.execute(select(Task).where(
        Task.user_id == user_id, Task.stream == stream, Task.focus_week == week, Task.id != row.id))).scalars().all()
    for other in others:
        carry = carry or _carry(other)
        if other.lane is None:
            await db.delete(other)
        else:
            other.focus_week = None
            _drop_objective(other)
    if others:
        await db.flush()
    row.focus_week = week
    if carry is not None:
        row.objective_text, row.objective_done, row.focus_checkpoint = carry
    await _move_row(db, row, "now", today)


async def set_week_objective(db, user_id: int, week: str, stream: str, text: str | None, done: bool | None,
                             checkpoint: str | None, streams) -> None:
    """Set the text, done flag and/or checkpoint of one stream's objective for `week` ('' clears the checkpoint).

    `streams` are the streams of that week's quarter. Only the objective is written; `week_objective_set` adds what the
    screen does around it for the current week (the small-domino item follows)."""
    if stream not in {s.id for s in weekly_streams(streams)}:
        raise ValueError(f"unknown stream '{stream}'")
    if text is None and done is None and checkpoint is None:
        raise ValueError("nothing to change")
    if checkpoint and checkpoint not in MONTHS:
        raise ValueError(f"unknown month '{checkpoint}'")
    holder = await _week_row(db, user_id, stream, week)
    existing = holder is not None and holder.objective_text is not None
    now_text = holder.objective_text if existing else ""
    now_done = bool(holder.objective_done) if existing else False
    now_checkpoint = holder.focus_checkpoint if existing else None
    if text is not None:
        cleaned = " ".join(text.split())
        if len(cleaned) > MAX_OBJECTIVE_CHARS:
            raise ValueError(f"objective is longer than {MAX_OBJECTIVE_CHARS} characters")
        now_text = cleaned
    if done is not None:
        now_done = done
    if checkpoint is not None:
        now_checkpoint = checkpoint or None
    if not now_text:
        now_checkpoint = None  # a checkpoint is only kept with a line of text, as in the weekly note
    if now_text or now_done:
        if holder is None:
            holder = _objective_row(user_id, stream, week, now_text, now_done, now_checkpoint)
            db.add(holder)
        _write_objective(holder, now_text, now_done, now_checkpoint)
    elif existing:
        if holder.lane is None:
            await db.delete(holder)
        else:
            _drop_objective(holder)
    await db.flush()


async def update_objective(db, user_id: int, today: date, stream: str, text: str | None, done: bool | None,
                           checkpoint: str | None, streams) -> None:
    """Set the text, done flag and/or checkpoint of one stream's objective for today's week ('' clears the checkpoint)."""
    await set_week_objective(db, user_id, week_for(today)[2], stream, text, done, checkpoint, streams)


WEEK = re.compile(r"^(\d{4})-W(\d{2})$")
WEEKS_BACK, WEEKS_AHEAD = 4, 13  # a week objective can be set from last month to next quarter


def week_anchor(week: str) -> date:
    """A day inside the week ('YYYY-Www', numbered as `week_for` does: by the ISO week of its Tuesday): the Tuesday."""
    found = WEEK.match(week or "")
    if not found:
        raise ValueError("week must look like 2026-W45")
    try:
        return date.fromisocalendar(int(found.group(1)), int(found.group(2)), 2)
    except ValueError:
        raise ValueError(f"'{week}' is not a week") from None


async def week_objective_set(db, user_id: int, today: date, stream: str, text: str | None, done: bool | None,
                             checkpoint: str | None, week: str | None = None) -> list:
    """What `PUT /objectives` does, for this week or another (current week -4 .. +13). Returns the week's streams.

    For this week the stream's small-domino item follows the objective (`sync_focus`). Another week is text only: its
    item is linked the first time the objective is edited in its own week."""
    current = week_for(today)[2]
    week = week or current
    if week == current:
        anchor = today
    else:
        anchor = week_anchor(week)
        weeks = (anchor - week_for(today)[0]).days // 7
        if not -WEEKS_BACK <= weeks <= WEEKS_AHEAD:
            raise ValueError(f"week must be within {WEEKS_BACK} weeks back and {WEEKS_AHEAD} ahead of this week")
    streams = await planner_store.streams_for(db, user_id, anchor)
    block = next((s for s in streams if s.id == stream), None)
    await set_week_objective(db, user_id, week, stream, text, done, checkpoint, streams)
    if week == current and block and block.goal and not block.archived and (text is not None or done is not None):
        await sync_focus(db, user_id, stream, week, today, text=text, done=done)
    return streams


async def pipeline_move(db, user_id: int, stream: str, item_id: int, lane: str, today: date) -> None:
    """What `PUT /pipeline/move` does: finishing (or reopening) this week's small domino ticks (or unticks) its objective."""
    streams = await planner_store.streams_for(db, user_id, today)
    await move_and_tick(db, user_id, await item_row(db, user_id, stream, item_id), lane, today, streams)


async def pipeline_focus(db, user_id: int, stream: str, item_id: int, today: date) -> None:
    """What `PUT /pipeline/focus` does: the item becomes this week's small domino and the objective line follows."""
    week = week_for(today)[2]
    streams = await planner_store.streams_for(db, user_id, today)
    item = await item_row(db, user_id, stream, item_id)
    await update_objective(db, user_id, today, stream, item.text, False, item.checkpoint or "", streams)
    await set_focus(db, user_id, stream, item_id, week, today)


async def pipeline_remove(db, user_id: int, stream: str, item_id: int, today: date) -> None:
    """What `POST /pipeline/remove` does: removing this week's small domino empties the objective first."""
    streams = await planner_store.streams_for(db, user_id, today)
    item = await item_row(db, user_id, stream, item_id)
    if item.focus_week == week_for(today)[2]:
        await update_objective(db, user_id, today, stream, "", None, "", streams)
    await remove_item(db, user_id, stream, item_id)


async def sync_focus(db, user_id: int, stream: str, week: str, today: date, *, text: str | None = None,
                     done: bool | None = None) -> None:
    """Keep the week's small-domino item in step with its objective line (same rules as the vault path)."""
    item = await focused_item(db, user_id, stream, week)
    if text is not None:
        if text.strip() == "":
            if item:
                await _clear_focus(db, item)
            return
        if item:
            set_text_row(item, text)
            return
        wanted = clean_item(split_tags(text)[0])[0].lower()
        same = (await db.execute(select(Task).where(
            Task.user_id == user_id, Task.stream == stream, Task.lane.is_not(None), Task.done.is_(False))
            .order_by(Task.lane_position, Task.id))).scalars().all()
        match = next((i for i in same if i.text.lower() == wanted), None)
        if match:  # the objective names an item already in the pipeline: link it instead of adding a twin
            await set_focus(db, user_id, stream, match.id, week, today)
            return
        created = (await add_rows(db, user_id, stream, [text], "now", today))[0]
        await set_focus(db, user_id, stream, created.id, week, today)
        return
    if done is not None and item:
        await _move_row(db, item, "done" if done else "now", today)


async def ensure_quarter(db, user_id: int, label: str) -> Quarter:
    """This quarter's row; a new quarter starts with the vault skeleton's placeholder objective and no streams."""
    row = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == label))).scalar_one_or_none()
    if row is None:
        row = Quarter(user_id=user_id, label=label, starts=None, ends=None, objective="Set this quarter's Super Objective", objective_ar="")
        db.add(row)
        await db.flush()
    return row


async def _stream_rows(db, user_id: int, label: str) -> list[QuarterStream]:
    return list((await db.execute(select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label).order_by(QuarterStream.position))).scalars().all())


async def set_super_objective(db, user_id: int, label: str, text: str, arabic: str | None) -> None:
    text = one_line_field(text, "objective")
    if not text:
        raise ValueError("objective is empty")
    quarter = await ensure_quarter(db, user_id, label)
    quarter.objective = text
    if arabic is not None:
        quarter.objective_ar = one_line_field(arabic, "Arabic text")


def _month_entry(checkpoints: list[dict], month: str) -> dict:
    for c in checkpoints:
        if c["month"] == month:
            return c
    entry = {"month": month, "text": "", "checklist": []}
    checkpoints.append(entry)
    return entry


def _set_month_checklist(row: QuarterStream, month: str, items: list[dict]) -> None:
    checkpoints = [dict(c) for c in row.checkpoints or []]
    entry = _month_entry(checkpoints, month)
    entry["checklist"], entry["text"] = items, checklist_text(items)
    row.checkpoints = checkpoints


def _set_checkpoint_text(row: QuarterStream, month: str, text: str) -> None:
    """The older plain-text way to set a month: it becomes one line (unchanged text keeps its ticks)."""
    checkpoints = [dict(c) for c in row.checkpoints or []]
    entry = _month_entry(checkpoints, month)
    if entry.get("text") != text or "checklist" not in entry:
        entry["checklist"] = checklist_from_text(text)
    entry["text"] = text
    row.checkpoints = checkpoints


def _set_goal_checklist(row: QuarterStream, items: list[dict]) -> None:
    row.goal_checklist, row.goal = items, checklist_text(items)


def _apply_lists(row: QuarterStream, months: list[str], goal_checklist, month_checklists) -> None:
    if goal_checklist is not None:
        _set_goal_checklist(row, clean_checklist(goal_checklist))
    for month, items in (month_checklists or {}).items():
        if month not in months:
            raise ValueError(f"'{month}' is not a month of this quarter")
        _set_month_checklist(row, month, clean_checklist(items))


async def update_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str],
                        goal_checklist: list[dict] | None = None, month_checklists: dict[str, list[dict]] | None = None) -> None:
    """Change name/colour/icon/slot/weekly/goal/status and month checkpoints of one stream defined in the quarter.

    `goal_checklist` and `month_checklists` ({month: lines}) replace the goal's and the months' lines; `fields["goal"]` and a month
    key in `fields` are the older plain-text way and turn into a single line."""
    await ensure_quarter(db, user_id, label)
    row = next((r for r in await _stream_rows(db, user_id, label) if r.slug == stream and r.in_note), None)
    if row is None:
        raise ValueError(f"unknown stream '{stream}'")
    months = quarter_months(label)
    for key, value in fields.items():
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
        if key in months:
            _set_checkpoint_text(row, key, one_line_field(value, key))
            continue
        clean = validate_field(key, value)
        if key == "weekly":
            row.weekly = clean.lower() != "no"
        elif key == "goal":
            if clean != row.goal or not row.goal_checklist:
                row.goal_checklist = checklist_from_text(clean)
            row.goal = clean
        else:
            setattr(row, key, clean)
    _apply_lists(row, months, goal_checklist, month_checklists)


async def add_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str],
                     goal_checklist: list[dict] | None = None, month_checklists: dict[str, list[dict]] | None = None) -> None:
    if not SLUG.match(stream):
        raise ValueError("id must be 2-24 lowercase letters, digits or dashes, starting with a letter")
    await ensure_quarter(db, user_id, label)
    rows = await _stream_rows(db, user_id, label)
    if any(r.slug == stream and r.in_note for r in rows):
        raise ValueError(f"stream '{stream}' already exists")
    months = quarter_months(label)
    data = {"status": "committed", **fields}
    for key in data:
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
    written = {k: validate_field(k, data[k]) for k in FIELD_KEYS if k in data and data[k].strip()}
    if not written.get("name"):
        raise ValueError("name is required")
    info = make_stream(stream, written)
    checkpoints = [{"month": m, "text": one_line_field(data[m], m), "checklist": checklist_from_text(one_line_field(data[m], m))}
                   for m in months if m in data]
    last_note = max((r.position for r in rows if r.in_note), default=-1)
    for r in rows:
        if r.position > last_note:
            r.position += 1  # built-in extras stay after the streams the quarter defines
    taken = next((r for r in rows if r.slug == stream and not r.in_note), None)
    if taken is not None:
        await db.delete(taken)
        await db.flush()
    row = QuarterStream(user_id=user_id, quarter=label, slug=stream, name=info.name, color=info.color, icon=info.icon,
                        slot=info.slot, weekly=info.weekly, has_pipeline=info.goal, in_note=True, goal=written.get("goal", ""),
                        goal_checklist=checklist_from_text(written.get("goal", "")), status=info.status, checkpoints=checkpoints,
                        position=last_note + 1)
    _apply_lists(row, months, goal_checklist, month_checklists)
    db.add(row)


async def toggle_stream_item(db, user_id: int, label: str, stream: str, scope: str, item_id: str, done: bool) -> None:
    """Tick or untick one line of a stream's quarter goal (scope "goal") or of one month (scope = the month)."""
    row = next((r for r in await _stream_rows(db, user_id, label) if r.slug == stream and r.in_note), None)
    if row is None:
        raise ValueError(f"unknown stream '{stream}'")
    if scope == "goal":
        items = [dict(i) for i in row.goal_checklist or checklist_from_text(row.goal)]
    elif scope in quarter_months(label):
        entry = next((c for c in row.checkpoints or [] if c["month"] == scope), {})
        items = [dict(i) for i in entry.get("checklist") or checklist_from_text(entry.get("text", ""))]
    else:
        raise ValueError(f"'{scope}' is not the goal or a month of this quarter")
    line = next((i for i in items if i["id"] == item_id), None)
    if line is None:
        raise ValueError("that line changed or was removed; reload and try again")
    line["done"] = done
    if scope == "goal":
        _set_goal_checklist(row, items)
    else:
        _set_month_checklist(row, scope, items)


ENTRY_GONE = "that entry changed or moved; reload and try again"


async def _entry(db, user_id: int, stream: str, entry_id: int) -> NotebookEntry:
    row = (await db.execute(select(NotebookEntry).where(
        NotebookEntry.user_id == user_id, NotebookEntry.stream == stream, NotebookEntry.id == entry_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(ENTRY_GONE)
    return row


async def add_entry(db, user_id: int, stream: str, kind: str, title: str, body: str, today: date) -> None:
    """A new entry goes first; a blocker starts open."""
    title, body = clean_entry(kind, title, body)
    first = (await db.execute(select(func.min(NotebookEntry.position)).where(
        NotebookEntry.user_id == user_id, NotebookEntry.stream == stream))).scalar()
    db.add(NotebookEntry(user_id=user_id, stream=stream, ext_id=new_id(), kind=kind, title=title, body=body,
                         entry_date=today.isoformat(), is_open=True if kind == "blocker" else None,
                         position=0 if first is None else first - 1))
    await db.flush()


async def set_entry(db, user_id: int, stream: str, entry_id: int, title: str, body: str) -> None:
    row = await _entry(db, user_id, stream, entry_id)
    row.title, row.body = clean_entry(row.kind, title, body)


async def set_blocker(db, user_id: int, stream: str, entry_id: int, open_: bool) -> None:
    row = await _entry(db, user_id, stream, entry_id)
    if row.kind != "blocker":
        raise ValueError("only a blocker can be opened or cleared")
    row.is_open = open_


async def remove_entry(db, user_id: int, stream: str, entry_id: int) -> None:
    await db.delete(await _entry(db, user_id, stream, entry_id))
