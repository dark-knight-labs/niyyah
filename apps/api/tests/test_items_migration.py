"""The item-fields migration: backfill, defaults an older image relies on, up/down/up, and the status reconcile.

SQLite runs on every test run. Postgres runs when NIYYAH_PG_URL points at an empty throwaway database
(e.g. postgresql+asyncpg://postgres:x@localhost:55432/postgres): the whole chain from an empty schema.
"""
import asyncio
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

from app.services.planner_items import RECONCILE_SQL
from tests.migration_support import PLANNING_COLUMNS, without_columns

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "c4e6a8b0d2f5"
THIS = "e8f0a2c4b6d1"  # the revision under test; later revisions (the planning rows) are not part of these tests
ITEM_COLUMNS = ("start_min", "end_min", "weight", "status", "checklist")
# The INSERT the image before this migration makes (planner_day.add_task): none of the new columns.
OLD_INSERT = ("insert into planner_tasks (user_id, text, done, due_on, scheduled_on, start_on, done_on, source_path, stream, products,"
              " description, position) values (1, 'old image', {done}, null, '2026-11-02', null, null, null, null, '[]', '', 9)")


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _schema_at_parent() -> str:
    """The users and planner_tasks tables as they were at PARENT: today's metadata without the item columns."""
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import planner, user  # noqa: F401

    ddl = []
    for name in ("users", "planner_tasks"):
        text = str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect()))
        ddl.append(without_columns(text, ITEM_COLUMNS + PLANNING_COLUMNS) + ";")
    return "\n".join(ddl)


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"pragma table_info({table})")}


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    # Earlier migrations are Postgres-only, so build the parent schema from metadata and stamp it (as test_product_tags_migration).
    with sqlite3.connect(db) as c:
        c.executescript(_schema_at_parent())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        for n, done in enumerate((1, 0)):
            c.execute("insert into planner_tasks (user_id, text, done, products, description, position) values (1, ?, ?, '[]', '', ?)",
                      (f"t{n}", done, n))
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert set(ITEM_COLUMNS) <= _columns(c, "planner_tasks") and _columns(c, "planner_event_overlays")
        assert [r for r in c.execute("select text, status, weight, checklist from planner_tasks order by position")] == [
            ("t0", "done", 0, "[]"), ("t1", "open", 0, "[]")]  # backfilled from done
        c.execute(OLD_INSERT.format(done=0))  # the old image can still insert
        assert c.execute("select status, weight, checklist, start_min from planner_tasks where text = 'old image'").fetchone() == ("open", 0, "[]", None)
        c.execute("insert into planner_event_overlays (user_id, event_key) values (1, 'uid-1')")
        assert c.execute("select status, weight, products, checklist, description, title from planner_event_overlays").fetchone() == (
            "open", 0, "[]", "[]", "", "")
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not set(ITEM_COLUMNS) & _columns(c, "planner_tasks")
        assert not c.execute("select name from sqlite_master where name = 'planner_event_overlays'").fetchall()
        assert c.execute("select count(*) from planner_tasks").fetchone() == (3,)  # no task lost
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert [r[0] for r in c.execute("select status from planner_tasks order by position")] == ["done", "open", "open"]


def test_sqlite_reconcile_makes_status_follow_done(tmp_path):
    db = tmp_path / "r.db"
    with sqlite3.connect(db) as c:
        c.execute("create table planner_tasks (id integer primary key, done boolean not null, status varchar(10) not null)")
        # old code ticked (done, status still open), old code unticked (status still done), a skipped task, two agreeing rows
        c.executemany("insert into planner_tasks (id, done, status) values (?, ?, ?)",
                      [(1, 1, "open"), (2, 0, "done"), (3, 0, "skipped"), (4, 1, "done"), (5, 1, "skipped")])
        c.execute(RECONCILE_SQL)
        c.execute(RECONCILE_SQL)  # idempotent
        rows = dict(c.execute("select id, status from planner_tasks"))
        assert rows == {1: "done", 2: "open", 3: "skipped", 4: "done", 5: "done"}
        assert c.execute("select count(*) from planner_tasks where done").fetchone() == c.execute(
            "select count(*) from planner_tasks where status = 'done'").fetchone()


PG_URL = os.environ.get("NIYYAH_PG_URL", "")


@pytest.mark.skipif(not PG_URL, reason="set NIYYAH_PG_URL to an empty throwaway Postgres to run")
def test_postgres_full_chain_up_down_up_and_old_insert():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    async def sql(*statements: str) -> list:
        engine = create_async_engine(PG_URL)
        out = []
        async with engine.begin() as conn:
            for statement in statements:
                result = await conn.execute(text(statement))
                out.append(result.fetchall() if result.returns_rows else None)
        await engine.dispose()
        return out

    _alembic(PG_URL, "upgrade", PARENT)
    asyncio.run(sql(
        "insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
        " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', true, now(), now())",
        "insert into planner_tasks (user_id, text, done, products, description, position) values (1, 't0', true, '[]', '', 0), (1, 't1', false, '[]', '', 1)"))
    _alembic(PG_URL, "upgrade", THIS)
    statuses, _, old_row = asyncio.run(sql(
        "select text, status from planner_tasks order by position",
        OLD_INSERT.format(done="false"),
        "select status, weight, checklist::text, start_min from planner_tasks where text = 'old image'"))
    assert statuses == [("t0", "done"), ("t1", "open")]
    assert old_row == [("open", 0, "[]", None)]
    asyncio.run(sql("update planner_tasks set done = true where text = 'old image'", RECONCILE_SQL))
    counts = asyncio.run(sql("select count(*) from planner_tasks where done", "select count(*) from planner_tasks where status = 'done'"))
    assert counts[0] == counts[1] == [(2,)]
    _alembic(PG_URL, "downgrade", PARENT)
    gone = asyncio.run(sql("select count(*) from information_schema.tables where table_name = 'planner_event_overlays'",
                           "select count(*) from information_schema.columns where table_name = 'planner_tasks' and column_name = 'status'",
                           "select count(*) from planner_tasks"))
    assert gone == [[(0,)], [(0,)], [(3,)]]
    _alembic(PG_URL, "upgrade", THIS)
    assert asyncio.run(sql("select status from planner_tasks order by position")) == [[("done",), ("open",), ("done",)]]
