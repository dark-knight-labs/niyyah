"""The shadow item tree: planner_areas and planner_items mirrored from the legacy quarter tables.

Legacy (planner_quarters, planner_quarter_streams) stays the source of truth; nothing reads the tree to answer a request.
`rebuild` makes the tree equal to legacy (UPSERT by (user_id, legacy_ref), orphans deleted, ids stable), `project` reads the goal
fields back out of the tree in the shape of planner_store.quarter_data, `compare` lists every difference (empty = equal).
A session hook keeps the tree current after any flush that touches a Quarter or QuarterStream.

legacy_ref values:
  q:<label>                           Super Objective of a quarter
  qs:<label>:<slug>                   quarter goal of one stream
  qs:<label>:<slug>:g:<id>            line of the goal checklist
  qs:<label>:<slug>:m:<mon>           month checkpoint
  qs:<label>:<slug>:m:<mon>:<id>      line of a checkpoint checklist
A repeated ref (same line id twice, same month twice) gets the suffix ":dup1", ":dup2", ... ; the line id is the ref minus that suffix.
"""
import logging
import os
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import delete, event, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.planner import PlannerArea, PlannerItem, Quarter, QuarterStream
from app.services import item_rules
from app.services.rules import checklist_from_text

log = logging.getLogger(__name__)

ITEMS = PlannerItem.__table__
AREAS = PlannerArea.__table__
_TOUCHED = "tree_shadow_touched"
_DUP = re.compile(r":dup\d+$")
_ITEM_FIELDS = ("area", "title", "subtitle", "period", "horizon", "status", "commitment", "position", "parent_id", "tags")
_AREA_FIELDS = ("legacy_ref", "name", "color", "icon", "slot", "weekly", "has_pipeline", "in_note", "position", "archived")


def enabled() -> bool:
    """Kill switch for the hook: NIYYAH_TREE_SHADOW=off. The CLI ignores it."""
    return os.environ.get("NIYYAH_TREE_SHADOW", "on").lower() != "off"


# ---- the desired tree, computed from legacy rows (pure) --------------------------------------------------------------

def _uniq(seen: dict[str, int], ref: str) -> str:
    n = seen.get(ref, 0)
    seen[ref] = n + 1
    return ref if n == 0 else f"{ref}:dup{n}"


def _line_items(lines: list[dict], prefix: str, parent: str, area: str, seen: dict[str, int]) -> list[dict]:
    out = []
    for n, line in enumerate(lines or []):
        out.append({"ref": _uniq(seen, f"{prefix}{line.get('id') or ''}"), "parent_ref": parent, "area": area, "title": line.get("text", ""),
                    "subtitle": None, "horizon": None, "period": None, "commitment": None, "status": "done" if line.get("done") else "open", "position": n,
                    "tags": [line["product"]] if line.get("product") else []})  # Plan v3: a goal line's product is the tree item's tag
    return out


def desired(quarters: list[dict], streams: list[dict]) -> tuple[list[dict], list[dict]]:
    """(areas, items) the legacy rows call for. Items come parents first. Streams the note does not define (in_note false) have no goal."""
    seen: dict[str, int] = {}
    items: list[dict] = []
    for q in sorted(quarters, key=lambda r: r["label"]):
        label = q["label"]
        items.append({"ref": f"q:{label}", "parent_ref": None, "area": None, "title": q["objective"], "subtitle": q["objective_ar"] or None,
                      "horizon": None, "period": item_rules.quarter_period(label), "commitment": None, "status": "open", "position": 0})
        for s in sorted((s for s in streams if s["quarter"] == label and s["in_note"]), key=lambda r: r["position"]):
            goal = _uniq(seen, f"qs:{label}:{s['slug']}")
            items.append({"ref": goal, "parent_ref": None, "area": s["slug"], "title": s["goal"], "subtitle": None,
                          "horizon": None, "period": item_rules.quarter_period(label), "commitment": s["status"], "status": "open", "position": s["position"]})
            items += _line_items(s["goal_checklist"], f"{goal}:g:", goal, s["slug"], seen)
            for n, c in enumerate(s["checkpoints"] or []):
                period = item_rules.month_period(label, c.get("month", ""))
                if not period:
                    continue  # not representable; compare() reports it as a missing checkpoint
                ref = _uniq(seen, f"{goal}:m:{c['month']}")
                items.append({"ref": ref, "parent_ref": goal, "area": s["slug"], "title": c.get("text", ""), "subtitle": None, "horizon": None, "period": period,
                              "commitment": None, "status": "open", "position": n})
                items += _line_items(c.get("checklist") or [], f"{ref}:", ref, s["slug"], seen)
    for it in items:
        it.setdefault("tags", [])
    latest: dict[str, dict] = {}
    for s in sorted(streams, key=lambda r: r["quarter"]):
        latest[s["slug"]] = s
    areas = [{"legacy_ref": f"area:{s['slug']}", "slug": s["slug"], "name": s["name"], "color": s["color"], "icon": s["icon"], "slot": s["slot"], "weekly": s["weekly"],
              "has_pipeline": s["has_pipeline"], "in_note": s["in_note"], "position": s["position"], "archived": s["status"] == "archived"}
             for s in sorted(latest.values(), key=lambda r: (r["position"], r["slug"]))]
    return areas, items


# ---- rebuild (Core only: also runs inside a flush) -------------------------------------------------------------------

def _legacy(conn, user_id: int) -> tuple[list[dict], list[dict]]:
    q, s = Quarter.__table__, QuarterStream.__table__
    quarters = [dict(r._mapping) for r in conn.execute(select(q).where(q.c.user_id == user_id))]
    streams = [dict(r._mapping) for r in conn.execute(select(s).where(s.c.user_id == user_id))]
    return quarters, streams


def _tree_rows(conn, user_id: int) -> list[dict]:
    return [dict(r._mapping) for r in conn.execute(select(ITEMS).where(
        ITEMS.c.user_id == user_id, or_(ITEMS.c.legacy_ref.like("q:%"), ITEMS.c.legacy_ref.like("qs:%"))))]


def rebuild_sync(conn, user_id: int) -> dict[str, int]:
    """Make the user's shadow tree equal to legacy. Idempotent; unchanged rows are not written, ids never change."""
    areas, items = desired(*_legacy(conn, user_id))
    stats = {"inserted": 0, "updated": 0, "deleted": 0}

    have_a = {r["slug"]: r for r in conn.execute(select(AREAS).where(AREAS.c.user_id == user_id)).mappings()}
    for a in areas:
        row = have_a.pop(a["slug"], None)
        if row is None:
            conn.execute(insert(AREAS).values(user_id=user_id, **a))
            stats["inserted"] += 1
        elif any(row[f] != a[f] for f in _AREA_FIELDS):
            conn.execute(update(AREAS).where(AREAS.c.id == row["id"]).values(**{f: a[f] for f in _AREA_FIELDS}))
            stats["updated"] += 1
    stale = [r["id"] for r in have_a.values() if (r["legacy_ref"] or "").startswith("area:")]  # hand-made areas are never deleted
    if stale:
        conn.execute(delete(AREAS).where(AREAS.c.id.in_(stale)))
        stats["deleted"] += len(stale)

    have = {r["legacy_ref"]: r for r in _tree_rows(conn, user_id)}
    ids: dict[str, int] = {}
    today = datetime.now(ZoneInfo(settings.app_timezone)).date()
    for it in items:
        values = {**{f: it[f] for f in _ITEM_FIELDS if f != "parent_id"}, "parent_id": ids.get(it["parent_ref"]) if it["parent_ref"] else None}
        row = have.pop(it["ref"], None)
        if row is None:
            res = conn.execute(insert(ITEMS).values(user_id=user_id, legacy_ref=it["ref"], created_on=today, **values))
            ids[it["ref"]] = res.inserted_primary_key[0]
            stats["inserted"] += 1
        else:
            ids[it["ref"]] = row["id"]
            if any(row[f] != values[f] for f in _ITEM_FIELDS):
                conn.execute(update(ITEMS).where(ITEMS.c.id == row["id"]).values(**values))
                stats["updated"] += 1
    if have:  # orphans: a quarter, stream, line or checkpoint that legacy no longer has
        conn.execute(delete(ITEMS).where(ITEMS.c.id.in_([r["id"] for r in have.values()])))
        stats["deleted"] += len(have)
    return stats


async def rebuild(db: AsyncSession, user_id: int) -> dict[str, int]:
    return await db.run_sync(lambda s: rebuild_sync(s.connection(), user_id))


# ---- projection and comparison -----------------------------------------------------------------------------------------

def _line_id(ref: str, prefix: str) -> str:
    return _DUP.sub("", ref[len(prefix):])


def _lines(children: list[dict], prefix: str) -> list[dict]:
    return [{"id": _line_id(c["legacy_ref"], prefix), "text": c["title"], "done": c["status"] == "done",
             **({"product": c["tags"][0]} if c.get("tags") else {})} for c in children]


async def project(db: AsyncSession, user_id: int, label: str) -> dict | None:
    """What planner_store.quarter_data returns, with every goal field read from the tree. Display fields (quarter dates,
    stream name/colour/icon/slot/weekly) are copied from legacy. A goal the tree lacks shows as None, so compare() sees it."""
    from app.services import planner_store  # late: planner_store imports models only, but keep this module import-light

    quarter = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == label))).scalar_one_or_none()
    if quarter is None:
        return None
    rows = (await db.execute(select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label, QuarterStream.in_note.is_(True)).order_by(QuarterStream.position))).scalars().all()
    tree = [dict(r._mapping) for r in (await db.execute(select(ITEMS).where(
        ITEMS.c.user_id == user_id, or_(ITEMS.c.legacy_ref.like("q:%"), ITEMS.c.legacy_ref.like("qs:%"))).order_by(ITEMS.c.position, ITEMS.c.id)))]
    by_ref = {r["legacy_ref"]: r for r in tree}
    kids: dict[int, list[dict]] = {}
    for r in tree:
        if r["parent_id"] is not None:
            kids.setdefault(r["parent_id"], []).append(r)
    so = by_ref.get(f"q:{label}")
    streams = []
    for r in rows:
        ref = f"qs:{label}:{r.slug}"
        g = by_ref.get(ref)
        entry = {"stream": r.slug, "info": planner_store._stream(r)}
        if g is None or item_rules.kind_of(g["period"], g["horizon"], g["parent_id"] is not None) != item_rules.GOAL:
            entry.update(goal=None, status=None, goal_checklist=None, checkpoints=None)
        else:
            children = kids.get(g["id"], [])
            lines = [c for c in children if item_rules.kind_of(c["period"], c["horizon"], True, item_rules.GOAL) == item_rules.LINE]
            cps = [c for c in children if item_rules.kind_of(c["period"], c["horizon"], True, item_rules.GOAL) == item_rules.CHECKPOINT]
            checkpoints = []
            for c in cps:
                cl = _lines(kids.get(c["id"], []), f"{c['legacy_ref']}:")
                checkpoints.append({"month": item_rules.month_key(c["period"]), "text": c["title"],
                                    "checklist": cl or checklist_from_text(c["title"])})
            entry.update(goal=g["title"], status=g["commitment"],
                         goal_checklist=_lines(lines, f"{ref}:g:") or checklist_from_text(g["title"]), checkpoints=checkpoints)
        streams.append(entry)
    return {"quarter": label, "starts": quarter.starts.isoformat() if quarter.starts else None,
            "ends": quarter.ends.isoformat() if quarter.ends else None,
            "objective": so["title"] if so else None, "objective_ar": (so["subtitle"] or "") if so else None, "streams": streams}


def _diff(want, got, path: str, out: list[str]) -> None:
    if isinstance(want, dict) and isinstance(got, dict):
        for k in sorted(set(want) | set(got)):
            _diff(want.get(k, "<absent>"), got.get(k, "<absent>"), f"{path}.{k}", out)
    elif isinstance(want, list) and isinstance(got, list):
        if len(want) != len(got):
            out.append(f"{path}: {len(want)} entries in legacy, {len(got)} in tree")
        for n, (a, b) in enumerate(zip(want, got)):
            _diff(a, b, f"{path}[{n}]", out)
    elif want != got or type(want) is not type(got):
        out.append(f"{path}: legacy {str(want)[:60]!r}, tree {str(got)[:60]!r}")


async def compare(db: AsyncSession, user_id: int) -> list[str]:
    """Every difference between legacy and the tree for one user. Read-only. Empty list = equal."""
    from app.services import planner_store

    diffs: list[str] = []
    quarters, streams = await db.run_sync(lambda s: _legacy(s.connection(), user_id))
    want_areas, want_items = desired(quarters, streams)
    for q in sorted(quarters, key=lambda r: r["label"]):
        _diff(await planner_store.quarter_data(db, user_id, q["label"]), await project(db, user_id, q["label"]), f"quarter {q['label']}", diffs)
    tree = await db.run_sync(lambda s: _tree_rows(s.connection(), user_id))
    have = {r["legacy_ref"]: r for r in tree}
    for it in want_items:
        row = have.pop(it["ref"], None)
        if row is None:
            diffs.append(f"missing item {it['ref']}")
        else:
            for f in _ITEM_FIELDS:
                if f != "parent_id" and row[f] != it[f]:
                    diffs.append(f"item {it['ref']}.{f}: legacy {str(it[f])[:60]!r}, tree {str(row[f])[:60]!r}")
    diffs += [f"orphan item {ref}" for ref in sorted(have)]
    area_rows = (await db.execute(select(AREAS).where(AREAS.c.user_id == user_id))).mappings().all()
    have_a = {r["slug"]: r for r in area_rows}
    for a in want_areas:
        row = have_a.pop(a["slug"], None)
        if row is None:
            diffs.append(f"missing area {a['slug']}")
        else:
            diffs += [f"area {a['slug']}.{f}: legacy {str(a[f])[:60]!r}, tree {str(row[f])[:60]!r}" for f in _AREA_FIELDS if row[f] != a[f]]
    diffs += [f"orphan area {slug}" for slug in sorted(have_a)]
    return diffs


# ---- the session hook ------------------------------------------------------------------------------------------------

def touch(db: AsyncSession, user_id: int) -> None:
    """Mark a user's shadow stale for a write the hook cannot see (a bulk delete); it is rebuilt at the next flush or commit."""
    db.sync_session.info.setdefault(_TOUCHED, set()).add(user_id)


def _safe_rebuild(session: Session, user_ids: set[int]) -> None:
    """Shadow trouble must never break a legacy write: the rebuild runs in a SAVEPOINT and any error is logged and dropped.
    A unique violation means another writer rebuilt the same user at the same moment: the user is marked again, so the next
    flush or commit retries."""
    for uid in sorted(user_ids):
        try:
            conn = session.connection()
            with conn.begin_nested():
                rebuild_sync(conn, uid)
        except IntegrityError:
            log.warning("tree shadow rebuild for user %s hit a unique conflict; retrying at the next flush or commit", uid)
            session.info.setdefault(_TOUCHED, set()).add(uid)
        except Exception:  # noqa: BLE001 - see docstring; tree-check reports the drift
            log.exception("tree shadow rebuild failed for user %s", uid)


@event.listens_for(Session, "after_flush")
def _after_flush(session: Session, _ctx) -> None:
    if not enabled():
        session.info.pop(_TOUCHED, None)
        return
    users = session.info.pop(_TOUCHED, set())
    for obj in (*session.new, *session.dirty, *session.deleted):
        if isinstance(obj, (Quarter, QuarterStream)):
            users.add(obj.user_id)
    if users:
        _safe_rebuild(session, users)


@event.listens_for(Session, "before_commit")
def _before_commit(session: Session) -> None:
    if not enabled():
        session.info.pop(_TOUCHED, None)
        return
    session.flush()  # before_commit runs before the final flush: rebuild from the state that is about to be committed
    users = session.info.pop(_TOUCHED, set())
    if users:
        _safe_rebuild(session, users)
