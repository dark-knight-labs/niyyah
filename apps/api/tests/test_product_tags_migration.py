"""The product -> products migration keeps every item's tag and reverses cleanly."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parent.parent


def _alembic(db: Path, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{db}", "APP_ENV": "development"}
    subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)


def _schema_before() -> str:
    import sqlalchemy as sa
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import user, planner  # noqa: F401

    ddl = []
    for table in (Base.metadata.tables["users"], Base.metadata.tables["planner_pipeline_items"], Base.metadata.tables["planner_tasks"]):
        text = str(CreateTable(table).compile(dialect=sa.dialects.sqlite.dialect()))
        if table.name == "planner_pipeline_items":
            text = text.replace("products JSON NOT NULL", "product VARCHAR(100)")
        if table.name == "planner_tasks":  # the stream column and its index come with a later migration
            text = text.replace("stream VARCHAR(24), ", "")
        ddl.append(text + ";")
    return "\n".join(ddl)


def test_backfill_and_downgrade(tmp_path):
    db = tmp_path / "m.db"
    # Earlier migrations are Postgres-only, so build the current schema, rewind this one table, and stamp the parent revision.
    with sqlite3.connect(db) as c:
        c.executescript(_schema_before())
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        for n, product in enumerate(["Router", None, "  Spaced   Out "]):
            c.execute("insert into planner_pipeline_items (user_id, stream, lane, text, description, product, done, blocked_by, position)"
                      " values (1, 's', 'now', ?, '', ?, 0, '[]', ?)", (f"t{n}", product, n))
    _alembic(db, "stamp", "d5f7a9c1e3b6")
    _alembic(db, "upgrade", "head")
    with sqlite3.connect(db) as c:
        got = [json.loads(r[0]) for r in c.execute("select products from planner_pipeline_items order by position")]
    assert got == [["Router"], [], ["Spaced Out"]]
    _alembic(db, "downgrade", "d5f7a9c1e3b6")
    with sqlite3.connect(db) as c:
        back = [r[0] for r in c.execute("select product from planner_pipeline_items order by position")]
    assert back == ["Router", None, "Spaced Out"]
