"""Helpers for the suggestion tests: a second account with the same data, whole-account row dumps, bundle shortcuts."""
from datetime import datetime, time as clock

from sqlalchemy import select

from app.core.database import Base
from app.models.user import User
from app.schemas.snapshot import Snapshot
from app.services import suggestions
from app.services.planner_import import import_snapshot
from tests.conftest import TestSession
from tests.sample_snapshot import sample_snapshot

V = "/api/v1/vault"
# Tables a suggestion can write, and how to find one user's rows in each.
TABLES = ("planner_tasks", "planner_quarters", "planner_quarter_streams", "compass", "vault_days", "vault_block_votes",
          "planner_log_entries")
VOLATILE = {"id", "user_id", "vault_day_id", "updated_at", "created_at", "synced_at"}


async def user_ids() -> list[int]:
    async with TestSession() as db:
        return list((await db.execute(select(User.id).order_by(User.id))).scalars().all())


async def second_account(client, today):
    """A second user with the same sample account; returns (auth headers, user id)."""
    await client.post("/api/v1/auth/register", json={"email": "b@niyyah.app", "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "b@niyyah.app", "password": "otherpass123"})).json()["access_token"]
    async with TestSession() as db:
        uid = (await db.execute(select(User.id).where(User.email == "b@niyyah.app"))).scalar_one()
        await import_snapshot(db, uid, Snapshot.model_validate(sample_snapshot(today)))
        await db.commit()
    return {"Authorization": f"Bearer {token}"}, uid


async def dump(uid: int, *, keep_ids: bool = False) -> dict[str, list[dict]]:
    """Every row the user has in the tables a suggestion can write. Without ids: comparable between two accounts."""
    out = {}
    async with TestSession() as db:
        days = [d for d in (await db.execute(Base.metadata.tables["vault_days"].select().where(
            Base.metadata.tables["vault_days"].c.user_id == uid))).mappings().all()]
        day_ids = {d["id"] for d in days}
        for name in TABLES:
            table = Base.metadata.tables[name]
            if name == "vault_block_votes":
                query = table.select().where(table.c.vault_day_id.in_(day_ids or {0}))
            else:
                query = table.select().where(table.c.user_id == uid)
            rows = [dict(r) for r in (await db.execute(query.order_by(table.c.id))).mappings().all()]
            if not keep_ids:
                names = {r["id"]: r["text"] for r in rows} if name == "planner_tasks" else {}
                for r in rows:  # the parent by content: ids differ between accounts
                    if name == "planner_tasks":
                        r["parent_id"] = names.get(r["parent_id"])
                rows = [{k: v for k, v in r.items() if k not in VOLATILE} for r in rows]
                rows.sort(key=repr)
            else:
                rows = [{k: v for k, v in r.items() if k != "synced_at"} for r in rows]
            out[name] = rows
    return out


async def task_ids(uid: int) -> dict[str, int]:
    from app.models.planner import Task

    async with TestSession() as db:
        rows = (await db.execute(select(Task.text, Task.id).where(Task.user_id == uid).order_by(Task.id))).all()
    return {text: pk for text, pk in rows}


async def make(uid: int, lines: list[dict], *, source: str = "demo", title: str = "A suggestion", today, checks=()):
    async with TestSession() as db:
        bundle = await suggestions.create(db, uid, source, title, "Because it helps", lines, today=today, checks=checks)
        await db.commit()
        return bundle.id


async def apply(uid: int, bundle_id: int, today, lines=None, **kw):
    async with TestSession() as db:
        return await suggestions.apply(db, uid, bundle_id, lines, today=today, **kw)


async def undo(uid: int, bundle_id: int, **kw):
    async with TestSession() as db:
        return await suggestions.undo(db, uid, bundle_id, **kw)


async def read(uid: int, bundle_id: int):
    async with TestSession() as db:
        return await suggestions.get(db, uid, bundle_id)


def fixed_clock(monkeypatch, today, hour=9, minute=15):
    """The planner routes read the time from vault._local_now: pin it so a note's clock is the same by hand and by suggestion."""
    from app.api.v1 import vault

    monkeypatch.setattr(vault, "_local_now", lambda: datetime.combine(today, clock(hour, minute)))
