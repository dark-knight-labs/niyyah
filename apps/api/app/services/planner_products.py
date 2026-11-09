"""Products of a block (Plan v3): named parts of a block that tasks and goal lines are tagged with.

A product is a row of planner_products with a `slug`. A task carries it as a tag in `planner_tasks.products` (a tag matches a
product when `rules.tag_slug(tag) == slug`, so '#DNS' and 'dns' are the same); a goal line carries it as `product`. Renaming a
product rewrites the tag on every task of the block (and event overlay) and on every goal line of the block in every quarter;
deleting one removes the tag but keeps the tasks and goals. Same contract as planner_work: flush, never commit; a ValueError is a
422, a `Conflict` a 409.
"""
from sqlalchemy import func, select

from app.models.planner import EventOverlay, PlannerProduct, QuarterStream, Task
from app.services.rules import MAX_ITEM_TAGS, MAX_PRODUCT_NAME, clean_products, product_slug_of, tag_slug

MAX_PRODUCTS_PER_BLOCK = 30
GONE = "that product changed or was removed; reload and try again"


class Conflict(ValueError):
    """A product with that slug already exists in the block (HTTP 409)."""


def _name(raw: str) -> str:
    name = " ".join(str(raw).split())
    if not name or len(name) > MAX_PRODUCT_NAME:
        raise ValueError(f"a product name is 1-{MAX_PRODUCT_NAME} characters")
    return name


async def block_exists(db, user_id: int, block: str) -> bool:
    return (await db.execute(select(QuarterStream.id).where(
        QuarterStream.user_id == user_id, QuarterStream.slug == block, QuarterStream.in_note.is_(True)).limit(1))).first() is not None


async def rows_of(db, user_id: int, block: str | None = None) -> list[PlannerProduct]:
    stmt = select(PlannerProduct).where(PlannerProduct.user_id == user_id)
    if block is not None:
        stmt = stmt.where(PlannerProduct.block == block)
    return list((await db.execute(stmt.order_by(PlannerProduct.block, PlannerProduct.position, PlannerProduct.id))).scalars().all())


async def slugs_of(db, user_id: int, block: str) -> set[str]:
    return {p.slug for p in await rows_of(db, user_id, block)}


async def _find(db, user_id: int, product_id: int) -> PlannerProduct:
    row = (await db.execute(select(PlannerProduct).where(PlannerProduct.id == product_id, PlannerProduct.user_id == user_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(GONE)
    return row


def _has(tags, slug: str) -> bool:
    return any(tag_slug(t) == slug for t in tags or [])


def _swap(tags, old: str, new: str | None) -> list[str]:
    """`tags` with the tag(s) for `old` replaced by `new` (or removed when None); no duplicates."""
    out: list[str] = []
    for t in tags or []:
        if tag_slug(t) == old:
            if new is None or any(tag_slug(x) == new for x in out):
                continue
            out.append(new)
        else:
            out.append(t)
    return clean_products(out, MAX_ITEM_TAGS)


async def _tagged(db, user_id: int, block: str) -> tuple[list[Task], list[EventOverlay], list[QuarterStream]]:
    tasks = list((await db.execute(select(Task).where(Task.user_id == user_id, Task.stream == block))).scalars().all())
    overlays = list((await db.execute(select(EventOverlay).where(EventOverlay.user_id == user_id, EventOverlay.stream == block))).scalars().all())
    quarters = list((await db.execute(select(QuarterStream).where(QuarterStream.user_id == user_id, QuarterStream.slug == block))).scalars().all())
    return tasks, overlays, quarters


async def usage(db, user_id: int, block: str) -> dict[str, dict[str, int]]:
    """{slug: {tasks, goals}}: how many tasks and goal lines of the block carry each product."""
    tasks, overlays, quarters = await _tagged(db, user_id, block)
    out: dict[str, dict[str, int]] = {}
    for t in tasks:
        for slug in {tag_slug(x) for x in t.products or []}:
            out.setdefault(slug, {"tasks": 0, "goals": 0})["tasks"] += 1
    for q in quarters:
        for line in q.goal_checklist or []:
            if line.get("product"):
                out.setdefault(line["product"], {"tasks": 0, "goals": 0})["goals"] += 1
    return out


async def create(db, user_id: int, block: str, name: str) -> PlannerProduct:
    if not await block_exists(db, user_id, block):
        raise ValueError(f"unknown block '{block}'")
    name = _name(name)
    slug = product_slug_of(name)
    existing = await rows_of(db, user_id, block)
    if any(p.slug == slug for p in existing):
        raise Conflict(f"'{slug}' is already a product of this block")
    if len(existing) >= MAX_PRODUCTS_PER_BLOCK:
        raise ValueError(f"at most {MAX_PRODUCTS_PER_BLOCK} products in a block")
    row = PlannerProduct(user_id=user_id, block=block, slug=slug, name=name, position=max((p.position for p in existing), default=-1) + 1)
    db.add(row)
    await db.flush()
    return row


async def rename(db, user_id: int, product_id: int, name: str) -> PlannerProduct:
    """New name and slug. The old slug becomes the new one on every task, overlay and goal line of the block, in one transaction."""
    row = await _find(db, user_id, product_id)
    name = _name(name)
    slug = product_slug_of(name)
    if slug != row.slug:
        if any(p.slug == slug for p in await rows_of(db, user_id, row.block)):
            raise Conflict(f"'{slug}' is already a product of this block")
        old = row.slug
        tasks, overlays, quarters = await _tagged(db, user_id, row.block)
        for t in tasks:
            if _has(t.products, old):
                t.products = _swap(t.products, old, slug)
        for o in overlays:
            if _has(o.products, old):
                o.products = _swap(o.products, old, slug)
        for q in quarters:
            if any(l.get("product") == old for l in q.goal_checklist or []):
                q.goal_checklist = [{**l, "product": slug} if l.get("product") == old else l for l in q.goal_checklist]
        row.slug = slug
    row.name = name
    await db.flush()
    return row


async def delete(db, user_id: int, product_id: int) -> dict[str, int]:
    """Remove the product and its tag from the block's tasks, overlays and goal lines; the tasks and goals stay. Returns the counts."""
    row = await _find(db, user_id, product_id)
    tasks, overlays, quarters = await _tagged(db, user_id, row.block)
    counts = {"tasks": 0, "goals": 0}
    for t in tasks:
        if _has(t.products, row.slug):
            t.products = _swap(t.products, row.slug, None)
            counts["tasks"] += 1
    for o in overlays:
        if _has(o.products, row.slug):
            o.products = _swap(o.products, row.slug, None)
    for q in quarters:
        if any(l.get("product") == row.slug for l in q.goal_checklist or []):
            counts["goals"] += sum(1 for l in q.goal_checklist if l.get("product") == row.slug)
            q.goal_checklist = [{k: v for k, v in l.items() if k != "product"} if l.get("product") == row.slug else l for l in q.goal_checklist]
    await db.delete(row)
    await db.flush()
    return counts


async def reorder(db, user_id: int, block: str, ids: list[int]) -> None:
    """Put the block's products in the order of `ids` (every product of the block, once)."""
    rows = await rows_of(db, user_id, block)
    if sorted(ids) != sorted(p.id for p in rows):
        raise ValueError("send every product of the block exactly once")
    by_id = {p.id: p for p in rows}
    for n, pid in enumerate(ids):
        by_id[pid].position = n
    await db.flush()


async def set_task_products(db, user_id: int, block: str, task: Task, slugs: list[str]) -> None:
    """Set which of the block's products a task has: those tags are replaced by `slugs`; its other tags stay."""
    known = await slugs_of(db, user_id, block)
    bad = [s for s in slugs if s not in known]
    if bad:
        raise ValueError(f"'{bad[0]}' is not a product of this block")
    plain = [t for t in task.products or [] if tag_slug(t) not in known]
    task.products = clean_products([*plain, *slugs], MAX_ITEM_TAGS)


def out(row: PlannerProduct, counts: dict | None = None) -> dict:
    c = (counts or {}).get(row.slug, {})
    return {"id": row.id, "block": row.block, "slug": row.slug, "name": row.name, "position": row.position,
            "tasks": c.get("tasks", 0), "goals": c.get("goals", 0)}


async def grouped(db, user_id: int) -> dict[str, list[dict]]:
    """{block: [product]} for the pipelines read (no usage counts)."""
    result: dict[str, list[dict]] = {}
    for p in await rows_of(db, user_id):
        result.setdefault(p.block, []).append(out(p))
    return result


async def listing(db, user_id: int, block: str | None = None) -> list[dict]:
    """Products with how many tasks and goal lines carry each."""
    rows = await rows_of(db, user_id, block)
    counts = {b: await usage(db, user_id, b) for b in {p.block for p in rows}}
    return [out(p, counts[p.block]) for p in rows]
