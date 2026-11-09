"""The Plan v2 data migration: month checkpoints become task labels, checkpoint lines become tasks, single goals nest tasks.

`python -m app.cli plan-v2-migrate` drives this. `plan` reads and decides, touching nothing; `apply` writes through the ORM
session (so the shadow-tree hook runs) and returns a journal; `revert` undoes a journal. Nothing here deletes or edits a
checkpoint, a checklist, a goal line, a week objective or a focus_week. Steps, in this order:

  a. label_month from checkpoint for each lane item that has none (year: the year of the stored quarter the month falls in);
  b. each month-checkpoint checklist line becomes a task (Done if ticked, else Next), unless a lane item that existed before
     this run says the same thing (text match or an override), when that item just gets the month label;
  c. goal_ref, for each block whose current-quarter goals are exactly one line, on every lane item of the block without one.
"""
import json
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select

from app.models.planner import Quarter, QuarterStream, Task
from app.services import planner_work
from app.services.plan_v2 import month_label
from app.services.rules import MONTHS, checklist_from_text, quarter_for, quarter_months

ORIGIN = "cpl"  # cpl:<quarter label>:<mon>:<line id>
NON_ALNUM = re.compile(r"[^a-z0-9]+")
MIN_CONTAINED = 6  # a text contained in another must be longer than this to count as the same item


def norm(text: str) -> str:
    return NON_ALNUM.sub(" ", text.lower()).strip()


def same_text(line: str, item: str) -> int:
    """2 = equal after normalising, 1 = one contains the other (the shorter longer than 6 characters), 0 = different."""
    a, b = norm(line), norm(item)
    if not a or not b:
        return 0
    if a == b:
        return 2
    short, long = sorted((a, b), key=len)
    return 1 if len(short) > MIN_CONTAINED and short in long else 0


@dataclass
class Plan:
    user_id: int
    today: date
    lines: list[str] = field(default_factory=list)
    label_updates: list[tuple[Task, str]] = field(default_factory=list)  # (existing item, new label_month)
    creates: list[dict] = field(default_factory=list)  # Task kwargs
    goal_updates: list[tuple[Task, str]] = field(default_factory=list)
    counts: Counter = field(default_factory=Counter)
    drift: int = 0
    overrides: dict = field(default_factory=dict)

    @property
    def changes(self) -> int:
        return len(self.label_updates) + len(self.creates) + len(self.goal_updates)

    def summary(self) -> str:
        c = self.counts
        return (f"SUMMARY label_month={len(self.label_updates)} created={len(self.creates)} created_next={c['created_next']} "
                f"created_done={c['created_done']} matched={c['matched']} ambiguous={c['ambiguous']} "
                f"goal_ref={len(self.goal_updates) + sum(1 for s in self.creates if s.get('goal_ref'))} overridden={c['overridden']}")


def add_summaries(plans: list[Plan]) -> str:
    """One SUMMARY line over several users (the same format)."""
    keys = ("label_month", "created", "created_next", "created_done", "matched", "ambiguous", "goal_ref", "overridden")
    total = Counter()
    for p in plans:
        for part in p.summary().split()[1:]:
            k, _, v = part.partition("=")
            total[k] += int(v)
    return "SUMMARY " + " ".join(f"{k}={total[k]}" for k in keys)


def read_overrides(path: str | None) -> dict:
    if not path:
        return {"match": {}, "skip": []}
    try:
        raw = json.loads(open(path, encoding="utf-8").read())
    except (OSError, ValueError) as exc:
        raise ValueError(f"cannot read overrides {path}: {exc}")
    match, skip = raw.get("match", {}), raw.get("skip", [])
    if not isinstance(match, dict) or not isinstance(skip, list) or set(raw) - {"match", "skip"}:
        raise ValueError('overrides must look like {"match": {"<line id>": <item id>}, "skip": ["<line id>"]}')
    if not all(isinstance(k, str) and isinstance(v, int) and not isinstance(v, bool) for k, v in match.items()) \
            or not all(isinstance(k, str) for k in skip):
        raise ValueError("overrides: match maps line ids (text) to item ids (numbers), skip lists line ids (text)")
    both = set(match) & set(skip)
    if both:
        raise ValueError(f"overrides: {sorted(both)} are in both match and skip")
    return {"match": dict(match), "skip": list(skip)}


def _quote(text: str) -> str:
    return json.dumps(text, ensure_ascii=False)


async def plan(db, user_id: int, today: date, overrides: dict | None = None) -> Plan:
    """Decide every change for one user without writing. Raises ValueError for a bad override, before anything is written."""
    overrides = overrides or {"match": {}, "skip": []}
    out = Plan(user_id=user_id, today=today, overrides=overrides)
    tasks = list((await db.execute(select(Task).where(Task.user_id == user_id, Task.lane.is_not(None))
                                   .order_by(Task.lane_position, Task.id))).scalars().all())
    by_id = {t.id: t for t in tasks}
    qrows = list((await db.execute(select(QuarterStream).where(QuarterStream.user_id == user_id)
                                   .order_by(QuarterStream.quarter, QuarterStream.position))).scalars().all())
    labels = set((await db.execute(select(Quarter.label).where(Quarter.user_id == user_id))).scalars().all())
    labels |= {r.quarter for r in qrows}
    origins = set((await db.execute(select(Task.origin).where(Task.user_id == user_id, Task.origin.like(f"{ORIGIN}:%")))).scalars().all())

    def checkpoint_lines(row: QuarterStream):
        for entry in row.checkpoints or []:
            for line in entry.get("checklist") or checklist_from_text(entry.get("text", "")):
                yield entry["month"], line

    # overrides: validated against the data, before any write
    streams_of_line: dict[str, set[str]] = {}
    for row in qrows:
        for _, line in checkpoint_lines(row):
            streams_of_line.setdefault(line["id"], set()).add(row.slug)
    for line_id in [*overrides["match"], *overrides["skip"]]:
        if line_id not in streams_of_line:
            raise ValueError(f"override: no checkpoint line has the id '{line_id}'")
    for line_id, item_id in overrides["match"].items():
        item = by_id.get(item_id)
        if item is None:
            raise ValueError(f"override {line_id}: item {item_id} does not exist for this user or has no lane")
        if streams_of_line[line_id] != {item.stream}:
            raise ValueError(f"override {line_id}: item {item_id} is in '{item.stream}', the line is in {sorted(streams_of_line[line_id])}")

    pending: dict[int, str] = {}  # item id -> label_month this run sets

    def label_of(item: Task) -> str | None:
        return pending.get(item.id, item.label_month)

    def year_of(mon: str) -> int | None:
        quarter_number = MONTHS.index(mon) // 3 + 1
        years = {int(label[:4]) for label in labels if label.endswith(f"-Q{quarter_number}")}
        return years.pop() if len(years) == 1 else None

    # a. label_month from checkpoint
    for t in tasks:
        if t.label_month is None and t.checkpoint and t.label_date is None:
            year = year_of(t.checkpoint)
            if year is None:
                out.counts["ambiguous"] += 1
                out.lines.append(f"id={t.id} stream={t.stream} ambiguous: checkpoint {t.checkpoint} fits no single stored quarter; skipped")
                continue
            new = month_label(year, t.checkpoint)
            pending[t.id] = new
            out.label_updates.append((t, new))
            out.lines.append(f"id={t.id} stream={t.stream} label_month: None -> {new} (from checkpoint {t.checkpoint})")
        elif t.label_month and t.checkpoint and MONTHS[int(t.label_month[5:]) - 1] != t.checkpoint:
            out.drift += 1
            out.lines.append(f"id={t.id} stream={t.stream} drift: label_month {t.label_month} but checkpoint {t.checkpoint}; left as is")

    # b. checkpoint lines -> tasks
    position = {}
    for t in tasks:
        position[t.stream] = max(position.get(t.stream, -1), t.lane_position if t.lane_position is not None else -1)
    seen = set(origins)
    for row in qrows:
        for mon, line in checkpoint_lines(row):
            origin = f"{ORIGIN}:{row.quarter}:{mon}:{line['id']}"
            if origin in seen:
                continue
            seen.add(origin)
            if mon not in quarter_months(row.quarter):
                out.counts["ambiguous"] += 1
                out.lines.append(f"stream={row.slug} ambiguous: {row.quarter} has a '{mon}' checkpoint; line {_quote(line['text'])} skipped")
                continue
            label = month_label(int(row.quarter[:4]), mon)
            if line["id"] in overrides["skip"]:
                out.counts["overridden"] += 1
                out.lines.append(f"stream={row.slug} skipped (override): {_quote(line['text'])} [{label}]")
                continue
            target, how = None, "matched"
            if line["id"] in overrides["match"]:
                target, how = by_id[overrides["match"][line["id"]]], "matched (override)"
                out.counts["overridden"] += 1
            else:
                best = 0
                for t in tasks:  # only items that existed before this run: two equal monthly lines stay two tasks
                    if t.stream == row.slug and (score := same_text(line["text"], t.text)) > best:
                        target, best = t, score
            if target is not None:
                out.counts["matched"] += 1
                set_it = label_of(target) is None and target.label_date is None
                if set_it:
                    pending[target.id] = label
                    out.label_updates.append((target, label))
                out.lines.append(
                    f"id={target.id} stream={row.slug} {how}: line {_quote(line['text'])} [{label}] ~ item {_quote(target.text)} "
                    f"[label_month={label_of(target)} checkpoint={target.checkpoint} lane={target.lane}]"
                    + (f"; label_month: None -> {label}" if set_it else ""))
                continue
            done = bool(line.get("done"))
            position[row.slug] = position.get(row.slug, -1) + 1
            lane = "done" if done else "next"
            out.counts["created_done" if done else "created_next"] += 1
            out.creates.append({
                "user_id": user_id, "stream": row.slug, "lane": lane, "lane_position": position[row.slug], "text": line["text"],
                "description": "", "products": [], "blocked_by": [], "added_on": today, "done": done, "status": "done" if done else "open",
                "done_on": today if done else None, "label_month": label, "origin": origin,
            })
            out.lines.append(f"id=new stream={row.slug} create: lane={lane} text={_quote(line['text'])} label_month={label} origin={origin}")

    # c. goal_ref for blocks with exactly one current-quarter goal
    current = quarter_for(today)
    for row in qrows:
        goals = row.goal_checklist or checklist_from_text(row.goal)
        if row.quarter != current or len(goals) != 1:
            continue
        gid = goals[0]["id"]
        for t in tasks:
            if t.stream == row.slug and t.goal_ref is None:
                out.goal_updates.append((t, gid))
                out.lines.append(f"id={t.id} stream={t.stream} goal_ref: None -> {gid} ({_quote(goals[0]['text'])})")
        for spec in out.creates:
            if spec["stream"] == row.slug:
                spec["goal_ref"] = gid
                out.lines.append(f"id=new stream={row.slug} goal_ref: None -> {gid} (for origin {spec['origin']})")
    return out


async def apply(db, p: Plan) -> dict:
    """Write the plan through the session (flush only: the caller commits) and return the journal."""
    updates = []
    for t, new in p.label_updates:
        updates.append({"id": t.id, "column": "label_month", "old": t.label_month, "new": new})
        t.label_month = new
    for t, new in p.goal_updates:
        updates.append({"id": t.id, "column": "goal_ref", "old": t.goal_ref, "new": new})
        t.goal_ref = new
    rows = [Task(**spec) for spec in p.creates]
    db.add_all(rows)
    await db.flush()
    return {
        "user": p.user_id, "today": p.today.isoformat(), "overrides": p.overrides,
        "created": [{"id": r.id, "stream": r.stream, "text": r.text, "lane": r.lane, "label_month": r.label_month,
                     "goal_ref": r.goal_ref, "origin": r.origin} for r in rows],
        "updates": updates, "summary": p.summary(),
    }


async def revert(db, journal: dict, do_apply: bool) -> tuple[list[str], int]:
    """Undo a journal: delete the tasks it created and restore the values it changed, each only if still as the run left it.

    Returns (lines, number of changes made or, in a dry run, that would be made). Anything edited since is skipped and printed."""
    user_id = journal["user"]
    lines, changed = [], 0
    for u in reversed(journal["updates"]):
        t = (await db.execute(select(Task).where(Task.user_id == user_id, Task.id == u["id"]))).scalar_one_or_none()
        now = getattr(t, u["column"]) if t is not None else None
        if t is None or now != u["new"]:
            why = "is gone" if t is None else f"is {now!r} now, not {u['new']!r}"
            lines.append(f"id={u['id']} {u['column']} skipped: it {why}; left alone")
            continue
        lines.append(f"id={u['id']} {u['column']}: {u['new']} -> {u['old']}")
        changed += 1
        if do_apply:
            setattr(t, u["column"], u["old"])
    for c in reversed(journal["created"]):
        t = (await db.execute(select(Task).where(Task.user_id == user_id, Task.id == c["id"]))).scalar_one_or_none()
        if t is None:
            lines.append(f"id={c['id']} delete skipped: already gone")
        elif any(getattr(t, k) != c[k] for k in ("stream", "text", "lane", "label_month", "goal_ref", "origin")):
            lines.append(f"id={c['id']} delete skipped: edited since ({_quote(t.text)} in {t.lane}); left alone")
        else:
            lines.append(f"id={c['id']} delete: {_quote(t.text)} (lane {t.lane})")
            changed += 1
            if do_apply:
                await planner_work._delete_row(db, t)
    return lines, changed
