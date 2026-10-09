"""Database writes for streams' work: pipeline items, week objectives, the quarter and notebooks.

Same contract as planner_day: flush, never commit; a ValueError carries the vault path's message.
"""
from datetime import date

from sqlalchemy import func, select

from app.models.planner import NotebookEntry, PipelineItem, Quarter, QuarterStream, WeekObjective
from app.services.rules import (
    BLOCKER_ID, FIELD_KEYS, LANES, MAX_DESCRIPTION_CHARS, MAX_OBJECTIVE_CHARS, MONTHS, PRODUCT, SLUG, clean_entry, clean_item,
    make_stream, new_id, one_line_field, quarter_months, validate_field, week_for, weekly_streams,
)

ITEM_GONE = "that item changed or moved; reload and try again"


async def item_row(db, user_id: int, stream: str, item_id: int) -> PipelineItem:
    row = (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.id == item_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(ITEM_GONE)
    return row


async def _next_position(db, user_id: int, stream: str) -> int:
    top = (await db.execute(select(func.max(PipelineItem.position)).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream))).scalar()
    return 0 if top is None else top + 1


def _split_product(text: str) -> tuple[str, str | None]:
    """('Wire it [product:: Router]') -> ('Wire it', 'Router'): the product is a field of the item, not part of its text."""
    found = PRODUCT.search(text)
    if not found:
        return text, None
    return PRODUCT.sub("", text).strip(), found.group(1) or None


def _description(text: str) -> str:
    text = text.strip("\n").rstrip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    return "\n".join(line.rstrip() for line in text.split("\n")) if text.strip() else ""


async def add_items(db, user_id: int, stream: str, texts: list[str], lane: str, today: date,
                    descriptions: list[str] | None = None) -> None:
    if lane not in LANES or lane == "done":
        raise ValueError(f"cannot add to lane '{lane}'")
    if descriptions is not None and len(descriptions) != len(texts):
        raise ValueError("descriptions must line up with texts")
    notes = descriptions or [""] * len(texts)
    cleaned = []
    for text, note in zip(texts, notes):
        if not text.strip():
            continue
        bare, product = _split_product(text)
        title, month = clean_item(bare)
        cleaned.append((title, product, month, _description(note)))
    if not cleaned:
        raise ValueError("nothing to add")
    position = await _next_position(db, user_id, stream)
    for title, product, month, note in cleaned:
        db.add(PipelineItem(user_id=user_id, stream=stream, lane=lane, text=title, description=note, product=product,
                            checkpoint=month, added_on=today, done=False, blocked_by=[], position=position))
        position += 1
    await db.flush()


async def move_item(db, user_id: int, stream: str, item_id: int, lane: str, today: date) -> None:
    """Move an item to the end of `lane`; Done ticks it and stamps the date, any other lane reopens it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    row = await item_row(db, user_id, stream, item_id)
    done = lane == "done"
    row.lane, row.done = lane, done
    row.done_on = (row.done_on or today) if done else None
    row.position = await _next_position(db, user_id, stream)


async def set_checkpoint(db, user_id: int, stream: str, item_id: int, checkpoint: str | None) -> None:
    row = await item_row(db, user_id, stream, item_id)
    row.checkpoint = clean_item(f"x #{checkpoint}")[1] if checkpoint else None


async def remove_item(db, user_id: int, stream: str, item_id: int) -> None:
    await db.delete(await item_row(db, user_id, stream, item_id))


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


async def set_text(db, user_id: int, stream: str, item_id: int, text: str) -> None:
    """Rename in place, keeping lane, dates and product; a #month typed in the text replaces the checkpoint."""
    row = await item_row(db, user_id, stream, item_id)
    bare, typed_product = _split_product(text)
    title, typed_month = clean_item(bare)
    row.text = title
    row.checkpoint = typed_month or row.checkpoint
    if typed_product:
        row.product = typed_product


async def focused_item(db, user_id: int, stream: str, week: str) -> PipelineItem | None:
    return (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.focus_week == week)
        .order_by(PipelineItem.position))).scalars().first()


async def set_focus(db, user_id: int, stream: str, item_id: int, week: str, today: date) -> None:
    """Make this item the week's small domino: the marker leaves any other item and the item goes to Now, reopened."""
    row = await item_row(db, user_id, stream, item_id)
    others = (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.focus_week == week))).scalars().all()
    for other in others:
        other.focus_week = None
    row.focus_week = week
    await move_item(db, user_id, stream, item_id, "now", today)


async def update_objective(db, user_id: int, today: date, stream: str, text: str | None, done: bool | None,
                           checkpoint: str | None, streams) -> None:
    """Set the text, done flag and/or checkpoint of one stream's objective for today's week ('' clears the checkpoint)."""
    if stream not in {s.id for s in weekly_streams(streams)}:
        raise ValueError(f"unknown stream '{stream}'")
    if text is None and done is None and checkpoint is None:
        raise ValueError("nothing to change")
    if checkpoint and checkpoint not in MONTHS:
        raise ValueError(f"unknown month '{checkpoint}'")
    week = week_for(today)[2]
    existing = (await db.execute(select(WeekObjective).where(
        WeekObjective.user_id == user_id, WeekObjective.week == week, WeekObjective.stream == stream))).scalar_one_or_none()
    row = existing or WeekObjective(user_id=user_id, week=week, stream=stream, text="", done=False, checkpoint=None)
    if text is not None:
        cleaned = " ".join(text.split())
        if len(cleaned) > MAX_OBJECTIVE_CHARS:
            raise ValueError(f"objective is longer than {MAX_OBJECTIVE_CHARS} characters")
        row.text = cleaned
    if done is not None:
        row.done = done
    if checkpoint is not None:
        row.checkpoint = checkpoint or None
    if not row.text:
        row.checkpoint = None  # a checkpoint is only kept with a line of text, as in the weekly note
    keep = bool(row.text or row.done)
    if keep and existing is None:
        db.add(row)
    elif not keep and existing is not None:
        await db.delete(row)
    await db.flush()


async def sync_focus(db, user_id: int, stream: str, week: str, today: date, *, text: str | None = None,
                     done: bool | None = None) -> None:
    """Keep the week's small-domino item in step with its objective line (same rules as the vault path)."""
    item = await focused_item(db, user_id, stream, week)
    if text is not None:
        if text.strip() == "":
            if item:
                item.focus_week = None
            return
        if item:
            await set_text(db, user_id, stream, item.id, text)
            return
        wanted = clean_item(_split_product(text)[0])[0].lower()
        same = (await db.execute(select(PipelineItem).where(
            PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.done.is_(False))
            .order_by(PipelineItem.position))).scalars().all()
        match = next((i for i in same if i.text.lower() == wanted), None)
        if match:  # the objective names an item already in the pipeline: link it instead of adding a twin
            await set_focus(db, user_id, stream, match.id, week, today)
            return
        await add_items(db, user_id, stream, [text], "now", today)
        created = (await db.execute(select(PipelineItem).where(
            PipelineItem.user_id == user_id, PipelineItem.stream == stream).order_by(PipelineItem.position.desc()))).scalars().first()
        await set_focus(db, user_id, stream, created.id, week, today)
        return
    if done is not None and item:
        await move_item(db, user_id, stream, item.id, "done" if done else "now", today)


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


def _set_checkpoint_text(row: QuarterStream, month: str, text: str) -> None:
    checkpoints = [dict(c) for c in row.checkpoints or []]
    for c in checkpoints:
        if c["month"] == month:
            c["text"] = text
            break
    else:
        checkpoints.append({"month": month, "text": text})
    row.checkpoints = checkpoints


async def update_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str]) -> None:
    """Change name/colour/icon/slot/weekly/goal/status and month checkpoints of one stream defined in the quarter."""
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
        else:
            setattr(row, key, clean)


async def add_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str]) -> None:
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
    checkpoints = [{"month": m, "text": one_line_field(data[m], m)} for m in months if m in data]
    last_note = max((r.position for r in rows if r.in_note), default=-1)
    for r in rows:
        if r.position > last_note:
            r.position += 1  # built-in extras stay after the streams the quarter defines
    taken = next((r for r in rows if r.slug == stream and not r.in_note), None)
    if taken is not None:
        await db.delete(taken)
        await db.flush()
    db.add(QuarterStream(user_id=user_id, quarter=label, slug=stream, name=info.name, color=info.color, icon=info.icon,
                         slot=info.slot, weekly=info.weekly, has_pipeline=info.goal, in_note=True, goal=written.get("goal", ""),
                         status=info.status, checkpoints=checkpoints, position=last_note + 1))


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
