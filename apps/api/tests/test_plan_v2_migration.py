"""The Plan v2 revision: three nullable columns on planner_tasks; up/down/up; an older image can still insert.

SQLite runs on every test run. Postgres runs when NIYYAH_PG_URL points at an empty throwaway database
(e.g. postgresql+asyncpg://postgres:x@localhost:55432/postgres): the whole chain from an empty schema, and the label_month CHECK.
"""
import asyncio
import os
import sqlite3

import pytest

from tests.test_items_migration import _alembic, _columns

PARENT = "d4f6a8c0e2b9"
THIS = "f1a3c5e7b9d2"
NEW_COLUMNS = {"goal_ref", "label_month", "label_date"}
# The INSERT the image before this revision makes: none of the new columns.
OLD_INSERT = ("insert into planner_tasks (user_id, text, done, products, description, position) "
              "values (1, 'old image', {done}, '[]', '', 9)")


def _schema_at_parent() -> str:
    """The users and planner_tasks tables as they were at PARENT: today's metadata without the Plan v2 columns."""
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import planner, user  # noqa: F401
    from tests.migration_support import without_columns

    return "\n".join(without_columns(str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect())), tuple(NEW_COLUMNS)) + ";"
                     for name in ("users", "planner_tasks"))


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_schema_at_parent())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        c.execute(OLD_INSERT.format(done=0).replace("'old image'", "'before'"))
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert NEW_COLUMNS <= _columns(c, "planner_tasks")
        assert c.execute("select goal_ref, label_month, label_date from planner_tasks where text = 'before'").fetchone() == (None, None, None)
        c.execute(OLD_INSERT.format(done=0))  # the older image can still insert
        c.execute("update planner_tasks set goal_ref = 'g1', label_month = '2026-11', label_date = '2026-11-12' where text = 'before'")
    assert THIS in _alembic(url, "current")
    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not NEW_COLUMNS & _columns(c, "planner_tasks")
        assert c.execute("select count(*) from planner_tasks").fetchone() == (2,)  # no task lost
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert c.execute("select goal_ref, label_month from planner_tasks where text = 'before'").fetchone() == (None, None)


PG_URL = os.environ.get("NIYYAH_PG_URL", "")


@pytest.mark.skipif(not PG_URL, reason="set NIYYAH_PG_URL to an empty throwaway Postgres to run")
def test_postgres_full_chain_up_down_up_and_check_constraint():
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError
    from sqlalchemy.ext.asyncio import create_async_engine

    async def sql(*statements: str) -> list:
        engine = create_async_engine(PG_URL)
        out = []
        try:
            async with engine.begin() as conn:
                for statement in statements:
                    result = await conn.execute(text(statement))
                    out.append(result.fetchall() if result.returns_rows else None)
        finally:
            await engine.dispose()
        return out

    _alembic(PG_URL, "upgrade", PARENT)
    asyncio.run(sql(
        "insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
        " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', true, now(), now())",
        OLD_INSERT.format(done="false").replace("'old image'", "'before'")))
    _alembic(PG_URL, "upgrade", "head")
    asyncio.run(sql(OLD_INSERT.format(done="false")))  # the older image can still insert
    row = asyncio.run(sql("select goal_ref, label_month, label_date from planner_tasks where text = 'before'"))
    assert row == [[(None, None, None)]]
    good = ("2026-01", "2026-09", "2026-10", "2026-12", "1999-06")
    for value in good:
        asyncio.run(sql(f"update planner_tasks set label_month = '{value}' where text = 'before'"))
    for value in ("2026-13", "2026-00", "2026-1", "26-11", "nov-2026", "2026/11", "20261-1"):
        with pytest.raises(DBAPIError):
            asyncio.run(sql(f"update planner_tasks set label_month = '{value}' where text = 'before'"))
    asyncio.run(sql("update planner_tasks set label_month = null where text = 'before'"))  # NULL is always allowed
    _alembic(PG_URL, "downgrade", PARENT)
    gone = asyncio.run(sql("select count(*) from information_schema.columns where table_name = 'planner_tasks' and column_name in "
                           "('goal_ref', 'label_month', 'label_date')", "select count(*) from planner_tasks"))
    assert gone == [[(0,)], [(2,)]]
    _alembic(PG_URL, "upgrade", THIS)
    assert asyncio.run(sql("select label_month from planner_tasks where text = 'before'")) == [[(None,)]]
