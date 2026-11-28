"""The device_tokens revision: two new tables (device_tokens, device_captures), up/down/up, one head. Earlier migrations are Postgres-only, so SQLite starts from metadata."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "a2c4e6f8b0d3"
THIS = "e2a4c6e8b0d7"  # the revision under test; later ones are tested on their own
COLUMNS = {"id", "user_id", "name", "prefix", "token_hash", "scope", "created_at", "last_used_at", "revoked_at"}
CAPTURE_COLUMNS = {"id", "device_token_id", "client_id", "task_id", "created_at"}


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _users_table() -> str:
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import user  # noqa: F401

    return str(CreateTable(Base.metadata.tables["users"]).compile(dialect=sqlite.dialect())) + ";"


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"pragma table_info({table})")}


def _has_table(c: sqlite3.Connection, name: str) -> bool:
    return bool(c.execute("select name from sqlite_master where type = 'table' and name = ?", (name,)).fetchall())


def test_this_revision_is_the_only_head():
    assert _alembic("sqlite+aiosqlite:///:memory:", "heads").split()[0] == THIS


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_users_table())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        assert not _has_table(c, "device_tokens") and not _has_table(c, "device_captures")
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert _columns(c, "device_tokens") == COLUMNS and _columns(c, "device_captures") == CAPTURE_COLUMNS
        c.execute("insert into device_tokens (user_id, name, prefix, token_hash, created_at) values (1, 'mac', 'nyd_abcd', 'h1', '2026-01-01')")
        assert c.execute("select scope from device_tokens").fetchone() == ("capture",)  # the database default
        try:
            c.execute("insert into device_tokens (user_id, name, prefix, token_hash, created_at) values (1, 'again', 'nyd_abcd', 'h1', '2026-01-01')")
            raise AssertionError("token_hash must be unique")
        except sqlite3.IntegrityError:
            pass
        assert _columns(c, "device_captures") == CAPTURE_COLUMNS
        c.execute("insert into device_captures (device_token_id, client_id, task_id, created_at) values (1, 'c1', 7, '2026-01-01')")
        try:
            c.execute("insert into device_captures (device_token_id, client_id, task_id, created_at) values (1, 'c1', 8, '2026-01-01')")
            raise AssertionError("(device_token_id, client_id) must be unique")
        except sqlite3.IntegrityError:
            pass
        c.execute("insert into device_captures (device_token_id, client_id, task_id, created_at) values (2, 'c1', 8, '2026-01-01')")  # per token
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not _has_table(c, "device_tokens") and not _has_table(c, "device_captures")
        assert c.execute("select email from users").fetchall() == [("a@b.c",)]  # no user lost
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert _columns(c, "device_tokens") == COLUMNS and _columns(c, "device_captures") == CAPTURE_COLUMNS
