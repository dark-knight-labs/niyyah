"""The task_capture_extras revision: four nullable columns on planner_tasks, up/down/up on a scratch SQLite file, one head.

Earlier migrations are Postgres-only, so the table starts from today's metadata without the four columns, stamped at the parent."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from tests.migration_support import without_columns

API_DIR = Path(__file__).resolve().parent.parent
PARENT = "e2a4c6e8b0d7"
THIS = "b4d6f8a0c2e5"
NEW = ("link", "deadline_at", "tracked_seconds", "timer_started_at")
SCRIPT = ScriptDirectory.from_config(Config(str(API_DIR / "alembic.ini")))


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _old_tasks_table() -> str:
    from sqlalchemy.dialects import sqlite
    from sqlalchemy.schema import CreateTable

    from app.core.database import Base
    from app.models import planner, user  # noqa: F401

    ddl = lambda name: str(CreateTable(Base.metadata.tables[name]).compile(dialect=sqlite.dialect()))  # noqa: E731
    return ddl("users") + ";\n" + without_columns(ddl("planner_tasks"), NEW) + ";"  # batch mode reflects the foreign key, so users must exist


def _info(c: sqlite3.Connection) -> dict[str, tuple]:
    return {r[1]: r for r in c.execute("pragma table_info(planner_tasks)")}


def test_one_head_and_it_sits_on_the_device_token_revision():
    assert SCRIPT.get_heads() == [THIS]
    assert SCRIPT.get_revision(THIS).down_revision == PARENT


def test_revision_is_additive_ddl_only():
    src = next((API_DIR / "alembic" / "versions").glob(f"{THIS}_*.py")).read_text()
    assert "execute(" not in src and "bulk_insert" not in src and "app.services" not in src
    assert src.count("op.add_column") == 4 and "nullable=False" not in src and "server_default" not in src  # no rewrite, no default


def test_sqlite_upgrade_downgrade_upgrade_keeps_the_rows(tmp_path):
    db = tmp_path / "m.db"
    url = f"sqlite+aiosqlite:///{db}"
    with sqlite3.connect(db) as c:
        c.executescript(_old_tasks_table())
        assert not set(NEW) & set(_info(c))
        c.execute("insert into planner_tasks (user_id, text, done, products, description, position, status, weight, checklist, blocked_by)"
                  " values (1, 'old row', 0, '[]', '', 0, 'open', 0, '[]', '[]')")
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        info = _info(c)
        assert set(NEW) <= set(info) and all(info[n][3] == 0 for n in NEW)  # notnull flag 0: nullable
        assert all(info[n][4] is None for n in NEW)  # and no default
        assert c.execute("select link, deadline_at, tracked_seconds, timer_started_at from planner_tasks").fetchone() == (None,) * 4
        c.execute("update planner_tasks set link = 'https://example.com', tracked_seconds = 30, deadline_at = '2026-12-01 11:30:00',"
                  " timer_started_at = '2026-12-01 09:00:00'")
    assert THIS in _alembic(url, "current")

    _alembic(url, "downgrade", PARENT)
    with sqlite3.connect(db) as c:
        assert not set(NEW) & set(_info(c))
        assert c.execute("select text from planner_tasks").fetchall() == [("old row",)]  # the task survives, only the extras go
    assert PARENT in _alembic(url, "current")

    _alembic(url, "upgrade", THIS)
    with sqlite3.connect(db) as c:
        assert set(NEW) <= set(_info(c)) and c.execute("select count(*) from planner_tasks").fetchone() == (1,)
