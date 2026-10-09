import os

os.environ.setdefault("APP_ENV", "development")  # tests use the default placeholder secrets

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite+aiosqlite:///./test.db"

engine = create_async_engine(TEST_DB_URL, echo=False)
TestSession = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def fresh_rate_limits():
    from app.core import ratelimit
    ratelimit.reset()
    yield


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with TestSession() as session:
        yield session


app.dependency_overrides[get_db] = override_get_db


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def auth_client(client: AsyncClient) -> AsyncClient:
    await client.post("/api/v1/auth/register", json={
        "email": "test@niyyah.app",
        "password": "testpass123",
    })
    resp = await client.post("/api/v1/auth/login", json={
        "email": "test@niyyah.app",
        "password": "testpass123",
    })
    token = resp.json()["access_token"]
    client.headers["Authorization"] = f"Bearer {token}"
    return client


@pytest_asyncio.fixture
async def db_client(auth_client: AsyncClient):
    """The logged-in user with the sample account (tests/sample_snapshot.py) loaded into their rows."""
    from sqlalchemy import select

    from app.api.v1.vault import _local_now
    from app.models.user import User
    from app.schemas.snapshot import Snapshot
    from app.services.planner_import import import_snapshot
    from tests.sample_snapshot import sample_snapshot

    today = _local_now().date()
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        await import_snapshot(db, user_id, Snapshot.model_validate(sample_snapshot(today)))
        await db.commit()
    return auth_client, today
