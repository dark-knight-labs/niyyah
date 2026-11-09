"""The Plan v3 revision: planner_products table + planner_habits.goal_ref; up/down/up; an older image can still insert a habit.

SQLite runs on every test run. Postgres runs when NIYYAH_PG_URL points at an empty throwaway database
(e.g. postgresql+asyncpg://postgres:x@localhost:55432/postgres): the whole chain from an empty schema, the unique key and the cascade.
"""
import asyncio
import os
import sqlite3

import pytest

from tests.test_items_migration import _alembic, _columns

PARENT = "f1a3c5e7b9d2"
THIS = "a2c4e6f8b0d3"
# The INSERT the image before this revision makes: no goal_ref.
OLD_HABIT = ("insert into planner_habits (user_id, name, block, anchor, per_week, minimum, stage, gate_pct, gate_weeks, started_on, position) "
             "values (1, '{name}', 'soul', '', 7, '', 'installing', 80, 8, '2026-11-09', 0)")
USER = ("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
        " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', {active}, '2026-01-01', '2026-01-01')")


def _schema_at_parent() -> str:
    """users and planner_habits as they were at PARENT: today's metadata without goal_ref."""
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import planner, user  # noqa: F401
    from tests.migration_support import without_columns

    return "\n".join(without_columns(str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect())), ("goal_ref",)) + ";"
                     for name in ("users", "planner_habits"))


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_schema_at_parent())
        c.execute(USER.format(active=1))
        c.execute(OLD_HABIT.format(name="before"))
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert "goal_ref" in _columns(c, "planner_habits")
        assert _columns(c, "planner_products") == {"id", "user_id", "block", "slug", "name", "position", "created_at"}
        assert c.execute("select goal_ref from planner_habits where name = 'before'").fetchone() == (None,)
        c.execute(OLD_HABIT.format(name="older image"))  # the older image can still insert
        c.execute("update planner_habits set goal_ref = 'g1' where name = 'before'")
        c.execute("insert into planner_products (user_id, block, slug, name) values (1, 'studio', 'dns', 'DNS')")
        assert c.execute("select position, created_at is not null from planner_products").fetchone() == (0, 1)  # database defaults
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("insert into planner_products (user_id, block, slug, name) values (1, 'studio', 'dns', 'again')")
    assert THIS in _alembic(url, "current")
    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert "goal_ref" not in _columns(c, "planner_habits")
        assert not _columns(c, "planner_products")
        assert c.execute("select count(*) from planner_habits").fetchone() == (2,)  # no habit lost
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert c.execute("select goal_ref from planner_habits where name = 'before'").fetchone() == (None,)


PG_URL = os.environ.get("NIYYAH_PG_URL", "")


@pytest.mark.skipif(not PG_URL, reason="set NIYYAH_PG_URL to an empty throwaway Postgres to run")
def test_postgres_full_chain_up_down_up():
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
    asyncio.run(sql(USER.format(active="true"), OLD_HABIT.format(name="before")))
    _alembic(PG_URL, "upgrade", "head")
    asyncio.run(sql(OLD_HABIT.format(name="older image")))  # the older image can still insert
    assert asyncio.run(sql("select goal_ref from planner_habits where name = 'before'")) == [[(None,)]]
    asyncio.run(sql("insert into planner_products (user_id, block, slug, name) values (1, 'studio', 'dns', 'DNS')"))
    assert asyncio.run(sql("select position, created_at is not null from planner_products")) == [[(0, True)]]
    with pytest.raises(DBAPIError):  # (user, block, slug) is unique
        asyncio.run(sql("insert into planner_products (user_id, block, slug, name) values (1, 'studio', 'dns', 'again')"))
    asyncio.run(sql("insert into planner_products (user_id, block, slug, name) values (1, 'shop', 'dns', 'DNS')"))  # another block is fine
    with pytest.raises(DBAPIError):  # a product needs a user
        asyncio.run(sql("insert into planner_products (user_id, block, slug, name) values (99, 'studio', 'x', 'X')"))
    asyncio.run(sql("delete from users where id = 1"))  # the cascade takes the products and the habits with the user
    assert asyncio.run(sql("select count(*) from planner_products", "select count(*) from planner_habits")) == [[(0,)], [(0,)]]
    asyncio.run(sql(USER.format(active="true"), OLD_HABIT.format(name="again")))
    _alembic(PG_URL, "downgrade", PARENT)
    assert asyncio.run(sql("select count(*) from information_schema.columns where table_name = 'planner_habits' and column_name = 'goal_ref'",
                           "select count(*) from information_schema.tables where table_name = 'planner_products'",
                           "select count(*) from planner_habits")) == [[(0,)], [(0,)], [(1,)]]
    _alembic(PG_URL, "upgrade", THIS)
    assert asyncio.run(sql("select goal_ref from planner_habits")) == [[(None,)]]
