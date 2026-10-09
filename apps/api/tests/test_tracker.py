import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_non_negotiable(auth_client: AsyncClient):
    resp = await auth_client.post("/api/v1/tracker/non-negotiables", json={
        "title": "Five Daily Prayers",
        "category": "spiritual",
    })
    assert resp.status_code == 201
    assert resp.json()["title"] == "Five Daily Prayers"


@pytest.mark.asyncio
async def test_check_item(auth_client: AsyncClient):
    create = await auth_client.post("/api/v1/tracker/non-negotiables", json={"title": "Tahajjud"})
    nn_id = create.json()["id"]
    resp = await auth_client.post("/api/v1/tracker/check", json={"non_negotiable_id": nn_id})
    assert resp.status_code == 201
    assert resp.json()["is_completed"] is True


@pytest.mark.asyncio
async def test_duplicate_check(auth_client: AsyncClient):
    create = await auth_client.post("/api/v1/tracker/non-negotiables", json={"title": "Adhkar"})
    nn_id = create.json()["id"]
    await auth_client.post("/api/v1/tracker/check", json={"non_negotiable_id": nn_id})
    resp = await auth_client.post("/api/v1/tracker/check", json={"non_negotiable_id": nn_id})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_today_endpoint(auth_client: AsyncClient):
    await auth_client.post("/api/v1/tracker/non-negotiables", json={"title": "Quran"})
    resp = await auth_client.get("/api/v1/tracker/today")
    assert resp.status_code == 200
    assert "non_negotiables" in resp.json()


@pytest.mark.asyncio
async def test_streak_increments(auth_client: AsyncClient):
    from datetime import date, timedelta
    create = await auth_client.post("/api/v1/tracker/non-negotiables", json={"title": "Istighfar"})
    nn_id = create.json()["id"]

    yesterday = (date.today() - timedelta(days=1)).isoformat()
    today = date.today().isoformat()

    await auth_client.post("/api/v1/tracker/check", json={"non_negotiable_id": nn_id, "check_date": yesterday})
    await auth_client.post("/api/v1/tracker/check", json={"non_negotiable_id": nn_id, "check_date": today})

    resp = await auth_client.get("/api/v1/tracker/non-negotiables")
    nns = resp.json()
    target = next(n for n in nns if n["id"] == nn_id)
    assert target["streak"]["current_streak"] == 2
