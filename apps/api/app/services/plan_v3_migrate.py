"""The Plan v3 data migration: products seeded from the tags in use, habits linked to goals from a mapping the owner writes.

`python -m app.cli plan-v3-migrate` drives this. `plan` reads and decides, touching nothing; `apply` writes through the ORM session
and returns a journal; `revert` undoes a journal. Steps:

  a. products: for each block, each distinct tag on that user's tasks (every planner_tasks row with a stream, lane or not) and event
     overlays becomes a product (slug = the tag made tag-safe, name = the tag with dashes as spaces, Title Case, position by first
     appearance), unless the block already has that slug;
  b. habit goals, from --habit-goals {"<habit id>": "<goal line id>"}: the habit must have a Plan block (`stream`) and the line must be
     a goal of that block this quarter; goal_ref is set only where it is NULL.

Nothing here deletes or edits a task, a tag, a goal line or an existing product.
"""
import json
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import select

from app.models.planner import EventOverlay, PlannerHabit, PlannerProduct, QuarterStream, Task
from app.services import plan_v2
from app.services.planner_products import MAX_PRODUCTS_PER_BLOCK
from app.services.rules import PRODUCT_SLUG, quarter_for, tag_slug


def _quote(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


def title_of(tag: str) -> str:
    """'home-lab' -> 'Home Lab'; capped at the name column (60)."""
    return " ".join(tag.replace("-", " ").replace("_", " ").split()).title()[:60]


@dataclass
class Plan:
    user_id: int
    today: date
    lines: list[str] = field(default_factory=list)
    products: list[dict] = field(default_factory=list)  # PlannerProduct kwargs
    habit_goals: list[tuple[PlannerHabit, str]] = field(default_factory=list)
    skipped: Counter = field(default_factory=Counter)

    @property
    def changes(self) -> int:
        return len(self.products) + len(self.habit_goals)

    def summary(self) -> str:
        return f"SUMMARY products={len(self.products)} habit_goals={len(self.habit_goals)}"


SHAPE = 'habit goals must look like {"<habit id>": "<goal line id>"}'


def read_habit_goals(path: str | None) -> dict[int, str]:
    if not path:
        return {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (OSError, ValueError) as exc:
        raise ValueError(f"cannot read habit goals {path}: {exc}")
    if not isinstance(raw, dict) or not all(isinstance(v, str) and v for v in raw.values()):
        raise ValueError(SHAPE)
    try:
        return {int(k): v for k, v in raw.items()}
    except ValueError:
        raise ValueError(SHAPE)


async def plan(db, user_id: int, today: date, habit_goals: dict[int, str] | None = None) -> Plan:
    """Decide every change for one user without writing. Raises ValueError for a bad habit-goal mapping, before anything is written."""
    out = Plan(user_id=user_id, today=today)
    habit_goals = habit_goals or {}

    # b. validated first, so a bad mapping refuses the whole run
    habits = {h.id: h for h in (await db.execute(select(PlannerHabit).where(PlannerHabit.user_id == user_id).with_for_update())).scalars()}
    current = quarter_for(today)
    rows = {r.slug: r for r in (await db.execute(select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == current))).scalars()}
    chosen: list[tuple[PlannerHabit, str]] = []
    for habit_id, line_id in habit_goals.items():
        habit = habits.get(habit_id)
        if habit is None:
            raise ValueError(f"habit {habit_id} does not exist for this user")
        if habit.stream is None:
            raise ValueError(f"habit {habit_id} has no Plan block, so it has no goal to link to")
        row = rows.get(habit.stream)
        if row is None or line_id not in {g["id"] for g in plan_v2.goal_lines(row)}:
            raise ValueError(f"habit {habit_id}: '{line_id}' is not a goal of {habit.stream} in {current}")
        chosen.append((habit, line_id))

    # a. products from the tags in use
    blocks = {slug for (slug,) in (await db.execute(select(QuarterStream.slug).where(
        QuarterStream.user_id == user_id, QuarterStream.in_note.is_(True)))).all()}
    have = {(p.block, p.slug): p for p in (await db.execute(select(PlannerProduct).where(PlannerProduct.user_id == user_id))).scalars()}
    count = Counter(b for b, _ in have)
    top: dict[str, int] = {}
    for p in have.values():
        top[p.block] = max(top.get(p.block, -1), p.position)
    first: dict[tuple[str, str], list] = {}  # (block, slug) -> [first tag spelling, number of uses]
    tagged = [(t.stream, t.products) for t in (await db.execute(select(Task).where(Task.user_id == user_id, Task.stream.is_not(None)).order_by(Task.id))).scalars()]
    tagged += [(o.stream, o.products) for o in (await db.execute(select(EventOverlay).where(EventOverlay.user_id == user_id, EventOverlay.stream.is_not(None)).order_by(EventOverlay.id))).scalars()]
    for stream, tags in tagged:
        for tag in tags or []:
            entry = first.setdefault((stream, tag_slug(tag)), [tag, 0])
            entry[1] += 1
    for (stream, slug), (tag, uses) in first.items():
        if (stream, slug) in have:
            continue
        if stream not in blocks:
            out.lines.append(f"block={stream} skipped tag {_quote(tag)}: no quarter defines the block")
            continue
        if not PRODUCT_SLUG.match(slug):
            out.lines.append(f"block={stream} skipped tag {_quote(tag)}: not usable as a product (it must start with a letter)")
            continue
        if count[stream] >= MAX_PRODUCTS_PER_BLOCK:
            out.lines.append(f"block={stream} skipped tag {_quote(tag)}: the block already has {MAX_PRODUCTS_PER_BLOCK} products")
            continue
        top[stream] = top.get(stream, -1) + 1
        count[stream] += 1
        name = title_of(tag)
        out.products.append({"user_id": user_id, "block": stream, "slug": slug, "name": name, "position": top[stream]})
        out.lines.append(f"id=new block={stream} product: slug={slug} name={_quote(name)} position={top[stream]} (tag {_quote(tag)} on {uses} rows)")
    for stream in sorted({p["block"] for p in out.products}):  # the block's products once the run has written
        after = [(p.position, p.slug) for (b, _), p in have.items() if b == stream] + [(p["position"], p["slug"]) for p in out.products if p["block"] == stream]
        out.lines.append(f"block={stream} products after: " + ", ".join(slug for _, slug in sorted(after)))

    # b. continued: only where goal_ref is NULL
    for habit, line_id in chosen:
        if habit.goal_ref is not None:
            out.lines.append(f"id={habit.id} habit goal_ref skipped: already {habit.goal_ref!r}; left alone")
            continue
        out.habit_goals.append((habit, line_id))
        out.lines.append(f"id={habit.id} habit {_quote(habit.name)} stream={habit.stream} goal_ref: None -> {line_id}")
    return out


def snapshot(row: PlannerProduct) -> dict:
    """Every mapped column of a product as plain JSON, to tell later whether anyone touched the row."""
    return json.loads(json.dumps({c.key: getattr(row, c.key) for c in PlannerProduct.__table__.columns},
                                 default=lambda v: v.isoformat() if isinstance(v, (date, datetime)) else str(v)))


async def apply(db, p: Plan) -> dict:
    """Write the plan through the session (flush only: the caller commits) and return the journal."""
    updates = []
    for habit, new in p.habit_goals:
        updates.append({"id": habit.id, "column": "goal_ref", "old": habit.goal_ref, "new": new})
        habit.goal_ref = new
    rows = [PlannerProduct(**spec) for spec in p.products]
    db.add_all(rows)
    await db.flush()
    for r in rows:
        await db.refresh(r)  # database defaults, so the snapshot is the whole row as stored
    return {"user": p.user_id, "today": p.today.isoformat(), "created": [{"id": r.id, "snapshot": snapshot(r)} for r in rows],
            "updates": updates, "summary": p.summary()}


async def revert(db, journal: dict, do_apply: bool) -> tuple[list[str], int]:
    """Undo a journal: restore the goal links and delete the products it created, each only if the row is still as the run left it.

    Returns (lines, number of changes made or, in a dry run, that would be made). Anything edited since is skipped and printed."""
    user_id = journal["user"]
    lines, changed = [], 0
    for u in reversed(journal["updates"]):
        h = (await db.execute(select(PlannerHabit).where(PlannerHabit.user_id == user_id, PlannerHabit.id == u["id"]))).scalar_one_or_none()
        now = getattr(h, u["column"]) if h is not None else None
        if h is None or now != u["new"]:
            why = "is gone" if h is None else f"is {now!r} now, not {u['new']!r}"
            lines.append(f"id={u['id']} habit {u['column']} skipped: it {why}; left alone")
            continue
        lines.append(f"id={u['id']} habit {u['column']}: {u['new']} -> {u['old']}")
        changed += 1
        if do_apply:
            setattr(h, u["column"], u["old"])
    for c in reversed(journal["created"]):
        p = (await db.execute(select(PlannerProduct).where(PlannerProduct.user_id == user_id, PlannerProduct.id == c["id"]))).scalar_one_or_none()
        if p is None:
            lines.append(f"id={c['id']} product delete skipped: already gone")
            continue
        now = snapshot(p)
        diff = sorted(k for k, v in c["snapshot"].items() if now.get(k) != v)
        if diff:
            lines.append(f"id={c['id']} product delete skipped: changed since ({', '.join(diff)}) in {_quote(p.name)}; left alone")
            continue
        lines.append(f"id={c['id']} product delete: {p.block}/{p.slug} {_quote(p.name)}")
        changed += 1
        if do_apply:
            await db.delete(p)
    if do_apply:
        await db.flush()
    return lines, changed
