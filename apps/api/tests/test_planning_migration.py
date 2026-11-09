"""The planning-rows migration: pipeline items and week objectives become planner_tasks rows.

Seeds every case the old schema allows (lanes, done, linked and unlinked objectives, text and done that differ between an
objective and its item, an empty-text done objective, a duplicate small domino, two users), upgrades, and checks the mapping,
that the two old views read back unchanged through the real read functions, the unique index, that the previous image can
still insert a task, that the downgrade copies back what the old schema can represent, and that upgrading again works.

SQLite runs on every test run. Postgres runs when NIYYAH_PG_URL points at an empty throwaway database
(e.g. postgresql+asyncpg://postgres:x@localhost:55432/postgres): the whole chain from an empty schema.
"""
import asyncio
import os
import sqlite3
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.models.planner import Task
from app.services import planner_store
from app.services.rules import make_stream
from tests.migration_support import PLANNING_COLUMNS, without_columns

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "e8f0a2c4b6d1"
HEAD = "a7c9e1b3d5f0"
W45, W44, W43 = "2026-W45", "2026-W44", "2026-W43"
TODAY = date(2026, 11, 3)  # in W45

def _cols(**types):
    return [sa.column(name, kind) for name, kind in types.items()]


users = sa.table("users", *_cols(id=sa.Integer, email=sa.String, password_hash=sa.String, timezone=sa.String, locale=sa.String, subscription_tier=sa.String,
                                 is_active=sa.Boolean, created_at=sa.DateTime, updated_at=sa.DateTime))
old_tasks = sa.table("planner_tasks", *_cols(user_id=sa.Integer, text=sa.Text, done=sa.Boolean, due_on=sa.Date, scheduled_on=sa.Date, products=sa.JSON,
                                             description=sa.Text, position=sa.Integer, status=sa.String))
items_t = sa.table("planner_pipeline_items", *_cols(id=sa.Integer, user_id=sa.Integer, stream=sa.String, lane=sa.String, text=sa.Text, description=sa.Text,
                                                    products=sa.JSON, checkpoint=sa.String, added_on=sa.Date, done_on=sa.Date, focus_week=sa.String,
                                                    done=sa.Boolean, blocked_by=sa.JSON, position=sa.Integer))
objs_t = sa.table("planner_week_objectives", *_cols(id=sa.Integer, user_id=sa.Integer, week=sa.String, stream=sa.String, text=sa.Text, done=sa.Boolean,
                                                    checkpoint=sa.String))

D = date.fromisoformat


def item(id, stream, lane, text, position, *, done=False, focus=None, checkpoint=None, products=(), description="", added: str | None = "2026-10-20", done_on=None, blocked=(), user=1):
    return dict(id=id, user_id=user, stream=stream, lane=lane, text=text, description=description, products=list(products), checkpoint=checkpoint,
                added_on=D(added) if added else None, done_on=D(done_on) if done_on else None, focus_week=focus, done=done, blocked_by=list(blocked), position=position)


def objective(id, week, stream, text, *, done=False, checkpoint=None, user=1):
    return dict(id=id, user_id=user, week=week, stream=stream, text=text, done=done, checkpoint=checkpoint)


ITEMS = [
    item(1, "studio", "now", "Ship X", 0, focus=W45, checkpoint="nov", products=["Router"], description="two\nlines", blocked=["abcd1234"]),  # linked, text/done/checkpoint differ
    item(2, "studio", "next", "Plan the DNS cutover", 1),
    item(3, "studio", "backlog", "Replace the switch", 2, added=None),
    item(4, "studio", "done", "Order the modem", 3, done=True, done_on="2026-10-30"),
    item(5, "shop", "done", "Launch page", 4, done=True, done_on="2026-10-27", focus=W44),  # linked to a ticked objective of last week
    item(6, "shop", "next", "Photos", 5, focus=W44),  # a duplicate small domino for the same week: the lower position keeps it
    item(7, "shop", "now", "Pricing", 6),
    item(8, "studio", "now", "Other user's item", 0, user=2, focus=W45),
]
OBJECTIVES = [
    objective(1, W45, "studio", "Ship X #oct", done=True, checkpoint="oct"),  # differs from item 1 in text and done and checkpoint
    objective(2, W44, "shop", "Launch the page", done=True),  # linked to item 5
    objective(3, W45, "shop", "Pick a theme", checkpoint="nov"),  # no item carries it
    objective(4, W43, "shop", "", done=True),  # empty text, ticked: kept by the old rules
    objective(5, W45, "studio", "Theirs", user=2),  # linked to item 8
    objective(6, W44, "studio", "Unlinked, last week", user=1),
]
PLAIN = [dict(user_id=1, text="Pay invoice", done=False, due_on=D("2026-11-03"), scheduled_on=None, products=[], description="", position=0, status="open"),
         dict(user_id=1, text="Renew domain", done=True, due_on=None, scheduled_on=D("2026-11-02"), products=[], description="", position=1, status="done")]
# What the image before this migration inserts into planner_tasks: none of the planning columns.
OLD_INSERT = ("insert into planner_tasks (user_id, text, done, due_on, scheduled_on, start_on, done_on, source_path, stream, products,"
              " description, position) values (1, 'old image', {done}, null, '2026-11-03', null, null, null, null, '[]', '', 9)")


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _schema_at_parent() -> str:
    """The tables this migration touches as they were at PARENT: today's metadata without the planning columns."""
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import planner, user  # noqa: F401,F811

    ddl = []
    for name in ("users", "planner_tasks", "planner_pipeline_items", "planner_week_objectives"):
        text = str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect()))
        ddl.append((without_columns(text, PLANNING_COLUMNS) if name == "planner_tasks" else text) + ";")
    return "\n".join(ddl)


async def _seed(conn) -> None:
    for uid in (1, 2):
        await conn.execute(sa.insert(users).values(id=uid, email=f"u{uid}@b.c", password_hash="x", timezone="UTC", locale="en", subscription_tier="free",
                                                  is_active=True, created_at=datetime(2026, 1, 1), updated_at=datetime(2026, 1, 1)))
    await conn.execute(sa.insert(old_tasks), PLAIN)
    await conn.execute(sa.insert(items_t), ITEMS)
    await conn.execute(sa.insert(objs_t), OBJECTIVES)


STREAMS = [make_stream("studio"), make_stream("shop")]


async def _old_views(db: AsyncSession, user_id: int) -> dict:
    """The two views as the image before this migration read them: from the two old tables."""
    from app.models.planner import PipelineItem, WeekObjective
    from app.services.rules import STALE_DAYS

    rows = list((await db.execute(sa.select(PipelineItem).where(PipelineItem.user_id == user_id).order_by(PipelineItem.position))).scalars())
    pipelines: dict[str, list] = {}
    for r in rows:
        age = (TODAY - r.added_on).days if r.added_on else 0
        pipelines.setdefault(r.stream, []).append({
            "products": list(r.products or []), "product": (r.products or [None])[0], "line": r.id, "hash": "", "text": r.text, "lane": r.lane,
            "checkpoint": r.checkpoint, "added": r.added_on.isoformat() if r.added_on else None,
            "done_on": r.done_on.isoformat() if r.done_on else None, "focus": r.focus_week, "done": r.done, "age_days": age,
            "description": r.description, "blocked_by": list(r.blocked_by or []),
            "goal_ref": None, "label_month": None, "label_date": None,  # Plan v2 fields: nothing sets them on a migrated row
            "stale": r.lane in ("next", "backlog") and r.checkpoint is None and age >= STALE_DAYS})
    weeks = sorted({o.week for o in (await db.execute(sa.select(WeekObjective).where(WeekObjective.user_id == user_id))).scalars()})
    objectives = {}
    for week in weeks:
        stored = {o.stream: o for o in (await db.execute(sa.select(WeekObjective).where(
            WeekObjective.user_id == user_id, WeekObjective.week == week))).scalars()}
        objectives[week] = [{"stream": s.id, "text": stored[s.id].text, "done": stored[s.id].done, "checkpoint": stored[s.id].checkpoint} if s.id in stored
                            else {"stream": s.id, "text": "", "done": False, "checkpoint": None} for s in STREAMS]
    return {"pipelines": pipelines, "objectives": objectives}


async def _new_views(db: AsyncSession, user_id: int) -> dict:
    weeks = sorted({w for (w,) in (await db.execute(sa.select(Task.focus_week).where(Task.user_id == user_id, Task.objective_text.is_not(None)))).all()})
    return {"pipelines": await planner_store.pipeline_items(db, user_id, TODAY),
            "objectives": {w: await planner_store.week_objectives(db, user_id, w, STREAMS) for w in weeks}}


def _by_origin(views: dict, origins: dict[int, str]) -> dict:
    """Rewrite the new pipeline `line`s to the old row ids the migration recorded in `origin`."""
    out = {"objectives": views["objectives"], "pipelines": {}}
    for stream, rows in views["pipelines"].items():
        out["pipelines"][stream] = [{**r, "line": int(origins[r["line"]].split("+")[0].split(":")[1])} for r in rows]
    return out


async def _check_upgrade(engine) -> None:
    """Everything asserted after the upgrade; shared by SQLite and Postgres."""
    async with engine.begin() as conn:
        rows = (await conn.execute(sa.text(
            "select id, user_id, stream, lane, lane_position, text, done, status, focus_week, objective_text, objective_done, focus_checkpoint,"
            " checkpoint, origin, due_on, scheduled_on, blocked_by from planner_tasks order by id"))).fetchall()
    by_origin = {r.origin: r for r in rows if r.origin}
    plain = [r for r in rows if not r.origin]
    assert [r.text for r in plain] == ["Pay invoice", "Renew domain"] and all(r.lane is None and r.focus_week is None for r in plain)
    # one row per pipeline item, then one per objective nothing points at; nothing lost, nothing twice
    assert len(rows) == 2 + len(ITEMS) + 3  # 3 objectives have no item (3, 4, 6)
    assert sorted(o for r in rows for o in (r.origin or "").split("+") if o) == sorted(
        [f"pipeline:{i['id']}" for i in ITEMS] + [f"objective:{o['id']}" for o in OBJECTIVES])

    linked = by_origin["pipeline:1+objective:1"]  # text, done and checkpoint of the objective and the item stay apart
    assert (linked.lane, linked.text, linked.done, linked.checkpoint, linked.lane_position) == ("now", "Ship X", False, "nov", 0)
    assert (linked.objective_text, linked.objective_done, linked.focus_checkpoint, linked.focus_week) == ("Ship X #oct", True, "oct", W45)
    done_item = by_origin["pipeline:5+objective:2"]  # last week's domino with its ticked objective
    assert (done_item.lane, done_item.done, done_item.status, done_item.objective_text, done_item.objective_done, done_item.focus_week) == (
        "done", True, "done", "Launch the page", True, W44)
    dup = by_origin["pipeline:6"]  # the duplicate: the lower position (item 5) kept the marker
    assert (dup.focus_week, dup.objective_text) == (None, None)
    plain_item = by_origin["pipeline:2"]
    assert (plain_item.lane, plain_item.focus_week, plain_item.objective_text, plain_item.due_on, plain_item.scheduled_on) == ("next", None, None, None, None)
    only = by_origin["objective:3"]  # no lane: never in the pipelines view
    assert (only.lane, only.lane_position, only.focus_week, only.objective_text, only.objective_done, only.focus_checkpoint, only.text, only.done) == (
        None, None, W45, "Pick a theme", False, "nov", "Pick a theme", False)
    empty = by_origin["objective:4"]  # empty text, ticked: kept
    assert (empty.lane, empty.objective_text, empty.objective_done, empty.status) == (None, "", True, "done")
    assert by_origin["pipeline:8+objective:5"].user_id == 2

    async with AsyncSession(engine) as db:
        for uid in (1, 2):
            origins = {r.id: r.origin for r in rows}
            old = await _old_views(db, uid)
            new = _by_origin(await _new_views(db, uid), origins)
            if uid == 1:  # the one allowed difference: the duplicate lost its marker
                for stream_rows in old["pipelines"].values():
                    for r in stream_rows:
                        if r["line"] == 6:
                            r["focus"] = None
            assert new == old, f"user {uid}: the old views changed"

    async with engine.begin() as conn:
        await conn.execute(sa.text(OLD_INSERT.format(done="false")))  # the previous image can still insert a task
        row = (await conn.execute(sa.text("select lane, focus_week, blocked_by, origin, parent_id from planner_tasks where text = 'old image'"))).one()
        assert row.lane is None and row.focus_week is None and row.origin is None and row.parent_id is None and list(
            row.blocked_by if not isinstance(row.blocked_by, str) else __import__("json").loads(row.blocked_by)) == []
        await conn.execute(sa.text("delete from planner_tasks where text = 'old image'"))
    # the partial unique index: one small domino per user, stream and week; rows without a week are free
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(sa.text("insert into planner_tasks (user_id, text, stream, focus_week, lane, lane_position, done, products, description, position)"
                " values (1, 'dup', 'studio', :w, 'now', 9, :f, '[]', '', 0)"), {"w": W45, "f": False})
    async with engine.begin() as conn:
        for n in range(2):
            await conn.execute(sa.text("insert into planner_tasks (user_id, text, stream, lane, lane_position, done, products, description, position)"
                                       " values (1, :t, 'studio', 'next', 20, :f, '[]', '', 0)"), {"t": f"free{n}", "f": False})
        await conn.execute(sa.text("delete from planner_tasks where text like 'free%'"))


async def _change_while_running(engine) -> None:
    async with engine.begin() as conn:
        # a change made while the new code ran: a new lane item, a ticked item, an item with a day, an edited objective
        await conn.execute(sa.text("insert into planner_tasks (user_id, text, stream, lane, lane_position, done, status, products, description, position, blocked_by, added_on)"
                                   " values (1, 'made later', 'studio', 'next', 7, :f, 'open', '[]', '', 0, '[]', '2026-11-02')"), {"f": False})
        await conn.execute(sa.text("insert into planner_tasks (user_id, text, stream, lane, lane_position, done, status, products, description, position, blocked_by, scheduled_on)"
                                   " values (1, 'scheduled', 'studio', 'now', 8, :f, 'open', '[]', '', 0, '[]', '2026-11-04')"), {"f": False})
        await conn.execute(sa.text("update planner_tasks set lane = 'done', done = :t, status = 'done', done_on = '2026-11-03' where origin = 'pipeline:2'"), {"t": True})
        await conn.execute(sa.text("update planner_tasks set objective_text = 'Ship X later' where origin = 'pipeline:1+objective:1'"))


# --- SQLite ---------------------------------------------------------------------------------------------------------

def _sqlite(path: Path, sql: str, *args):
    with sqlite3.connect(path) as c:
        return c.execute(sql, args).fetchall()


def test_sqlite_upgrade_checks_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_schema_at_parent())

    async def seed():
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            await _seed(conn)
        await engine.dispose()

    asyncio.run(seed())
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", HEAD)  # the head when this migration was written; later ones are tested on their own
    assert HEAD in _alembic(url, "current")

    async def after_upgrade():
        engine = create_async_engine(url)
        await _check_upgrade(engine)
        # a change made while the new code ran
        await _change_while_running(engine)
        await engine.dispose()

    asyncio.run(after_upgrade())
    index = _sqlite(db, "select sql from sqlite_master where name = 'uq_planner_task_focus'")
    assert index and "WHERE focus_week IS NOT NULL" in index[0][0]

    _alembic(url, "downgrade", PARENT)
    assert PARENT in _alembic(url, "current")
    columns = {r[1] for r in _sqlite(db, "pragma table_info(planner_tasks)")}
    assert not columns & set(PLANNING_COLUMNS)
    # the plain tasks stay, the item with a day stays as a plain task; undated lane rows and objective-only rows are gone
    assert [r[0] for r in _sqlite(db, "select text from planner_tasks order by id")] == ["Pay invoice", "Renew domain", "scheduled"]
    items = _sqlite(db, "select stream, lane, text, done, focus_week, position from planner_pipeline_items order by position, id")
    # every pipeline item the old schema could hold, with what changed since: the new items, the done item, the dated item
    assert sorted(i[2] for i in items) == sorted(
        ["Ship X", "Plan the DNS cutover", "Replace the switch", "Order the modem", "Launch page", "Photos", "Pricing", "Other user's item", "made later", "scheduled"])
    assert {i[2]: i[1] for i in items}["Plan the DNS cutover"] == "done" and {i[2]: i[1] for i in items}["scheduled"] == "now"
    objectives = _sqlite(db, "select week, stream, text, done, checkpoint, user_id from planner_week_objectives order by user_id, week, stream")
    assert objectives == [(W43, "shop", "", 1, None, 1), (W44, "shop", "Launch the page", 1, None, 1), (W44, "studio", "Unlinked, last week", 0, None, 1),
                          (W45, "shop", "Pick a theme", 0, "nov", 1), (W45, "studio", "Ship X later", 1, "oct", 1), (W45, "studio", "Theirs", 0, None, 2)]

    _alembic(url, "upgrade", HEAD)  # the head when this migration was written; later ones are tested on their own
    # 10 pipeline items now in the old table, 6 objectives (4 merged into an item, 2 alone? counted below): every one is a row again
    lane_rows = _sqlite(db, "select count(*) from planner_tasks where lane is not null")
    objective_rows = _sqlite(db, "select count(*) from planner_tasks where objective_text is not null")
    assert lane_rows == [(10,)] and objective_rows == [(6,)]
    assert _sqlite(db, "select objective_text from planner_tasks where lane = 'now' and text = 'Ship X'") == [("Ship X later",)]


# --- Postgres -------------------------------------------------------------------------------------------------------

PG_URL = os.environ.get("NIYYAH_PG_URL", "")


@pytest.mark.skipif(not PG_URL, reason="set NIYYAH_PG_URL to an empty throwaway Postgres to run")
def test_postgres_full_chain_up_down_up():
    async def run(fn):
        engine = create_async_engine(PG_URL)
        try:
            return await fn(engine)
        finally:
            await engine.dispose()

    async def reset(engine):
        async with engine.begin() as conn:
            await conn.execute(sa.text("drop schema public cascade"))
            await conn.execute(sa.text("create schema public"))

    asyncio.run(run(reset))
    _alembic(PG_URL, "upgrade", PARENT)

    async def seed(engine):
        async with engine.begin() as conn:
            await _seed(conn)
            # sequences do not follow explicit ids: move them past the seeded rows
            await conn.execute(sa.text("select setval(pg_get_serial_sequence('planner_pipeline_items', 'id'), 100)"))
            await conn.execute(sa.text("select setval(pg_get_serial_sequence('planner_week_objectives', 'id'), 100)"))

    asyncio.run(run(seed))
    _alembic(PG_URL, "upgrade", "head")

    async def checks(engine):
        await _check_upgrade(engine)
        async with engine.begin() as conn:
            index = (await conn.execute(sa.text("select indexdef from pg_indexes where indexname = 'uq_planner_task_focus'"))).scalar_one()
            assert "UNIQUE" in index and "WHERE (focus_week IS NOT NULL)" in index
            fk = (await conn.execute(sa.text("select confdeltype from pg_constraint where conname = 'fk_planner_tasks_parent'"))).scalar_one()
            assert fk in ("n", b"n")  # ON DELETE SET NULL
        await _change_while_running(engine)

    asyncio.run(run(checks))
    _alembic(PG_URL, "downgrade", PARENT)

    async def restored(engine):
        async with engine.begin() as conn:
            texts = [r[0] for r in (await conn.execute(sa.text("select text from planner_tasks order by id"))).fetchall()]
            items = [r[0] for r in (await conn.execute(sa.text("select text from planner_pipeline_items"))).fetchall()]
            objectives = (await conn.execute(sa.text("select week, stream, text, done from planner_week_objectives order by user_id, week, stream"))).fetchall()
            cols = (await conn.execute(sa.text("select count(*) from information_schema.columns where table_name = 'planner_tasks' and column_name = 'lane'"))).scalar_one()
        assert texts == ["Pay invoice", "Renew domain", "scheduled"] and cols == 0
        assert sorted(items) == sorted(["Ship X", "Plan the DNS cutover", "Replace the switch", "Order the modem", "Launch page", "Photos", "Pricing",
                                       "Other user's item", "made later", "scheduled"])
        assert (W45, "studio", "Ship X later", True) in [tuple(o) for o in objectives] and len(objectives) == 6

    asyncio.run(run(restored))
    _alembic(PG_URL, "upgrade", "head")

    async def again(engine):
        async with engine.begin() as conn:
            n = (await conn.execute(sa.text("select count(*) from planner_tasks where lane is not null or objective_text is not null"))).scalar_one()
        assert n > 0

    asyncio.run(run(again))
