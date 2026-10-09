"""A user's blocks: the parts of the day that votes and the schedule refer to."""
from sqlalchemy import select

from app.models.planner import PlannerBlock, PlannerScheduleBlock
from app.services.planner_defaults import COLOR_KEYS
import re

BLOCK_KEY = re.compile(r"^[a-z][a-z0-9-]{1,19}$")
MAX_LABEL = 40


def _out(row: PlannerBlock) -> dict:
    return {"key": row.key, "label": row.label, "ring_name": row.ring_name, "color": row.color,
            "counts_for_stars": row.counts_for_stars, "archived": row.archived}


async def _rows(db, user_id: int) -> list[PlannerBlock]:
    return list((await db.execute(select(PlannerBlock).where(PlannerBlock.user_id == user_id)
                                  .order_by(PlannerBlock.position))).scalars().all())


async def list_blocks(db, user_id: int) -> list[dict]:
    return [_out(r) for r in await _rows(db, user_id)]


async def counted_keys(db, user_id: int, include_archived: bool = False) -> list[str]:
    return [r.key for r in await _rows(db, user_id) if r.counts_for_stars and (include_archived or not r.archived)]


def _clean(item: dict) -> dict:
    key = item["key"]
    if not BLOCK_KEY.match(key):
        raise ValueError(f"'{key}' is not a valid key: use 2-20 lowercase letters, digits or dashes, starting with a letter")
    label = " ".join(item["label"].split())
    if not label or len(label) > MAX_LABEL:
        raise ValueError(f"the name of '{key}' must be 1-{MAX_LABEL} characters")
    ring = item["ring_name"].strip().upper()
    if not 1 <= len(ring) <= 6:
        raise ValueError(f"the ring name of '{key}' must be 1-6 characters")
    if item["color"] not in COLOR_KEYS:
        raise ValueError(f"unknown colour '{item['color']}'")
    return {"key": key, "label": label, "ring_name": ring, "color": item["color"],
            "counts_for_stars": bool(item["counts_for_stars"]), "archived": bool(item["archived"])}


async def replace_blocks(db, user_id: int, items: list[dict]) -> None:
    """Make `items` (in order) the user's blocks. A block that is left out is archived, never deleted."""
    clean = [_clean(i) for i in items]
    keys = [c["key"] for c in clean]
    if len(keys) != len(set(keys)):
        raise ValueError("a key appears twice")
    if not any(not c["archived"] for c in clean):
        raise ValueError("keep at least one block that is not archived")
    existing = {r.key: r for r in await _rows(db, user_id)}
    for position, c in enumerate(clean):
        row = existing.pop(c["key"], None)
        if row is None:
            row = PlannerBlock(user_id=user_id, position=position, **c)
            db.add(row)
        else:
            row.label, row.ring_name, row.color = c["label"], c["ring_name"], c["color"]
            row.counts_for_stars, row.archived, row.position = c["counts_for_stars"], c["archived"], position
    for offset, row in enumerate(existing.values(), start=len(clean)):
        row.archived, row.position = True, offset
    await db.flush()
    used = {r for (r,) in (await db.execute(select(PlannerScheduleBlock.block).where(PlannerScheduleBlock.user_id == user_id))).all()}
    labels = {r.key: r.label for r in await _rows(db, user_id) if r.archived}
    for key in sorted(used & set(labels)):
        raise ValueError(f"'{labels[key]}' is still on your schedule; remove those rows first")
