"""Database writes for streams' work: pipeline items, week objectives, the quarter and notebooks.

Same contract as planner_day: flush, never commit; a ValueError carries the vault path's message.
"""
from datetime import date

from sqlalchemy import func, select

from app.models.planner import PipelineItem
from app.services.vault_pipeline import LANES, MAX_DESCRIPTION_CHARS, _BLOCKER_ID, _PRODUCT, _clean as clean_item

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
    found = _PRODUCT.search(text)
    if not found:
        return text, None
    return _PRODUCT.sub("", text).strip(), found.group(1) or None


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
        if not _BLOCKER_ID.match(blocker):
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
