"""The boards migration: three new tables, up/down/up. Earlier migrations are Postgres-only, so SQLite starts from metadata."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "d1f3b5c7e9a2"
THIS = "e6a8c0d2f4b7"  # the revision under test; later ones are tested on their own
TABLES = ("boards", "board_nodes", "board_edges")


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _users_ddl() -> str:
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import user  # noqa: F401

    return str(CreateTable(Base.metadata.tables["users"]).compile(dialect=sqlite.dialect())) + ";"


def _tables(c: sqlite3.Connection) -> set[str]:
    return {r[0] for r in c.execute("select name from sqlite_master where type = 'table'")}


def test_models_register_with_metadata():
    from app.core.database import Base
    from app.models import board  # noqa: F401

    assert set(TABLES) <= set(Base.metadata.tables)
    assert [c.name for c in Base.metadata.tables["board_nodes"].primary_key] == ["board_id", "id"]
    assert [c.name for c in Base.metadata.tables["board_edges"].primary_key] == ["board_id", "id"]


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
        c.execute("insert into boards (user_id, title, kind, viewport, revision, created_at, updated_at) values (1, 'Life', 'life', '{}', 0, '2026-01-01', '2026-01-01')")
        c.execute("insert into boards (user_id, title, kind, viewport, revision, created_at, updated_at) values (1, 'Free', 'free', '{}', 0, '2026-01-01', '2026-01-01')")
        try:  # one life board per user
            c.execute("insert into boards (user_id, title, kind, viewport, revision, created_at, updated_at) values (1, 'Again', 'life', '{}', 0, '2026-01-01', '2026-01-01')")
            raise AssertionError("a second life board was accepted")
        except sqlite3.IntegrityError:
            pass
        c.execute("insert into board_nodes (board_id, id, kind, position, text, style, collapsed, hidden, updated_at) values (1, 'n1', 'mind', 0, 't', '{}', 0, 0, '2026-01-01')")
        c.execute("insert into board_edges (board_id, id, from_id, to_id, label, style) values (1, 'e1', 'n1', 'task:5', '', '{}')")
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not set(TABLES) & _tables(c)
        assert c.execute("select email from users").fetchall() == [("a@b.c",)]  # no user lost
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert set(TABLES) <= _tables(c)
