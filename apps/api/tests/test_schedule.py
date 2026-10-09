import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_schedule_block(auth_client: AsyncClient):
    # First create a persona
    p = await auth_client.post("/api/v1/personas", json={"name": "Siddiq", "domain": "Practice"})
    pid = p.json()["id"]

    resp = await auth_client.post("/api/v1/schedule", json={
        "persona_id": pid,
        "start_time": "05:00",
        "end_time": "06:30",
        "activity": "Fajr + Quran",
    })
    assert resp.status_code == 201
    assert resp.json()["activity"] == "Fajr + Quran"


@pytest.mark.asyncio
async def test_list_schedule(auth_client: AsyncClient):
    p = await auth_client.post("/api/v1/personas", json={"name": "S", "domain": "D"})
    pid = p.json()["id"]
    await auth_client.post("/api/v1/schedule", json={"persona_id": pid, "start_time": "08:00", "end_time": "12:00", "activity": "Work"})
    resp = await auth_client.get("/api/v1/schedule")
    assert resp.status_code == 200
    assert len(resp.json()) >= 1


@pytest.mark.asyncio
async def test_delete_schedule_block(auth_client: AsyncClient):
    p = await auth_client.post("/api/v1/personas", json={"name": "S", "domain": "D"})
    pid = p.json()["id"]
    create = await auth_client.post("/api/v1/schedule", json={"persona_id": pid, "start_time": "20:00", "end_time": "22:00", "activity": "Read"})
    bid = create.json()["id"]
    resp = await auth_client.delete(f"/api/v1/schedule/{bid}")
    assert resp.status_code == 204
