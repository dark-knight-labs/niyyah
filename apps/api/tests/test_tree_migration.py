"""The planner_areas / planner_items revision: DDL only, one head, and a downgrade that drops nothing else."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

API_DIR = Path(__file__).resolve().parent.parent
PARENT, THIS = "b7d9f1a3c5e8", "d4f6a8c0e2b9"
NEW = {"planner_areas", "planner_items"}


def _alembic(url: str, *args: str) -> str:
    env = {**os.environ, "DATABASE_URL": url, "APP_ENV": "development", "PYTHONPATH": str(API_DIR)}
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=API_DIR, env=env, check=True, capture_output=True, text=True)
    return done.stdout + done.stderr


def _tables(db) -> set[str]:
    with sqlite3.connect(db) as c:
        return {r[0] for r in c.execute("select name from sqlite_master where type = 'table'")}


def test_single_alembic_head():
    heads = ScriptDirectory.from_config(Config(str(API_DIR / "alembic.ini"))).get_heads()
    assert len(heads) == 1


def test_revision_is_ddl_only():
    src = next((API_DIR / "alembic" / "versions").glob(f"{THIS}_*.py")).read_text()
    assert "app.services" not in src and "tree_shadow" not in src and "execute(" not in src and "bulk_insert" not in src


def test_upgrade_downgrade_upgrade_touches_only_the_two_tables(tmp_path):
    from sqlalchemy import create_engine

    from app.core.database import Base
    from app.models import board, compass, google, persona, planner, principle, tracker, user, vault  # noqa: F401

    db = tmp_path / "t.db"
    url = f"sqlite+aiosqlite:///{db}"
    engine = create_engine(f"sqlite:///{db}")
    Base.metadata.create_all(engine, tables=[t for n, t in Base.metadata.tables.items() if n not in NEW])  # the schema at PARENT
    engine.dispose()
    before = _tables(db)
    with sqlite3.connect(db) as c:
        c.execute("insert into users (id, email, password_hash, timezone, locale, subscription_tier, is_active, created_at, updated_at)"
                  " values (1, 'a@b.c', 'x', 'UTC', 'en', 'free', 1, '2026-01-01', '2026-01-01')")
        c.execute("insert into planner_quarters (user_id, label, objective, objective_ar) values (1, '2026-Q4', 'o', '')")
    _alembic(url, "stamp", PARENT)
    _alembic(url, "upgrade", THIS)
    assert _tables(db) - before - {"alembic_version"} == NEW
    with sqlite3.connect(db) as c:
        assert c.execute("select count(*) from planner_items").fetchone() == (0,)  # DDL only: nothing is backfilled
        assert c.execute("select count(*) from planner_quarters").fetchone() == (1,)
    _alembic(url, "downgrade", PARENT)
    assert _tables(db) - {"alembic_version"} == before
    with sqlite3.connect(db) as c:
        assert c.execute("select count(*) from planner_quarters").fetchone() == (1,)
    _alembic(url, "upgrade", THIS)
    assert _tables(db) - before - {"alembic_version"} == NEW
