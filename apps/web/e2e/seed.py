"""Seed a fresh SQLite dev database for the browser run: the schema (create_all, like the API tests' conftest), one user
and the sample account (apps/api/tests/sample_snapshot.py: schedule, quarter, streams, tasks...).

Run from apps/api with its venv and the same env as the API: DATABASE_URL, APP_ENV=development, STORAGE_BACKEND=db.
Usage: python ../web/e2e/seed.py <email> <password>
"""
import asyncio
import sys

from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine

from app.api.v1.vault import _local_now
from app.core.config import settings
from app.core.database import Base, async_session
from app.main import app
from app.models.user import User
from app.schemas.snapshot import Snapshot
from app.services.planner_import import import_snapshot
from tests.sample_snapshot import sample_snapshot


async def main(email: str, password: str) -> None:
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://seed") as client:
        res = await client.post("/api/v1/auth/register", json={"email": email, "password": password, "timezone": "Asia/Dhaka"})
        assert res.status_code in (200, 201), res.text
    async with async_session() as db:
        user_id = (await db.execute(select(User.id).where(User.email == email))).scalar_one()
        await import_snapshot(db, user_id, Snapshot.model_validate(sample_snapshot(_local_now().date())))
        await db.commit()
    print(f"seeded {email} (user {user_id}) for {_local_now().date()}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2]))
