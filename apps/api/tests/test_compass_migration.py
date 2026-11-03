"""The compass migration: a new table and personas.stream, up/down/up. Earlier migrations are Postgres-only, so SQLite starts from metadata."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "a7c9e1b3d5f0"
THIS = "d1f3b5c7e9a2"  # the revision under test; later ones are tested on their own


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _schema_at_parent() -> str:
    """users and personas as they were at PARENT: today's metadata without personas.stream and without compass."""
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import compass, persona, user  # noqa: F401

    ddl = []
    for name in ("users", "personas"):
        text = str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect()))
        if name == "personas":
            text = "\n".join(line for line in text.split("\n") if not line.strip().startswith("stream "))
        ddl.append(text + ";")
    return "\n".join(ddl)


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"pragma table_info({table})")}


def _has_table(c: sqlite3.Connection, name: str) -> bool:
    return bool(c.execute("select name from sqlite_master where type = 'table' and name = ?", (name,)).fetchall())


def test_sqlite_upgrade_downgrade_upgrade(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_schema_at_parent())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        c.execute("insert into personas (user_id, name, arabic_name, domain, eventually, icon, color, points, \"order\", created_at, updated_at)"
                  " values (1, 'Father', '', 'family', '', 'star', '#e11d48', '[]', 0, '2026-01-01', '2026-01-01')")
        assert "stream" not in _columns(c, "personas") and not _has_table(c, "compass")
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert _has_table(c, "compass") and "stream" in _columns(c, "personas")
        assert c.execute("select name, stream from personas").fetchall() == [("Father", None)]
        c.execute("insert into compass (user_id, mission, vision, vision_horizon, updated_at) values (1, 'm', 'v', '2046', '2026-01-01')")
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not _has_table(c, "compass") and "stream" not in _columns(c, "personas")
        assert c.execute("select name from personas").fetchall() == [("Father",)]  # no persona lost
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert _has_table(c, "compass") and "stream" in _columns(c, "personas")
