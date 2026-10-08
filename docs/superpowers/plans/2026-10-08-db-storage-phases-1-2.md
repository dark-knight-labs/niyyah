# DB storage, phases 1 and 2: schema, importer and database reads

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user database tables for everything the vault holds, a one-way importer from a vault checkout, and database-backed read endpoints that return the same responses as the vault-backed ones, behind a `STORAGE_BACKEND` switch that stays on `vault` in production.

**Architecture:** New SQLAlchemy models in `app/models/planner.py` (all rows carry `user_id`). `app/services/vault_import.py` parses a checkout with the existing parsers and writes rows. `app/services/vault_views.py` holds pure response builders shared by the vault path and the database path, so both return identical shapes by construction. `app/services/planner_store.py` reads the tables in the dict shapes the parsers return. `app/api/v1/vault.py` dispatches each read endpoint on `settings.storage_backend`. Writes stay vault-only (phase 3); in `db` mode they answer 501.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest-asyncio (SQLite in tests, Postgres in production).

Spec: `docs/superpowers/specs/2026-10-08-db-storage-design.md`. This plan covers spec phases 1 and 2 only.

## Global Constraints

- Work in `/home/ubuntu/src/dark-knight/niyyah/apps/api`. Test command: `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (159 tests pass today and must keep passing).
- `STORAGE_BACKEND` defaults to `vault`. With the default, behaviour and every existing test stay unchanged.
- Every new table has an indexed `user_id` and every query on it filters on `user_id`.
- Response schemas in `app/schemas/vault.py` do not change in these phases. In `db` mode `line` carries the row id and `hash` is `""`; the frontend switches to ids in phase 3.
- Legacy `vault_days` rows (written by `sync_vault`) keep `user_id IS NULL` and belong to `vault` mode. Rows with a `user_id` belong to `db` mode.
- Commit after each task. Do not push until the whole plan is done and the full suite passes (a push deploys). Commit messages carry no AI attribution lines.
- Table names are prefixed `planner_` because `schedule_blocks` and others already exist.

## Spec amendments found while planning

These refine the spec; record them in the spec at Task 9.

1. There is no separate `streams` table. In the vault a stream's name, colour, icon, slot, status, goal and checkpoints are defined per quarter, so they live in `planner_quarter_streams` (one row per user, quarter, stream). Phase 4 adds editors on top.
2. `blocked_by` is a JSON list of blocker ids on `planner_pipeline_items`, not an `item_blockers` table. A blocker's id is its notebook entry's `ext_id`; a separate link table would hold the same strings with no useful foreign key.
3. Config tables are `planner_schedule_settings` (one JSON `meta` row per user) and `planner_schedule_blocks`. The `blocks` config table from the spec is deferred to phase 4, which makes blocks user-defined.

## File Structure

| File | Responsibility |
|---|---|
| `app/core/config.py` (modify) | `storage_backend` setting |
| `app/core/deps.py` (modify) | `get_optional_user` |
| `app/models/planner.py` (create) | the ten new tables |
| `app/models/vault.py` (modify) | `VaultDay.user_id`, unique `(user_id, date)` |
| `alembic/versions/d4e8b1a95c20_planner_tables.py` (create) | migration |
| `alembic/env.py` (modify) | import the new models |
| `app/services/vault_import.py` (create) | checkout -> rows, one user |
| `app/services/vault_views.py` (create) | shared pure response builders |
| `app/services/planner_store.py` (create) | database reads in parser shapes |
| `app/api/v1/vault.py` (modify) | access helpers, scoping, dispatch |
| `app/cli.py` (create) | `python -m app.cli import-vault` |
| `tests/vault_fixture.py` (create) | builds a small, realistic vault |
| `tests/test_planner_models.py`, `test_vault_import.py`, `test_db_reads.py` (create) | tests |

---

### Task 1: Storage switch and access helpers

**Files:**
- Modify: `app/core/config.py`, `app/core/deps.py`, `app/api/v1/vault.py`
- Test: `tests/test_storage_switch.py`

**Interfaces:**
- Produces: `settings.storage_backend: str` (`"vault"` or `"db"`); `deps.get_optional_user`; in `vault.py`: `_db_mode() -> bool`, `require_reader(user) -> User`, and `require_editor` answering 501 in db mode.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_storage_switch.py`:

```python
import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_db_mode_refuses_vault_writes(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    monkeypatch.setattr(settings, "storage_backend", "db")
    resp = await auth_client.put("/api/v1/vault/day/2026-10-07/mode", json={"mode": "full"})
    assert resp.status_code == 501
    assert "STORAGE_BACKEND" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_vault_mode_still_blocks_readers_who_are_not_allow_listed(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "")
    monkeypatch.setattr(settings, "storage_backend", "vault")
    resp = await auth_client.get("/api/v1/vault/goals")
    assert resp.status_code == 403
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_storage_switch.py -q`
Expected: the first test FAILS (AttributeError on `storage_backend`, or status 403/200 instead of 501).

- [ ] **Step 3: Implement**

In `app/core/config.py`, after the `vault_tz` line add:

```python
    # Where planner data lives: "vault" = notes in the git checkout (today's behaviour), "db" = this database.
    storage_backend: str = "vault"
```

In `app/core/deps.py` add below `get_current_user`:

```python
optional_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """The signed-in user, or None when the request carries no valid token (for pages that are public in vault mode)."""
    if credentials is None:
        return None
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()
```

In `app/api/v1/vault.py`: change the deps import to `from app.core.deps import get_current_user, get_optional_user`, then replace the `require_editor` definition (just under `_can_edit`) with:

```python
def _db_mode() -> bool:
    return settings.storage_backend == "db"


def require_reader(user: User = Depends(get_current_user)) -> User:
    """Reads of private planner data: the allow-listed owner in vault mode, any signed-in user in db mode (rows are per user)."""
    if not _db_mode() and not _can_edit(user):
        raise HTTPException(status_code=403, detail="Not allowed to edit the vault")
    return user


def require_editor(user: User = Depends(get_current_user)) -> User:
    if _db_mode():
        raise HTTPException(status_code=501, detail="Writes are not available with STORAGE_BACKEND=db yet")
    if not _can_edit(user):
        raise HTTPException(status_code=403, detail="Not allowed to edit the vault")
    return user
```

Then switch these four read endpoints from `Depends(require_editor)` to `Depends(require_reader)`: `get_day_tasks`, `get_day_log`, `get_objectives`, `get_goals`, `get_quarter`, `get_pipelines`, `get_notebooks` (seven in all; leave every PUT/POST on `require_editor`).

- [ ] **Step 4: Run the full suite**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest -q`
Expected: 161 passed.

- [ ] **Step 5: Commit**

```bash
git add app/core/config.py app/core/deps.py app/api/v1/vault.py tests/test_storage_switch.py
git commit -m "Add the STORAGE_BACKEND switch and split read access from write access"
```

---

### Task 2: Models and migration

**Files:**
- Create: `app/models/planner.py`, `alembic/versions/d4e8b1a95c20_planner_tables.py`
- Modify: `app/models/vault.py`, `alembic/env.py`
- Test: `tests/test_planner_models.py`

**Interfaces:**
- Produces (all in `app.models.planner`, each with `id` and `user_id`): `Task(text, done, due_on, scheduled_on, start_on, done_on, source_path, position)`, `LogEntry(day, position, text)`, `Goal(position, title, value, caption, progress)`, `Quarter(label, starts, ends, objective, objective_ar)`, `QuarterStream(quarter, slug, name, color, icon, slot, weekly, has_pipeline, in_note, goal, status, checkpoints, position)`, `WeekObjective(week, stream, text, done, checkpoint)`, `PipelineItem(stream, lane, text, description, product, checkpoint, added_on, done_on, focus_week, done, blocked_by, position)`, `NotebookEntry(stream, ext_id, kind, title, body, entry_date, is_open, position)`, `ScheduleSetting(meta)`, `ScheduleBlock(day_type, block, start, end, what, position)`. `VaultDay.user_id: int | None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_planner_models.py`:

```python
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.planner import Goal, QuarterStream, Task
from app.models.vault import VaultDay
from tests.conftest import TestSession

D = date(2026, 10, 7)


@pytest.mark.asyncio
async def test_two_users_can_each_have_a_day_for_the_same_date():
    async with TestSession() as db:
        db.add_all([
            VaultDay(user_id=1, date=D, mode="full", possible=21, total=0),
            VaultDay(user_id=2, date=D, mode="full", possible=21, total=0),
        ])
        await db.commit()


@pytest.mark.asyncio
async def test_one_user_cannot_have_two_days_for_the_same_date():
    async with TestSession() as db:
        db.add_all([
            VaultDay(user_id=1, date=D, mode="full", possible=21, total=0),
            VaultDay(user_id=1, date=D, mode="off", possible=0, total=0),
        ])
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_planner_rows_round_trip():
    async with TestSession() as db:
        db.add_all([
            Task(user_id=1, text="Pay invoice", done=False, due_on=D, source_path="Efforts/todo.md", position=0),
            Goal(user_id=1, position=0, title="Zero debt", value="62% paid", caption="", progress=62),
            QuarterStream(user_id=1, quarter="2026-Q4", slug="kahf", name="Kahf", color="violet", icon="server", slot="OT",
                          weekly=True, has_pipeline=True, in_note=True, goal="Ship DNS", status="committed",
                          checkpoints=[{"month": "oct", "text": "Router live"}], position=0),
        ])
        await db.commit()
        stream = await db.get(QuarterStream, 1)
        assert stream.checkpoints == [{"month": "oct", "text": "Router live"}]
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_planner_models.py -q`
Expected: FAIL with `ModuleNotFoundError: app.models.planner`.

- [ ] **Step 3: Write the models**

Create `app/models/planner.py`:

```python
"""Per-user planner data: what the vault notes hold, as rows. Every table is scoped by user_id."""
import datetime as dt

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _owner() -> Mapped[int]:
    return mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


class Task(Base):
    """An Obsidian-Tasks style task. It shows on a day when that day is its due, scheduled or start date."""
    __tablename__ = "planner_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    scheduled_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    start_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    source_path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # the vault note it came from, if imported
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class LogEntry(Base):
    __tablename__ = "planner_log_entries"
    __table_args__ = (UniqueConstraint("user_id", "day", "position", name="uq_planner_log_user_day_pos"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    day: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class Goal(Base):
    __tablename__ = "planner_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str] = mapped_column(String(400), nullable=False)
    caption: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-100


class Quarter(Base):
    __tablename__ = "planner_quarters"
    __table_args__ = (UniqueConstraint("user_id", "label", name="uq_planner_quarter_user_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    label: Mapped[str] = mapped_column(String(10), nullable=False)  # "2026-Q4"
    starts: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    ends: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    objective: Mapped[str] = mapped_column(Text, default="", nullable=False)
    objective_ar: Mapped[str] = mapped_column(Text, default="", nullable=False)


class QuarterStream(Base):
    """A stream as one quarter defines it: display fields, goal text and month checkpoints."""
    __tablename__ = "planner_quarter_streams"
    __table_args__ = (UniqueConstraint("user_id", "quarter", "slug", name="uq_planner_qstream"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    quarter: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    icon: Mapped[str] = mapped_column(String(30), nullable=False)
    slot: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    weekly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # has a one-line weekly objective
    has_pipeline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # has a quarter goal and a pipeline
    in_note: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # False for built-ins the note does not define
    goal: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="committed", nullable=False)
    checkpoints: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # [{"month": "oct", "text": "..."}]
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class WeekObjective(Base):
    __tablename__ = "planner_week_objectives"
    __table_args__ = (UniqueConstraint("user_id", "week", "stream", name="uq_planner_objective"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    week: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # "2026-W41"
    stream: Mapped[str] = mapped_column(String(24), nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)


class PipelineItem(Base):
    __tablename__ = "planner_pipeline_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    stream: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    lane: Mapped[str] = mapped_column(String(10), nullable=False)  # now | next | backlog | done
    text: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    product: Mapped[str | None] = mapped_column(String(100), nullable=True)
    checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)
    added_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    focus_week: Mapped[str | None] = mapped_column(String(10), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    blocked_by: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # ext_ids of notebook blockers
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class NotebookEntry(Base):
    __tablename__ = "planner_notebook_entries"
    __table_args__ = (UniqueConstraint("user_id", "stream", "ext_id", name="uq_planner_notebook_ext"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    stream: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    ext_id: Mapped[str] = mapped_column(String(24), nullable=False)  # the id pipeline items use in blocked_by
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # idea | meeting | blocker
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    entry_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_open: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # blockers only
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class ScheduleSetting(Base):
    __tablename__ = "planner_schedule_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)  # city, lat, lon, tz, method, madhab


class ScheduleBlock(Base):
    __tablename__ = "planner_schedule_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    day_type: Mapped[str] = mapped_column(String(10), nullable=False)  # weekday | weekend
    block: Mapped[str] = mapped_column(String(20), nullable=False)
    start: Mapped[str] = mapped_column(String(20), nullable=False)  # "06:00" or an anchor like "fajr+10"
    end: Mapped[str] = mapped_column(String(20), nullable=False)
    what: Mapped[str] = mapped_column(Text, default="", nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
```

In `app/models/vault.py` change `VaultDay`: add `user_id`, make `date` a plain index, and add the unique constraint. Replace the `__tablename__`/`date` lines so the class starts:

```python
class VaultDay(Base):
    __tablename__ = "vault_days"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_vault_days_user_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # NULL = a row synced from the vault checkout (STORAGE_BACKEND=vault); set = a row owned by that user (db mode).
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
```

(keep the remaining `VaultDay` columns and relationship as they are.)

In `alembic/env.py` change the models import to include planner:

```python
from app.models import user, persona, principle, tracker, vault, google, planner  # noqa: F401
```

- [ ] **Step 4: Write the migration**

First confirm the head: `/tmp/niyyah-oss-venv/bin/alembic heads` must print `c3a1f0d27b64`. If it prints something else, use that id as `down_revision`.

Create `alembic/versions/d4e8b1a95c20_planner_tables.py`:

```python
"""planner tables and per-user vault days

Revision ID: d4e8b1a95c20
Revises: c3a1f0d27b64
Create Date: 2026-10-08 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8b1a95c20"
down_revision: Union[str, None] = "c3a1f0d27b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _owner() -> sa.Column:
    return sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


def _create(name: str, *columns, index_user: bool = True) -> None:
    op.create_table(name, sa.Column("id", sa.Integer(), primary_key=True), *columns)
    if index_user:
        op.create_index(f"ix_{name}_user_id", name, ["user_id"])


def upgrade() -> None:
    # vault_days becomes per-user; rows synced from the vault keep user_id NULL.
    op.add_column("vault_days", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_vault_days_user_id", "vault_days", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_vault_days_user_id", "vault_days", ["user_id"])
    op.drop_index("ix_vault_days_date", table_name="vault_days")
    op.create_index("ix_vault_days_date", "vault_days", ["date"], unique=False)
    op.create_unique_constraint("uq_vault_days_user_date", "vault_days", ["user_id", "date"])

    _create("planner_tasks", _owner(),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("due_on", sa.Date()), sa.Column("scheduled_on", sa.Date()), sa.Column("start_on", sa.Date()),
            sa.Column("done_on", sa.Date()), sa.Column("source_path", sa.String(500)),
            sa.Column("position", sa.Integer(), nullable=False))
    for col in ("due_on", "scheduled_on", "start_on"):
        op.create_index(f"ix_planner_tasks_{col}", "planner_tasks", [col])

    _create("planner_log_entries", _owner(),
            sa.Column("day", sa.Date(), nullable=False), sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.UniqueConstraint("user_id", "day", "position", name="uq_planner_log_user_day_pos"))
    op.create_index("ix_planner_log_entries_day", "planner_log_entries", ["day"])

    _create("planner_goals", _owner(),
            sa.Column("position", sa.Integer(), nullable=False), sa.Column("title", sa.String(200), nullable=False),
            sa.Column("value", sa.String(400), nullable=False), sa.Column("caption", sa.String(400), nullable=False),
            sa.Column("progress", sa.Integer()))

    _create("planner_quarters", _owner(),
            sa.Column("label", sa.String(10), nullable=False), sa.Column("starts", sa.Date()), sa.Column("ends", sa.Date()),
            sa.Column("objective", sa.Text(), nullable=False), sa.Column("objective_ar", sa.Text(), nullable=False),
            sa.UniqueConstraint("user_id", "label", name="uq_planner_quarter_user_label"))

    _create("planner_quarter_streams", _owner(),
            sa.Column("quarter", sa.String(10), nullable=False), sa.Column("slug", sa.String(24), nullable=False),
            sa.Column("name", sa.String(80), nullable=False), sa.Column("color", sa.String(20), nullable=False),
            sa.Column("icon", sa.String(30), nullable=False), sa.Column("slot", sa.String(200), nullable=False),
            sa.Column("weekly", sa.Boolean(), nullable=False), sa.Column("has_pipeline", sa.Boolean(), nullable=False),
            sa.Column("in_note", sa.Boolean(), nullable=False), sa.Column("goal", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False), sa.Column("checkpoints", sa.JSON(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.UniqueConstraint("user_id", "quarter", "slug", name="uq_planner_qstream"))
    op.create_index("ix_planner_quarter_streams_quarter", "planner_quarter_streams", ["quarter"])

    _create("planner_week_objectives", _owner(),
            sa.Column("week", sa.String(10), nullable=False), sa.Column("stream", sa.String(24), nullable=False),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("checkpoint", sa.String(3)),
            sa.UniqueConstraint("user_id", "week", "stream", name="uq_planner_objective"))
    op.create_index("ix_planner_week_objectives_week", "planner_week_objectives", ["week"])

    _create("planner_pipeline_items", _owner(),
            sa.Column("stream", sa.String(24), nullable=False), sa.Column("lane", sa.String(10), nullable=False),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("description", sa.Text(), nullable=False),
            sa.Column("product", sa.String(100)), sa.Column("checkpoint", sa.String(3)),
            sa.Column("added_on", sa.Date()), sa.Column("done_on", sa.Date()), sa.Column("focus_week", sa.String(10)),
            sa.Column("done", sa.Boolean(), nullable=False), sa.Column("blocked_by", sa.JSON(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False))
    op.create_index("ix_planner_pipeline_items_stream", "planner_pipeline_items", ["stream"])

    _create("planner_notebook_entries", _owner(),
            sa.Column("stream", sa.String(24), nullable=False), sa.Column("ext_id", sa.String(24), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False), sa.Column("title", sa.String(200), nullable=False),
            sa.Column("body", sa.Text(), nullable=False), sa.Column("entry_date", sa.String(10)),
            sa.Column("is_open", sa.Boolean()), sa.Column("position", sa.Integer(), nullable=False),
            sa.UniqueConstraint("user_id", "stream", "ext_id", name="uq_planner_notebook_ext"))
    op.create_index("ix_planner_notebook_entries_stream", "planner_notebook_entries", ["stream"])

    op.create_table("planner_schedule_settings",
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
                    sa.Column("meta", sa.JSON(), nullable=False))

    _create("planner_schedule_blocks", _owner(),
            sa.Column("day_type", sa.String(10), nullable=False), sa.Column("block", sa.String(20), nullable=False),
            sa.Column("start", sa.String(20), nullable=False), sa.Column("end", sa.String(20), nullable=False),
            sa.Column("what", sa.Text(), nullable=False), sa.Column("position", sa.Integer(), nullable=False))


def downgrade() -> None:
    for name in ("planner_schedule_blocks", "planner_schedule_settings", "planner_notebook_entries",
                 "planner_pipeline_items", "planner_week_objectives", "planner_quarter_streams", "planner_quarters",
                 "planner_goals", "planner_log_entries", "planner_tasks"):
        op.drop_table(name)
    op.drop_constraint("uq_vault_days_user_date", "vault_days", type_="unique")
    op.drop_index("ix_vault_days_date", table_name="vault_days")
    op.create_index("ix_vault_days_date", "vault_days", ["date"], unique=True)
    op.drop_index("ix_vault_days_user_id", table_name="vault_days")
    op.drop_constraint("fk_vault_days_user_id", "vault_days", type_="foreignkey")
    op.drop_column("vault_days", "user_id")
```

Note: the downgrade's unique index on `date` fails if per-user rows share a date. That is expected; downgrade is only safe before any db-mode data exists.

- [ ] **Step 5: Run the new tests and the full suite**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_planner_models.py -q` -> 3 passed.
Run: `/tmp/niyyah-oss-venv/bin/python -m pytest -q` -> 164 passed. If `test_vault_models.py` asserted the old unique-on-date behaviour, update that assertion to the `(user_id, date)` rule (rows with `user_id=None` are not constrained against each other).

- [ ] **Step 6: Verify the migration against a real Postgres**

Run (needs Docker; skip with a note if unavailable and say so in the commit body):

```bash
docker run -d --rm --name niyyah-mig -e POSTGRES_PASSWORD=x -e POSTGRES_USER=niyyah -e POSTGRES_DB=niyyah -p 55432:5432 postgres:17
sleep 6
DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic upgrade head
DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic downgrade -1
DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic upgrade head
docker stop niyyah-mig
```

Expected: three runs without error.

- [ ] **Step 7: Commit**

```bash
git add app/models alembic tests/test_planner_models.py
git commit -m "Add per-user planner tables and scope vault_days by user"
```

---

### Task 3: Test vault fixture

**Files:**
- Create: `tests/vault_fixture.py`
- Test: `tests/test_vault_fixture.py`

**Interfaces:**
- Produces: `build_vault(root: Path, today: date) -> dict` writing a small vault under `root` and returning `{"blocker_id": str, "week": str, "quarter": str}`.

The fixture exercises every parser: two daily notes with votes and log entries, dated tasks (including a done one, an undated one and a vote line that must be skipped), goals, a quarter note, a week objectives note, a pipeline with a product, focus, blocker, description, a stale item and a done item, a notebook with a blocker, and a schedule.

- [ ] **Step 1: Write the failing test**

Create `tests/test_vault_fixture.py`:

```python
from datetime import date

from app.services.vault_notebook import parse_notebook
from app.services.vault_pipeline import parse_pipeline
from tests.vault_fixture import build_vault

TODAY = date(2026, 10, 7)


def test_fixture_parses_with_the_real_parsers(tmp_path):
    info = build_vault(tmp_path, TODAY)
    items = parse_pipeline((tmp_path / "Efforts/Pipeline/kahf.md").read_text(), TODAY)
    assert [i["lane"] for i in items] == ["now", "next", "backlog", "done"]
    assert items[0]["product"] == "Router"
    assert items[0]["blocked_by"] == [info["blocker_id"]]
    assert items[0]["focus"] == info["week"]
    assert items[1]["stale"] is True
    entries = parse_notebook((tmp_path / "Efforts/Streams/kahf.md").read_text())
    blocker = next(e for e in entries if e["kind"] == "blocker")
    assert blocker["id"] == info["blocker_id"] and blocker["open"] is True
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_vault_fixture.py -q`
Expected: FAIL (`ModuleNotFoundError: tests.vault_fixture`).

- [ ] **Step 3: Write the fixture**

Create `tests/vault_fixture.py`:

```python
"""A small but realistic vault for the importer and parity tests."""
from datetime import date, timedelta
from pathlib import Path

from app.services.vault_notebook import add_entry, parse_notebook
from app.services.vault_objectives import week_for
from app.services.vault_quarter import quarter_for
from app.services.vault_streams import MONTHS

DAILY = """---
id: {day}-daily
type: daily
mode: full
stars: 0
possible: 21
---
# {day}

## Votes

> [!soul]+ Soul
> - [ ] ⭐ Bare Minimum
> - [x] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

> [!body]+ Body
> - [x] ⭐ Bare Minimum
> - [ ] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

## Focus
- Ship the router

## Log
- 06:10 Fixed the router
- Second entry
"""

TASKS = """# Todo
- [ ] Pay invoice 📅 {today}
- [x] Renew domain ⏳ {today} ✅ {today}
- [ ] Undated idea
- [ ] ⭐ vote line 📅 {today}
- [ ] Future thing 📅 {later}
"""

QUARTER = """---
quarter: {quarter}
starts: {starts}
ends: {ends}
---
# Allah SWT's satisfaction
> رضا الله

## kahf
- name: Kahf
- slot: OT · Sun to Thu
- goal: Ship DNS
- status: committed
- {month}: Router live

## alisha
- goal: Launch the store
"""

PIPELINE = """---
type: pipeline
stream: kahf
---
# Kahf pipeline

## Now

- [ ] Wire the router [product:: Router] ➕ {added} 🎯 {week} #{month}
  Check the SFP module first.
  blocked-by:: {blocker}

## Next

- [ ] Plan the DNS cutover ➕ {old}

## Backlog

- [ ] Replace the switch

## Done

- [x] Order the modem ➕ {old} ✅ {today}
"""

SCHEDULE = """---
city: Dhaka
lat: 23.8
lon: 90.4
tz: Asia/Dhaka
method: ISNA
madhab: hanafi
---
## weekday
| Block | Start | End | What |
|---|---|---|---|
| soul | fajr | sunrise | Quran |
| ot | 08:00 | 16:00 | Deep work |

## weekend
| Block | Start | End | What |
|---|---|---|---|
| soul | fajr | sunrise | Quran |
"""


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build_vault(root: Path, today: date) -> dict:
    quarter = quarter_for(today)
    week = week_for(today)[2]
    month = MONTHS[today.month - 1]
    first = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)

    for day in (today, today - timedelta(days=1)):
        _write(root, f"Calendar/Daily/{day.isoformat()}.md", DAILY.format(day=day.isoformat()))
    _write(root, "Efforts/todo.md", TASKS.format(today=today.isoformat(), later=(today + timedelta(days=9)).isoformat()))
    _write(root, "Calendar/Goals.md",
           "- **Zero debt**: 62% paid | what it is for | 62\n- **Life simple**: Fewer things\n")
    _write(root, f"Calendar/Quarterly/{quarter}.md", QUARTER.format(
        quarter=quarter, starts=first.isoformat(), ends=(first + timedelta(days=90)).isoformat(), month=month))
    _write(root, f"Calendar/Weekly/Objectives/{week}.md",
           f"- **Kahf**: Wire the router #{month}\n- **Alisha Noor** ✓: Launch page\n")

    notebook = add_entry(None, "kahf", "Kahf", "blocker", "Waiting on legal", "owner: legal https://example.com/doc", today)
    notebook = add_entry(notebook, "kahf", "Kahf", "idea", "Passkeys", "cheaper than SSO", today)
    blocker_id = next(e["id"] for e in parse_notebook(notebook) if e["kind"] == "blocker")
    _write(root, "Efforts/Streams/kahf.md", notebook)

    _write(root, "Efforts/Pipeline/kahf.md", PIPELINE.format(
        added=(today - timedelta(days=2)).isoformat(), old=(today - timedelta(days=30)).isoformat(),
        today=today.isoformat(), week=week, month=month, blocker=blocker_id))
    _write(root, "Calendar/Schedule.md", SCHEDULE)
    return {"blocker_id": blocker_id, "week": week, "quarter": quarter}
```

Note: `add_entry` puts the newest entry first, so the idea (added second) precedes the blocker in the file; the test looks the blocker up by kind.

- [ ] **Step 4: Run and commit**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_vault_fixture.py -q` -> 1 passed.

```bash
git add tests/vault_fixture.py tests/test_vault_fixture.py
git commit -m "Add a realistic vault fixture for importer and parity tests"
```

---

### Task 4: Importer

**Files:**
- Create: `app/services/vault_import.py`
- Test: `tests/test_vault_import.py`

**Interfaces:**
- Consumes: `build_vault` (Task 3); models (Task 2).
- Produces: `async def import_vault(db: AsyncSession, user_id: int, root: Path, today: date) -> ImportReport`; `ImportReport(counts: dict[str, int], errors: list[str])`. Re-running replaces the user's rows (no duplicates). It touches only that user's rows.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_vault_import.py`:

```python
from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.planner import Goal, LogEntry, NotebookEntry, PipelineItem, QuarterStream, ScheduleBlock, Task, WeekObjective
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_import import import_vault
from tests.conftest import TestSession
from tests.vault_fixture import build_vault

TODAY = date(2026, 10, 7)


async def _count(db, model, user_id):
    return (await db.execute(select(func.count()).select_from(model).where(model.user_id == user_id))).scalar_one()


@pytest.mark.asyncio
async def test_import_copies_every_kind_of_note(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        report = await import_vault(db, 1, tmp_path, TODAY)
        assert report.errors == []
        assert report.counts == {
            "days": 2, "log_entries": 4, "tasks": 3, "goals": 2, "quarters": 1, "quarter_streams": 3,
            "objectives": 2, "pipeline_items": 4, "notebook_entries": 2, "schedule_blocks": 3,
        }
        tasks = (await db.execute(select(Task).where(Task.user_id == 1).order_by(Task.position))).scalars().all()
        assert [(t.text, t.done) for t in tasks] == [("Pay invoice", False), ("Renew domain", True), ("Future thing", False)]
        assert tasks[1].scheduled_on == TODAY and tasks[1].done_on == TODAY
        item = (await db.execute(select(PipelineItem).where(PipelineItem.lane == "now"))).scalar_one()
        assert item.product == "Router" and item.blocked_by and item.description == "Check the SFP module first."
        day = (await db.execute(select(VaultDay).where(VaultDay.user_id == 1, VaultDay.date == TODAY))).scalar_one()
        assert day.mode == "full" and day.user_id == 1
        assert await _count(db, Goal, 1) == 2
        assert await _count(db, WeekObjective, 1) == 2


@pytest.mark.asyncio
async def test_import_twice_does_not_duplicate(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        first = await import_vault(db, 1, tmp_path, TODAY)
        second = await import_vault(db, 1, tmp_path, TODAY)
        assert first.counts == second.counts
        for model in (Task, LogEntry, PipelineItem, NotebookEntry, QuarterStream, ScheduleBlock, VaultDay):
            assert await _count(db, model, 1) == first.counts[{
                Task: "tasks", LogEntry: "log_entries", PipelineItem: "pipeline_items", NotebookEntry: "notebook_entries",
                QuarterStream: "quarter_streams", ScheduleBlock: "schedule_blocks", VaultDay: "days"}[model]]
        votes = (await db.execute(select(func.count()).select_from(VaultBlockVote))).scalar_one()
        assert votes == 4  # two days, two voted blocks each; the first import's votes were removed


@pytest.mark.asyncio
async def test_import_leaves_other_users_and_legacy_rows_alone(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        db.add_all([Task(user_id=2, text="Mine", position=0), VaultDay(user_id=None, date=TODAY, mode="full", possible=21, total=0)])
        await db.commit()
        await import_vault(db, 1, tmp_path, TODAY)
        assert await _count(db, Task, 2) == 1
        legacy = (await db.execute(select(func.count()).select_from(VaultDay).where(VaultDay.user_id.is_(None)))).scalar_one()
        assert legacy == 1
```

Count notes for the first test (check against `build_vault`): tasks = Pay invoice, Renew domain, Future thing (undated and the ⭐ line are skipped); log entries = 2 per daily note x 2 notes; quarter streams = kahf, alisha, plus the built-in `sleep` the loader appends; objectives = Kahf and Alisha Noor lines; schedule blocks = 2 weekday + 1 weekend. If a count differs because a parser rule differs from this reading, trust the parser, confirm the reason in `vault_*.py`, and fix the expected number, not the importer.

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_vault_import.py -q`
Expected: FAIL (`ModuleNotFoundError: app.services.vault_import`).

- [ ] **Step 3: Write the importer**

Create `app/services/vault_import.py`:

```python
"""Copy a vault checkout into the database for one user: the one-way door from Obsidian to Niyyah's own storage.

Re-running replaces that user's imported rows, so an import is safe to repeat; it never touches other users' rows
or the legacy vault_days rows (user_id NULL) that STORAGE_BACKEND=vault reads.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, Quarter, QuarterStream, ScheduleBlock, ScheduleSetting, Task,
    WeekObjective,
)
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_goals import GOALS_PATH, parse_goals
from app.services.vault_notebook import _new_id as new_entry_id, parse_notebook
from app.services.vault_objectives import parse_objectives
from app.services.vault_parser import parse_daily_note
from app.services.vault_pipeline import parse_pipeline
from app.services.vault_quarter import load_streams, parse_quarter, quarter_for, quarter_path
from app.services.vault_schedule import parse_schedule
from app.services.vault_streams import SLUG, default_streams
from app.services.vault_tasks import _TASK, _label, _markdown_files
from app.services.vault_write import log_entries

_MARK = re.compile(r"([📅⏳🛫])\s*(\d{4}-\d{2}-\d{2})")
_DONE_ON = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
_COLUMN = {"📅": "due_on", "⏳": "scheduled_on", "🛫": "start_on"}
_QUARTER = re.compile(r"^\d{4}-Q[1-4]$")
_WEEK = re.compile(r"^\d{4}-W\d{2}$")

USER_TABLES = (Task, LogEntry, Goal, Quarter, QuarterStream, WeekObjective, PipelineItem, NotebookEntry,
               ScheduleSetting, ScheduleBlock)


@dataclass
class ImportReport:
    counts: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _iso(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        return None


def _notes(folder: Path):
    return sorted(folder.glob("*.md")) if folder.is_dir() else []


def _days(root: Path, user_id: int, report: ImportReport) -> tuple[list[VaultDay], list[LogEntry]]:
    days: list[VaultDay] = []
    logs: list[LogEntry] = []
    for path in _notes(root / "Calendar" / "Daily"):
        day = _iso(path.stem)
        if day is None:
            continue  # not a YYYY-MM-DD daily note
        try:
            content = path.read_text(encoding="utf-8")
            parsed = parse_daily_note(content, day)
            entries = log_entries(content)
        except Exception as exc:  # one bad note must not abort the import
            report.errors.append(f"{path.name}: {exc}")
            continue
        row = VaultDay(user_id=user_id, date=day, mode=parsed.mode, possible=parsed.possible, total=parsed.total,
                       focus=parsed.focus, log=parsed.log)
        row.block_votes = [VaultBlockVote(block=b, stars=s) for b, s in parsed.blocks.items()]
        days.append(row)
        logs += [LogEntry(user_id=user_id, day=day, position=n, text=e["text"]) for n, e in enumerate(entries)]
    return days, logs


def _tasks(root: Path, user_id: int) -> list[Task]:
    """Tasks carrying a due, scheduled or start date; ⭐ vote lines are skipped, as the vault's own query does."""
    rows: list[Task] = []
    for path in _markdown_files(root):
        rel = path.relative_to(root).as_posix()
        for line in path.read_text(encoding="utf-8").split("\n"):
            m = _TASK.match(line)
            if not m or "⭐" in line:
                continue
            body = m.group(4)
            dates: dict[str, date] = {}
            for emoji, value in _MARK.findall(body):
                parsed = _iso(value)
                if parsed:
                    dates.setdefault(_COLUMN[emoji], parsed)
            if not dates:
                continue
            done_on = _DONE_ON.search(body)
            rows.append(Task(user_id=user_id, text=_label(body), done=m.group(2) != " ", source_path=rel,
                             done_on=_iso(done_on.group(1)) if done_on else None, position=len(rows), **dates))
    return rows


def _goals(root: Path, user_id: int) -> list[Goal]:
    note = root / GOALS_PATH
    content = note.read_text(encoding="utf-8") if note.is_file() else None
    return [Goal(user_id=user_id, position=n, title=g["title"], value=g["value"], caption=g["caption"], progress=g["progress"])
            for n, g in enumerate(parse_goals(content))]


def _quarters(root: Path, user_id: int, report: ImportReport) -> tuple[list[Quarter], list[QuarterStream], dict[str, str]]:
    quarters: list[Quarter] = []
    streams: list[QuarterStream] = []
    contents: dict[str, str] = {}
    for path in _notes(root / "Calendar" / "Quarterly"):
        label = path.stem
        if not _QUARTER.match(label):
            continue
        try:
            content = path.read_text(encoding="utf-8")
            data = parse_quarter(content)
            loaded = load_streams(content)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        contents[label] = content
        quarters.append(Quarter(user_id=user_id, label=label, starts=_iso(data["starts"]), ends=_iso(data["ends"]),
                                objective=data["objective"], objective_ar=data["objective_ar"]))
        in_note = {s["stream"]: s for s in data["streams"]}
        for pos, s in enumerate(loaded):
            sec = in_note.get(s.id)
            streams.append(QuarterStream(
                user_id=user_id, quarter=label, slug=s.id, name=s.name, color=s.color, icon=s.icon, slot=s.slot,
                weekly=s.weekly, has_pipeline=s.goal, in_note=sec is not None, goal=sec["goal"] if sec else "",
                status=s.status, checkpoints=sec["checkpoints"] if sec else [], position=pos))
    return quarters, streams, contents


def _objectives(root: Path, user_id: int, streams, report: ImportReport) -> list[WeekObjective]:
    rows: list[WeekObjective] = []
    for path in _notes(root / "Calendar" / "Weekly" / "Objectives"):
        if not _WEEK.match(path.stem):
            continue
        try:
            items = parse_objectives(path.read_text(encoding="utf-8"), streams)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        rows += [WeekObjective(user_id=user_id, week=path.stem, stream=i["stream"], text=i["text"], done=i["done"],
                               checkpoint=i["checkpoint"])
                 for i in items if i["text"] or i["done"] or i["checkpoint"]]
    return rows


def _pipelines(root: Path, user_id: int, today: date, report: ImportReport) -> list[PipelineItem]:
    rows: list[PipelineItem] = []
    for path in _notes(root / "Efforts" / "Pipeline"):
        if not SLUG.match(path.stem):
            continue
        try:
            items = parse_pipeline(path.read_text(encoding="utf-8"), today)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        rows += [PipelineItem(
            user_id=user_id, stream=path.stem, lane=i["lane"], text=i["text"], description=i["description"],
            product=i["product"], checkpoint=i["checkpoint"], added_on=_iso(i["added"]), done_on=_iso(i["done_on"]),
            focus_week=i["focus"], done=i["done"], blocked_by=i["blocked_by"], position=n) for n, i in enumerate(items)]
    return rows


def _notebooks(root: Path, user_id: int, report: ImportReport) -> list[NotebookEntry]:
    rows: list[NotebookEntry] = []
    for path in _notes(root / "Efforts" / "Streams"):
        if not SLUG.match(path.stem):
            continue
        try:
            entries = parse_notebook(path.read_text(encoding="utf-8"))
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        seen: set[str] = set()
        for n, e in enumerate(entries):
            ext_id = e["id"] if e["id"] and e["id"] not in seen else new_entry_id()
            seen.add(ext_id)
            rows.append(NotebookEntry(user_id=user_id, stream=path.stem, ext_id=ext_id, kind=e["kind"], title=e["title"],
                                      body=e["body"], entry_date=e["date"], is_open=e["open"], position=n))
    return rows


def _schedule(root: Path, user_id: int, report: ImportReport) -> tuple[list[ScheduleSetting], list[ScheduleBlock]]:
    note = root / "Calendar" / "Schedule.md"
    if not note.is_file():
        return [], []
    parsed = parse_schedule(note.read_text(encoding="utf-8"))
    report.errors += [f"Schedule.md: {e}" for e in parsed.errors]
    meta = json.loads(json.dumps(parsed.meta, default=str))
    blocks = [ScheduleBlock(user_id=user_id, day_type=day, block=b.block, start=b.start, end=b.end, what=b.what, position=n)
              for day, listed in parsed.days.items() for n, b in enumerate(listed)]
    return [ScheduleSetting(user_id=user_id, meta=meta)], blocks


async def _wipe(db: AsyncSession, user_id: int) -> None:
    day_ids = select(VaultDay.id).where(VaultDay.user_id == user_id)
    await db.execute(delete(VaultBlockVote).where(VaultBlockVote.vault_day_id.in_(day_ids)))
    await db.execute(delete(VaultDay).where(VaultDay.user_id == user_id))
    for model in USER_TABLES:
        await db.execute(delete(model).where(model.user_id == user_id))


async def import_vault(db: AsyncSession, user_id: int, root: Path, today: date) -> ImportReport:
    report = ImportReport()
    days, logs = _days(root, user_id, report)
    quarters, quarter_streams, contents = _quarters(root, user_id, report)
    # Weekly objective lines are matched to streams by name; use the quarter that holds today, else the newest, else built-ins.
    pick = contents.get(quarter_for(today)) or (contents[max(contents)] if contents else None)
    streams = load_streams(pick) if pick is not None else default_streams()
    settings_rows, schedule_blocks = _schedule(root, user_id, report)
    groups = {
        "days": days, "log_entries": logs, "tasks": _tasks(root, user_id), "goals": _goals(root, user_id),
        "quarters": quarters, "quarter_streams": quarter_streams,
        "objectives": _objectives(root, user_id, streams, report),
        "pipeline_items": _pipelines(root, user_id, today, report),
        "notebook_entries": _notebooks(root, user_id, report),
        "schedule_blocks": schedule_blocks,
    }
    await _wipe(db, user_id)
    for rows in groups.values():
        db.add_all(rows)
    db.add_all(settings_rows)
    await db.commit()
    report.counts = {name: len(rows) for name, rows in groups.items()}
    return report
```

Unused imports: `quarter_path` is not needed; delete it from the import line before running if the linter or `python -W error -c "import app.services.vault_import"` complains.

- [ ] **Step 4: Run to verify it passes**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_vault_import.py -q` -> 3 passed. Then the full suite -> all green.

- [ ] **Step 5: Commit**

```bash
git add app/services/vault_import.py tests/test_vault_import.py
git commit -m "Add the one-way vault importer for a single user"
```

---

### Task 5: Shared response builders

Refactors the vault-backed endpoints so the quarter, objectives, pipelines and notebooks responses are built by pure functions the database path can reuse. No behaviour change.

**Files:**
- Create: `app/services/vault_views.py`
- Modify: `app/api/v1/vault.py`
- Test: existing suite (the refactor is covered by the current endpoint tests); new unit test `tests/test_vault_views.py`

**Interfaces:**
- Produces in `vault_views`: `stream_info(s) -> dict`, `quarter_response(data: dict, label: str, today: date) -> QuarterResponse`, `objectives_response(parsed: list[dict], streams, today) -> ObjectivesResponse`, `pipelines_response(streams, items_by_stream: dict[str, list[dict]], today) -> PipelinesResponse`, `notebooks_response(streams, entries_by_stream) -> NotebooksResponse`. `data` is the dict `parse_quarter` returns.

- [ ] **Step 1: Write the failing test**

Create `tests/test_vault_views.py`:

```python
from datetime import date

from app.services.vault_pipeline import parse_pipeline
from app.services.vault_quarter import load_streams, parse_quarter
from app.services.vault_views import pipelines_response, quarter_response

TODAY = date(2026, 10, 7)
QUARTER = "---\nquarter: 2026-Q4\nstarts: 2026-10-01\nends: 2026-12-31\n---\n# Obj\n> ar\n\n## kahf\n- goal: Ship DNS\n- oct: Router live\n"


def test_quarter_response_from_a_parsed_note():
    res = quarter_response(parse_quarter(QUARTER), "2026-Q4", TODAY)
    assert res.quarter == "2026-Q4" and res.objective == "Obj" and res.streams[0].stream == "kahf"
    assert res.streams[0].checkpoints[0].month == "oct"


def test_pipelines_response_skips_streams_without_a_pipeline():
    streams = load_streams(QUARTER)  # kahf plus the built-in sleep, which has no pipeline
    items = {"kahf": parse_pipeline("## Now\n- [ ] One\n", TODAY)}
    res = pipelines_response(streams, items, TODAY)
    assert [s.stream for s in res.streams] == ["kahf"]
    assert res.streams[0].items[0].text == "One"
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_vault_views.py -q` -> FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Write the builders**

Create `app/services/vault_views.py`:

```python
"""Response builders shared by the vault-file and database read paths, so both return identical shapes."""
from datetime import date, timedelta

from app.schemas.vault import NotebooksResponse, ObjectivesResponse, PipelinesResponse, QuarterResponse
from app.services.vault_notebook import notebook_path
from app.services.vault_objectives import week_for
from app.services.vault_pipeline import NOW_LIMIT, STALE_DAYS, pipeline_path
from app.services.vault_quarter import quarter_months
from app.services.vault_streams import COLORS, ICONS, MONTHS


def stream_info(s) -> dict:
    return {"stream": s.id, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly, "status": s.status}


def quarter_response(data: dict, label: str, today: date) -> QuarterResponse:
    year, number = int(label[:4]), int(label[-1])
    first = date(year, 3 * number - 2, 1)
    try:
        start = date.fromisoformat(data["starts"]) if data["starts"] else first
        end = date.fromisoformat(data["ends"]) if data["ends"] else first + timedelta(days=90)
    except ValueError:
        start, end = first, first + timedelta(days=90)
    streams = [{**stream_info(s["info"]), "goal": s["goal"], "checkpoints": s["checkpoints"]} for s in data["streams"]]
    return QuarterResponse(
        quarter=data["quarter"] or label, starts=start.isoformat(), ends=end.isoformat(),
        objective=data["objective"], objective_ar=data["objective_ar"],
        week_of_quarter=max(1, (today - start).days // 7 + 1), weeks_in_quarter=((end - start).days + 7) // 7,
        current_month=MONTHS[today.month - 1], months=quarter_months(label), colors=list(COLORS), icons=list(ICONS),
        streams=streams,
    )


def objectives_response(parsed: list[dict], streams, today: date) -> ObjectivesResponse:
    start, end, label = week_for(today)
    by_id = {s.id: s for s in streams}
    items = [{**i, "name": by_id[i["stream"]].name, "color": by_id[i["stream"]].color, "icon": by_id[i["stream"]].icon}
             for i in parsed]
    return ObjectivesResponse(week=label, period=f"{start.isoformat()}/{end.isoformat()}", items=items)


def pipelines_response(streams, items_by_stream: dict[str, list[dict]], today: date) -> PipelinesResponse:
    out = [{**stream_info(s), "path": pipeline_path(s.id), "items": items_by_stream.get(s.id, [])}
           for s in streams if s.goal and not s.archived]
    return PipelinesResponse(week=week_for(today)[2], now_limit=NOW_LIMIT, stale_days=STALE_DAYS, streams=out)


def notebooks_response(streams, entries_by_stream: dict[str, list[dict]]) -> NotebooksResponse:
    out = [{**stream_info(s), "path": notebook_path(s.id), "entries": entries_by_stream.get(s.id, [])}
           for s in streams if s.goal and not s.archived]
    return NotebooksResponse(streams=out)
```

- [ ] **Step 4: Point `vault.py` at the builders**

In `app/api/v1/vault.py`:

1. Add `from app.services.vault_views import notebooks_response, objectives_response, pipelines_response, quarter_response, stream_info`.
2. Delete the `_info` function and replace any remaining `_info(` with `stream_info(`.
3. Replace `_objectives_response`:

```python
def _objectives_response(today: date) -> ObjectivesResponse:
    streams = _streams(today)
    parsed = parse_objectives(_read(objectives_path(week_for(today)[2])), streams)
    return objectives_response(parsed, streams, today)
```

4. Replace `_quarter_response`:

```python
def _quarter_response(today: date) -> QuarterResponse:
    label = quarter_for(today)
    content = _read(quarter_path(label))
    if content is None:
        raise HTTPException(status_code=404, detail=f"{quarter_path(label)} is not in the synced vault yet")
    return quarter_response(parse_quarter(content), label, today)
```

5. Replace `_pipelines_response`:

```python
def _pipelines_response(today: date) -> PipelinesResponse:
    streams = _streams(today)
    items = {s.id: parse_pipeline(_read(pipeline_path(s.id)), today) for s in streams if s.goal and not s.archived}
    return pipelines_response(streams, items, today)
```

6. Replace `_notebooks_response`:

```python
def _notebooks_response(today: date) -> NotebooksResponse:
    streams = _streams(today)
    entries = {s.id: parse_notebook(_read(notebook_path(s.id))) for s in streams if s.goal and not s.archived}
    return notebooks_response(streams, entries)
```

Remove imports that became unused (`quarter_months`, `COLORS`, `ICONS`, `MONTHS` if nothing else in the file uses them; check with a search before deleting).

- [ ] **Step 5: Run the full suite**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest -q` -> all green (166 expected). The refactor must change no existing result.

- [ ] **Step 6: Commit**

```bash
git add app/services/vault_views.py app/api/v1/vault.py tests/test_vault_views.py
git commit -m "Extract shared response builders from the vault read endpoints"
```

---

### Task 6: Database reads

**Files:**
- Create: `app/services/planner_store.py`
- Modify: `app/api/v1/vault.py`
- Test: `tests/test_db_reads.py` (parity and isolation, written first)

**Interfaces:**
- Consumes: `vault_views` builders (Task 5), models (Task 2), `import_vault` (Task 4), `build_vault` (Task 3).
- Produces in `planner_store`, all `async`, all taking `(db, user_id, ...)`: `streams_for(db, user_id, today) -> list[Stream]`, `day_tasks(db, user_id, day: date) -> list[dict]`, `day_log(db, user_id, day) -> list[dict]`, `goals(db, user_id) -> list[dict]`, `quarter_data(db, user_id, label) -> dict | None`, `week_objectives(db, user_id, label, streams) -> list[dict]`, `pipeline_items(db, user_id, today) -> dict[str, list[dict]]`, `notebook_entries(db, user_id) -> dict[str, list[dict]]`, `schedule(db, user_id) -> dict | None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_db_reads.py`:

```python
import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.core.config import settings
from app.models.user import User
from app.services.vault_import import import_vault
from tests.conftest import TestSession
from tests.vault_fixture import build_vault


def _strip(obj):
    """Drop fields that legitimately differ: line numbers become row ids and hashes are empty in db mode."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in ("line", "hash")}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


def _endpoints(today):
    d = today.isoformat()
    return [f"/api/v1/vault/day/{d}/tasks", f"/api/v1/vault/day/{d}/log", "/api/v1/vault/goals", "/api/v1/vault/objectives",
            "/api/v1/vault/quarter", "/api/v1/vault/pipelines", "/api/v1/vault/notebooks", "/api/v1/vault/schedule"]


async def _get(client, url, headers=None):
    resp = await client.get(url, headers=headers or {})
    assert resp.status_code == 200, (url, resp.status_code, resp.text)
    return resp.json()


@pytest.mark.asyncio
async def test_db_reads_match_vault_reads(auth_client: AsyncClient, tmp_path, monkeypatch):
    today = _local_now().date()
    build_vault(tmp_path, today)
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    expected = {url: _strip(await _get(auth_client, url)) for url in _endpoints(today)}

    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        report = await import_vault(db, user_id, tmp_path, today)
        assert report.errors == []

    monkeypatch.setattr(settings, "storage_backend", "db")
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "gone"))  # prove nothing reads the checkout
    for url in _endpoints(today):
        assert _strip(await _get(auth_client, url)) == expected[url], url


@pytest.mark.asyncio
async def test_db_day_endpoints_return_the_imported_votes(auth_client: AsyncClient, tmp_path, monkeypatch):
    today = _local_now().date()
    build_vault(tmp_path, today)
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, user_id, tmp_path, today)
    monkeypatch.setattr(settings, "storage_backend", "db")
    day = await _get(auth_client, "/api/v1/vault/today")
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1} and day["total"] == 3
    week = await _get(auth_client, "/api/v1/vault/week")
    assert len(week["days"]) == 2 and week["totals"] == {"soul": 4, "body": 2}
    streaks = await _get(auth_client, "/api/v1/vault/streaks")
    assert streaks["streaks"]["soul"] == {"current": 2, "longest": 2}


@pytest.mark.asyncio
async def test_a_second_user_sees_none_of_the_first_users_data(auth_client: AsyncClient, tmp_path, monkeypatch):
    today = _local_now().date()
    build_vault(tmp_path, today)
    async with TestSession() as db:
        owner_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, owner_id, tmp_path, today)
    await auth_client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await auth_client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}

    monkeypatch.setattr(settings, "storage_backend", "db")
    d = today.isoformat()
    assert await _get(auth_client, f"/api/v1/vault/day/{d}/tasks", other) == []
    assert (await _get(auth_client, "/api/v1/vault/goals", other))["items"] == []
    assert (await _get(auth_client, "/api/v1/vault/notebooks", other))["streams"][0]["entries"] == []
    assert (await auth_client.get("/api/v1/vault/today", headers=other)).status_code == 404
    assert (await auth_client.get("/api/v1/vault/quarter", headers=other)).status_code == 404
    assert (await auth_client.get("/api/v1/vault/schedule", headers=other)).status_code == 404
    assert len(await _get(auth_client, f"/api/v1/vault/day/{d}/tasks")) == 2  # the owner still has theirs


@pytest.mark.asyncio
async def test_schedule_needs_a_login_in_db_mode(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    assert (await client.get("/api/v1/vault/schedule")).status_code == 401
```

Note on the second user's `notebooks`: with no quarter rows the store falls back to the built-in streams, so the response lists streams with empty `entries`; that is why the test indexes `["streams"][0]`.

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_reads.py -q`
Expected: FAIL (endpoints still read the checkout; `planner_store` missing).

- [ ] **Step 3: Write the store**

Create `app/services/planner_store.py`:

```python
"""Database read path: the data the vault notes hold, for one user, in the dict shapes the vault parsers return.

`line` carries the row id and `hash` is empty; the frontend moves to ids in phase 3.
"""
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, Quarter, QuarterStream, ScheduleBlock, ScheduleSetting, Task,
    WeekObjective,
)
from app.services.vault_goals import MAX_GOALS
from app.services.vault_notebook import _URL
from app.services.vault_objectives import weekly_streams
from app.services.vault_pipeline import STALE_DAYS
from app.services.vault_quarter import quarter_for
from app.services.vault_streams import Stream, default_streams


async def _all(db: AsyncSession, stmt) -> list:
    return list((await db.execute(stmt)).scalars().all())


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def _stream(row: QuarterStream) -> Stream:
    return Stream(id=row.slug, name=row.name, color=row.color, icon=row.icon, slot=row.slot, weekly=row.weekly,
                  goal=row.has_pipeline, status=row.status)


async def streams_for(db: AsyncSession, user_id: int, today: date) -> list[Stream]:
    """The streams of today's quarter; the built-ins stand in until that quarter exists, as with the vault note."""
    rows = await _all(db, select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == quarter_for(today)).order_by(QuarterStream.position))
    return [_stream(r) for r in rows] or default_streams()


async def day_tasks(db: AsyncSession, user_id: int, day: date) -> list[dict]:
    rows = await _all(db, select(Task).where(
        Task.user_id == user_id, or_(Task.due_on == day, Task.scheduled_on == day, Task.start_on == day)).order_by(Task.position))
    return [{"path": r.source_path or "", "line": r.id, "hash": "", "text": r.text, "done": r.done} for r in rows]


async def day_log(db: AsyncSession, user_id: int, day: date) -> list[dict]:
    rows = await _all(db, select(LogEntry).where(LogEntry.user_id == user_id, LogEntry.day == day).order_by(LogEntry.position))
    return [{"index": r.position, "hash": "", "text": r.text} for r in rows]


async def goals(db: AsyncSession, user_id: int) -> list[dict]:
    rows = await _all(db, select(Goal).where(Goal.user_id == user_id).order_by(Goal.position))
    return [{"title": r.title, "value": r.value, "caption": r.caption, "progress": r.progress} for r in rows][:MAX_GOALS]


async def quarter_data(db: AsyncSession, user_id: int, label: str) -> dict | None:
    """What parse_quarter returns for the note, or None when this quarter was never imported or created."""
    quarter = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == label))).scalar_one_or_none()
    if quarter is None:
        return None
    rows = await _all(db, select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label, QuarterStream.in_note.is_(True)).order_by(QuarterStream.position))
    return {
        "quarter": label, "starts": _iso(quarter.starts), "ends": _iso(quarter.ends),
        "objective": quarter.objective, "objective_ar": quarter.objective_ar,
        "streams": [{"stream": r.slug, "info": _stream(r), "goal": r.goal, "status": r.status,
                     "checkpoints": list(r.checkpoints or [])} for r in rows],
    }


async def week_objectives(db: AsyncSession, user_id: int, week: str, streams: list[Stream]) -> list[dict]:
    """One {stream, text, done, checkpoint} per weekly stream, empty where nothing is stored (as parse_objectives does)."""
    stored = {r.stream: r for r in await _all(db, select(WeekObjective).where(
        WeekObjective.user_id == user_id, WeekObjective.week == week))}
    out = []
    for s in weekly_streams(streams):
        r = stored.get(s.id)
        out.append({"stream": s.id, "text": r.text, "done": r.done, "checkpoint": r.checkpoint} if r
                   else {"stream": s.id, "text": "", "done": False, "checkpoint": None})
    return out


async def pipeline_items(db: AsyncSession, user_id: int, today: date) -> dict[str, list[dict]]:
    rows = await _all(db, select(PipelineItem).where(PipelineItem.user_id == user_id).order_by(PipelineItem.position))
    out: dict[str, list[dict]] = {}
    for r in rows:
        age = (today - r.added_on).days if r.added_on else 0
        out.setdefault(r.stream, []).append({
            "product": r.product, "line": r.id, "hash": "", "text": r.text, "lane": r.lane, "checkpoint": r.checkpoint,
            "added": _iso(r.added_on), "done_on": _iso(r.done_on), "focus": r.focus_week, "done": r.done, "age_days": age,
            "description": r.description, "blocked_by": list(r.blocked_by or []),
            "stale": r.lane in ("next", "backlog") and r.checkpoint is None and age >= STALE_DAYS,
        })
    return out


async def notebook_entries(db: AsyncSession, user_id: int) -> dict[str, list[dict]]:
    rows = await _all(db, select(NotebookEntry).where(NotebookEntry.user_id == user_id).order_by(NotebookEntry.position))
    out: dict[str, list[dict]] = {}
    for r in rows:
        url = _URL.search(r.body)
        out.setdefault(r.stream, []).append({
            "line": r.id, "id": r.ext_id, "hash": "", "kind": r.kind, "title": r.title, "date": r.entry_date, "body": r.body,
            "open": r.is_open if r.kind == "blocker" else None, "url": url.group(0) if url else None,
        })
    return out


async def schedule(db: AsyncSession, user_id: int) -> dict | None:
    setting = (await db.execute(select(ScheduleSetting).where(ScheduleSetting.user_id == user_id))).scalar_one_or_none()
    if setting is None:
        return None
    rows = await _all(db, select(ScheduleBlock).where(ScheduleBlock.user_id == user_id).order_by(ScheduleBlock.position))
    days: dict[str, list[dict]] = {}
    for r in rows:
        days.setdefault(r.day_type, []).append({"block": r.block, "start": r.start, "end": r.end, "what": r.what})
    return {"meta": dict(setting.meta), "days": days, "errors": []}
```

- [ ] **Step 4: Dispatch the endpoints**

In `app/api/v1/vault.py` add `from app.services import planner_store` and rewrite these handlers (each keeps its route and `response_model`).

Tasks and log:

```python
@router.get("/day/{day}/tasks", response_model=list[TaskResponse])
async def get_day_tasks(day: date, user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    """Tasks due or scheduled on `day`. Private note text, so signed-in owners only."""
    if _db_mode():
        return await planner_store.day_tasks(db, user.id, day)
    root = Path(settings.vault_workdir)
    return await asyncio.to_thread(lambda: [asdict(t) for t in find_tasks(root, day.isoformat())])


@router.get("/day/{day}/log", response_model=list[LogEntryResponse])
async def get_day_log(day: date, user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    if _db_mode():
        return await planner_store.day_log(db, user.id, day)
    note = Path(settings.vault_workdir) / "Calendar" / "Daily" / f"{day.isoformat()}.md"
    if not note.is_file():
        return []
    return log_entries(await asyncio.to_thread(note.read_text, encoding="utf-8"))
```

Objectives, goals, quarter, pipelines, notebooks:

```python
@router.get("/objectives", response_model=ObjectivesResponse)
async def get_objectives(user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        streams = await planner_store.streams_for(db, user.id, today)
        parsed = await planner_store.week_objectives(db, user.id, week_for(today)[2], streams)
        return objectives_response(parsed, streams, today)
    return await asyncio.to_thread(_objectives_response, today)


@router.get("/goals", response_model=GoalsResponse)
async def get_goals(user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    if _db_mode():
        return GoalsResponse(items=await planner_store.goals(db, user.id))
    return GoalsResponse(items=parse_goals(await asyncio.to_thread(_read, GOALS_PATH)))


@router.get("/quarter", response_model=QuarterResponse)
async def get_quarter(user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        label = quarter_for(today)
        data = await planner_store.quarter_data(db, user.id, label)
        if data is None:
            raise HTTPException(status_code=404, detail=f"No plan for {label} yet")
        return quarter_response(data, label, today)
    return await asyncio.to_thread(_quarter_response, today)


@router.get("/pipelines", response_model=PipelinesResponse)
async def get_pipelines(user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        streams = await planner_store.streams_for(db, user.id, today)
        return pipelines_response(streams, await planner_store.pipeline_items(db, user.id, today), today)
    return await asyncio.to_thread(_pipelines_response, today)


@router.get("/notebooks", response_model=NotebooksResponse)
async def get_notebooks(user: User = Depends(require_reader), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        streams = await planner_store.streams_for(db, user.id, today)
        return notebooks_response(streams, await planner_store.notebook_entries(db, user.id))
    return await asyncio.to_thread(_notebooks_response, today)
```

Schedule (public in vault mode, per user in db mode):

```python
@router.get("/schedule", response_model=VaultScheduleResponse)
async def get_schedule(user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    if _db_mode():
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to see your schedule")
        found = await planner_store.schedule(db, user.id)
        if found is None:
            raise HTTPException(status_code=404, detail="No schedule yet")
        return found
    # Public by design in vault mode: the routine ring is a shareable page. Read-only, no user data.
    note = Path(settings.vault_workdir) / "Calendar" / "Schedule.md"
    if not note.exists():
        raise HTTPException(status_code=404, detail="Calendar/Schedule.md not found in vault checkout")
    parsed = parse_schedule(note.read_text(encoding="utf-8"))
    return VaultScheduleResponse(
        meta=parsed.meta,
        days={name: [asdict(b) for b in blocks] for name, blocks in parsed.days.items()},
        errors=parsed.errors,
    )
```

Day aggregates scoped by owner. Add a helper and thread `user` through the three day readers:

```python
def _owned(stmt, user: User | None):
    """Rows of this user in db mode; the legacy checkout rows (user_id NULL) otherwise."""
    if user is not None and _db_mode():
        return stmt.where(VaultDay.user_id == user.id)
    return stmt.where(VaultDay.user_id.is_(None))


async def _get_day(db: AsyncSession, target_date: date, user: User | None = None) -> VaultDay | None:
    result = await db.execute(_owned(
        select(VaultDay).where(VaultDay.date == target_date).options(selectinload(VaultDay.block_votes)), user))
    return result.scalar_one_or_none()


async def _get_days_range(db: AsyncSession, start: date, end: date, user: User | None = None) -> list[VaultDay]:
    result = await db.execute(_owned(
        select(VaultDay).where(VaultDay.date >= start, VaultDay.date <= end)
        .options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date), user))
    return list(result.scalars().all())
```

Then pass `user` at the call sites in `get_today`, `get_week`, `get_month`, `get_blocks`, and in `get_streaks` replace the query with:

```python
    result = await db.execute(_owned(
        select(VaultDay).options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date.asc()), user))
```

`_save` (vault writes) keeps calling `_get_day(db, day)` with no user, which is the legacy-row path.

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_reads.py -q` -> 4 passed.

If the parity test fails on one endpoint, read the diff it prints: the cause is a field the importer or store does not reproduce. Fix the importer or store; do not weaken `_strip` beyond `line` and `hash`. Two expected, legitimate differences to check first: key order does not matter (dict equality), and the quarter's `quarter` field uses the file stem in db mode, which the fixture keeps equal to the frontmatter.

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest -q` -> everything green.

- [ ] **Step 6: Commit**

```bash
git add app/services/planner_store.py app/api/v1/vault.py tests/test_db_reads.py
git commit -m "Read planner data from the database when STORAGE_BACKEND=db"
```

---

### Task 7: Import command

**Files:**
- Create: `app/cli.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Produces: `python -m app.cli import-vault PATH --user EMAIL --replace`, printing one `table: count` line per table and any errors; exit code 1 on a missing user, a missing path, or a missing `--replace`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_cli.py`:

```python
import pytest
from sqlalchemy import func, select

from app.api.v1.vault import _local_now
from app.cli import run_import
from app.models.planner import Task
from tests.conftest import TestSession
from tests.vault_fixture import build_vault


@pytest.mark.asyncio
async def test_import_command_reports_counts(auth_client, tmp_path, capsys):
    build_vault(tmp_path, _local_now().date())
    code = await run_import(tmp_path, "test@niyyah.app", replace=True, session_factory=TestSession)
    out = capsys.readouterr().out
    assert code == 0 and "tasks: 3" in out and "pipeline_items: 4" in out
    async with TestSession() as db:
        assert (await db.execute(select(func.count()).select_from(Task))).scalar_one() == 3


@pytest.mark.asyncio
async def test_import_command_refuses_without_replace(auth_client, tmp_path, capsys):
    code = await run_import(tmp_path, "test@niyyah.app", replace=False, session_factory=TestSession)
    assert code == 1 and "--replace" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_import_command_rejects_an_unknown_user(auth_client, tmp_path, capsys):
    code = await run_import(tmp_path, "nobody@niyyah.app", replace=True, session_factory=TestSession)
    assert code == 1 and "no user" in capsys.readouterr().err
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_cli.py -q` -> FAIL (`ModuleNotFoundError: app.cli`).

- [ ] **Step 3: Write the command**

Create `app/cli.py`:

```python
"""Admin commands. Usage: python -m app.cli import-vault /path/to/vault --user me@example.com --replace"""
import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.user import User
from app.services.vault_import import import_vault


async def run_import(path: Path, email: str, replace: bool, session_factory=async_session) -> int:
    if not replace:
        print("Importing replaces this user's planner data. Pass --replace to confirm.", file=sys.stderr)
        return 1
    if not path.is_dir():
        print(f"{path} is not a directory", file=sys.stderr)
        return 1
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none()
        if user is None:
            print(f"no user with email {email}", file=sys.stderr)
            return 1
        today = datetime.now(ZoneInfo(settings.vault_tz)).date()
        report = await import_vault(db, user.id, path, today)
    for table, count in report.counts.items():
        print(f"{table}: {count}")
    for error in report.errors:
        print(f"warning: {error}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import-vault", help="copy a vault checkout into the database for one user")
    imp.add_argument("path", type=Path)
    imp.add_argument("--user", required=True, help="email of the account that will own the data")
    imp.add_argument("--replace", action="store_true", help="confirm that the user's existing planner data is replaced")
    args = parser.parse_args(argv)
    return asyncio.run(run_import(args.path, args.user, args.replace))


if __name__ == "__main__":
    raise SystemExit(main())
```

Emails are stored as given at registration; if registration lowercases them, `email.lower()` is right. Check `app/api/v1/auth.py`; if it does not lowercase, drop the `.lower()`.

- [ ] **Step 4: Run to verify it passes, then the full suite**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_cli.py -q` -> 3 passed; full suite green.

- [ ] **Step 5: Commit**

```bash
git add app/cli.py tests/test_cli.py
git commit -m "Add the import-vault command"
```

---

### Task 8: Real-data parity check (manual, no code)

The fixture proves the mechanism; this proves it on the owner's real vault before anything switches.

- [ ] **Step 1:** Clone the vault read-only to a scratch path: `git clone ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git /tmp/xarvis-parity` (use `GIT_SSH_COMMAND="ssh -o IdentityAgent=none -o BatchMode=yes"`).
- [ ] **Step 2:** Start the API locally against a scratch SQLite or Postgres database with `VAULT_WORKDIR=/tmp/xarvis-parity`, `VAULT_WRITE_EMAILS=<owner email>`, register the owner, then run `python -m app.cli import-vault /tmp/xarvis-parity --user <owner email> --replace`.
- [ ] **Step 3:** For each URL in `_endpoints()` of `tests/test_db_reads.py`, fetch it with `STORAGE_BACKEND=vault`, then again with `STORAGE_BACKEND=db` (and `VAULT_WORKDIR` pointing at an empty directory), and diff the JSON after removing `line` and `hash`. Save both outputs under the scratchpad and diff them with `diff <(jq -S . a.json) <(jq -S . b.json)`.
- [ ] **Step 4:** Record the outcome in `WORK_LOG.md` of the burak repo: counts imported, endpoints compared, every difference and its cause. Fix any real mismatch in the importer or store with a regression test in `tests/vault_fixture.py` first.

Do not deploy `STORAGE_BACKEND=db` anywhere. Production stays on `vault` until phase 5.

---

### Task 9: Spec amendments and wrap-up

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-db-storage-design.md`

- [ ] **Step 1:** Add an "Amendments" section to the spec listing the three amendments at the top of this plan, and mark phases 1 and 2 "built, parity checked on fixture; real-data check recorded in WORK_LOG".
- [ ] **Step 2:** Run `/tmp/niyyah-oss-venv/bin/python -m pytest -q` one last time; expect all green (about 175 tests).
- [ ] **Step 3:** Commit: `git add docs && git commit -m "Record what phases 1 and 2 changed from the spec"`.
- [ ] **Step 4:** Ask the owner before pushing. A push to `main` deploys; with `STORAGE_BACKEND` unset the deployed behaviour is unchanged, and the new migration runs on deploy only if the pipeline runs `alembic upgrade head` (check `.gitlab-ci.yml` and the API Dockerfile first, and take a database backup before the first deploy that carries it).

---

## Self-review against the spec

- Data model: all tables exist except `blocks` (deferred to phase 4, stated in the amendments). `days`/`block_votes` gain `user_id`. Covered by Tasks 2 and 4.
- API and auth: `require_editor` replaced for reads by `require_reader`; writes answer 501 in db mode; schedule needs a login in db mode. Sync endpoints are untouched here and removed in phase 5.
- Import: `import_vault` and the command (Tasks 4, 7). Export is phase 5.
- Testing from the spec: parity (Task 6, Task 8), isolation (Task 6), import twice (Task 4).
- Not in this plan by design: writes, config editors, onboarding seed, cutover, hardening (phases 3 to 6).
- Type check: `import_vault(db, user_id, root, today)`, `planner_store.*(db, user_id, ...)`, `vault_views.*` and `require_reader` are referenced with the same names and signatures everywhere above.
