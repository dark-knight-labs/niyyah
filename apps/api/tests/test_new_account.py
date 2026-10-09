import pytest

from app.core.config import settings
from app.services.planner_defaults import STARTER_BLOCKS

V = "/api/v1/vault"


@pytest.mark.asyncio
async def test_registration_in_db_mode_seeds_the_starter(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    await client.post("/api/v1/auth/register", json={"email": "new@niyyah.app", "password": "newpass1234"})
    token = (await client.post("/api/v1/auth/login", json={"email": "new@niyyah.app", "password": "newpass1234"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    blocks = (await client.get(f"{V}/config/blocks", headers=h)).json()["blocks"]
    assert [b["key"] for b in blocks] == [b["key"] for b in STARTER_BLOCKS]
    sched = (await client.get(f"{V}/schedule", headers=h)).json()
    assert sched["meta"]["lat"] is None and sched["meta"]["weekend_days"] == ["sat", "sun"]
    assert len(sched["days"]["weekday"]) == 7 and len(sched["days"]["weekend"]) == 5


@pytest.mark.asyncio
async def test_a_new_account_can_vote_on_its_own_blocks(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    await client.post("/api/v1/auth/register", json={"email": "new@niyyah.app", "password": "newpass1234"})
    token = (await client.post("/api/v1/auth/login", json={"email": "new@niyyah.app", "password": "newpass1234"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    from app.api.v1.vault import _local_now
    today = _local_now().date()
    res = await client.put(f"{V}/day/{today}/vote", json={"block": "work", "stars": 3}, headers=h)
    assert res.status_code == 200
    day = res.json()["day"]
    assert day["blocks"]["work"] == 3 and set(day["blocks"]) == {"soul", "body", "work", "fnf", "sleep"} and day["possible"] == 15
    assert (await client.put(f"{V}/day/{today}/vote", json={"block": "planning", "stars": 1}, headers=h)).status_code == 422


@pytest.mark.asyncio
async def test_a_new_account_gets_no_streams_of_anyone_elses(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    await client.post("/api/v1/auth/register", json={"email": "new@niyyah.app", "password": "newpass1234"})
    token = (await client.post("/api/v1/auth/login", json={"email": "new@niyyah.app", "password": "newpass1234"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert (await client.get(f"{V}/pipelines", headers=h)).json()["streams"] == []
    assert (await client.get(f"{V}/notebooks", headers=h)).json()["streams"] == []
    assert (await client.get(f"{V}/objectives", headers=h)).json()["items"] == []
    quarter = await client.get(f"{V}/quarter", headers=h)  # created on first look, so the Plan page can open
    assert quarter.status_code == 200 and quarter.json()["streams"] == [] and "Super Objective" in quarter.json()["objective"]
    added = await client.post(f"{V}/quarter/stream", json={"stream": "work", "name": "Work", "goal": "Ship it"}, headers=h)
    assert added.status_code == 200 and [s["stream"] for s in added.json()["streams"]] == ["work"]
    assert [s["stream"] for s in (await client.get(f"{V}/pipelines", headers=h)).json()["streams"]] == ["work"]
