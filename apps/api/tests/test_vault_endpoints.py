from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.vault import VaultBlockVote, VaultDay
from tests.conftest import TestSession


@pytest_asyncio.fixture
async def seed_day():
    async def _seed(d: date, mode: str = "full", possible: int = 21, blocks: dict[str, int] | None = None):
        blocks = blocks or {}
        async with TestSession() as session:
            day = VaultDay(date=d, mode=mode, possible=possible, total=sum(blocks.values()))
            session.add(day)
            await session.flush()
            for block, stars in blocks.items():
                session.add(VaultBlockVote(vault_day_id=day.id, block=block, stars=stars))
            await session.commit()
    return _seed


@pytest.mark.asyncio
async def test_today_returns_404_when_no_data(auth_client: AsyncClient):
    resp = await auth_client.get("/api/v1/vault/today")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_today_returns_synced_day(auth_client: AsyncClient, seed_day):
    await seed_day(date.today(), mode="full", possible=21, blocks={"soul": 2, "body": 3})
    resp = await auth_client.get("/api/v1/vault/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["pct"] == round(100 * 5 / 21)
    assert body["blocks"]["soul"] == 2


@pytest.mark.asyncio
async def test_week_aggregates_totals(auth_client: AsyncClient, seed_day):
    today = date.today()
    await seed_day(today, blocks={"soul": 3})
    await seed_day(today - timedelta(days=1), blocks={"soul": 1})
    resp = await auth_client.get("/api/v1/vault/week")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["days"]) == 2
    assert body["totals"]["soul"] == 4
    assert body["week_total"] == 4


@pytest.mark.asyncio
async def test_month_filters_and_computes_mode_distribution(auth_client: AsyncClient, seed_day):
    month_str = date.today().strftime("%Y-%m")
    await seed_day(date.today(), mode="full", blocks={"soul": 3})
    resp = await auth_client.get(f"/api/v1/vault/month?month={month_str}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["modes"]["full"] == 1


@pytest.mark.asyncio
async def test_streaks_resets_on_zero_and_ignores_absent_blocks(auth_client: AsyncClient, seed_day):
    today = date.today()
    await seed_day(today - timedelta(days=2), blocks={"soul": 2})
    await seed_day(today - timedelta(days=1), blocks={"soul": 0})
    await seed_day(today, blocks={"soul": 1})
    resp = await auth_client.get("/api/v1/vault/streaks")
    assert resp.status_code == 200
    streaks = resp.json()["streaks"]
    assert streaks["soul"]["current"] == 1
    assert streaks["soul"]["longest"] == 1


@pytest.mark.asyncio
async def test_streaks_ignore_days_where_block_is_entirely_absent(auth_client: AsyncClient, seed_day):
    today = date.today()
    await seed_day(today - timedelta(days=2), blocks={"soul": 2})
    await seed_day(today - timedelta(days=1))  # no vote for "soul" at all this day (absent, not zero)
    await seed_day(today, blocks={"soul": 3})
    resp = await auth_client.get("/api/v1/vault/streaks")
    assert resp.status_code == 200
    streaks = resp.json()["streaks"]
    assert streaks["soul"]["current"] == 2  # absent day didn't break the streak
    assert streaks["soul"]["longest"] == 2


@pytest.mark.asyncio
async def test_blocks_returns_date_aligned_series_and_averages(auth_client: AsyncClient, seed_day):
    today = date.today()
    # "soul" is present on both days; "body" only on the earlier day, so its
    # array must still be `days`-long with a None for the day it's absent —
    # not a shorter array — and its average must only count the present value.
    await seed_day(today - timedelta(days=1), blocks={"soul": 1, "body": 2})
    await seed_day(today, blocks={"soul": 3})
    resp = await auth_client.get("/api/v1/vault/blocks?days=7")
    assert resp.status_code == 200
    body = resp.json()
    assert body["range"] == 7

    soul_series = body["blocks"]["soul"]
    body_series = body["blocks"]["body"]
    assert len(soul_series) == 7
    assert len(body_series) == 7  # same length as "soul", even though absent on 6 of 7 days
    assert soul_series[-2:] == [1, 3]  # the two seeded days, in date order
    assert body_series[-2:] == [2, None]  # present on day -1, absent (None) on today

    assert body["averages"]["soul"] == 2.0
    assert body["averages"]["body"] == 2.0  # average of the single present value, not skewed by Nones
