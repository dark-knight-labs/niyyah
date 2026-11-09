"""The suggestions migration: two new tables, up/down/up, on sqlite (from metadata) and on a scratch Postgres database."""
import asyncio
import os
import sqlite3
import uuid
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest

from tests.test_boards_migration import _alembic, _tables, _users_ddl

PARENT = "b7d9f1a3c5e8"
THIS = "f1a3c5e7b9d2"
TABLES = ("suggestion_bundles", "suggestion_changes")
INDEX = "ix_suggestion_bundles_user_status"


def test_models_register_with_metadata():
    from app.core.database import Base
    from app.models import suggestion  # noqa: F401

    assert set(TABLES) <= set(Base.metadata.tables)
    assert {i.name for i in Base.metadata.tables["suggestion_bundles"].indexes} == {INDEX}


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_users_ddl())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert set(TABLES) <= _tables(c)
        assert INDEX in {r[0] for r in c.execute("select name from sqlite_master where type = 'index'")}
        c.execute("insert into suggestion_bundles (user_id, source, title, status) values (1, 'owner', 't', 'pending')")
        c.execute("insert into suggestion_changes (bundle_id, seq, op, entity, target, payload, status) values (1, 1, 'update', 'compass', '{}', '{}', 'pending')")
        with pytest.raises(sqlite3.IntegrityError):  # (bundle_id, seq) is unique
            c.execute("insert into suggestion_changes (bundle_id, seq, op, entity, target, payload, status) values (1, 1, 'update', 'compass', '{}', '{}', 'pending')")
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not set(TABLES) & _tables(c)
        assert c.execute("select email from users").fetchall() == [("a@b.c",)]
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert set(TABLES) <= _tables(c)


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL", "").startswith("postgresql"), reason="needs Postgres (TEST_DATABASE_URL)")
def test_postgres_upgrade_downgrade_upgrade():
    admin = urlsplit(os.environ["TEST_DATABASE_URL"])
    dsn = urlunsplit(admin._replace(scheme="postgresql", path="/postgres"))
    name = f"mig_{uuid.uuid4().hex[:10]}"
    scratch = urlunsplit(admin._replace(path=f"/{name}"))

    async def sql(database_dsn, query):
        conn = await asyncpg.connect(database_dsn)
        try:
            return await conn.fetch(query)
        finally:
            await conn.close()

    async def state():
        conn = await asyncpg.connect(urlunsplit(admin._replace(scheme="postgresql", path=f"/{name}")))
        try:
            tables = {r[0] for r in await conn.fetch("select tablename from pg_tables where schemaname = 'public'")}
            indexes = {r[0] for r in await conn.fetch("select indexname from pg_indexes where schemaname = 'public'")}
            return tables, indexes
        finally:
            await conn.close()

    asyncio.run(sql(dsn, f'create database "{name}"'))
    try:
        _alembic(scratch, "upgrade", PARENT)
        before, _ = asyncio.run(state())
        _alembic(scratch, "upgrade", THIS)
        tables, indexes = asyncio.run(state())
        assert set(TABLES) <= tables and INDEX in indexes
        assert tables - set(TABLES) == before  # nothing else touched
        _alembic(scratch, "downgrade", PARENT)
        tables, indexes = asyncio.run(state())
        assert tables == before and INDEX not in indexes
        _alembic(scratch, "upgrade", THIS)
        assert set(TABLES) <= asyncio.run(state())[0]
    finally:
        asyncio.run(sql(dsn, f'drop database "{name}" with (force)'))
