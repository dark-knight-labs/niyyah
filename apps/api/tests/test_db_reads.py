import pytest
from httpx import AsyncClient

V = "/api/v1/vault"


async def _get(client, url, headers=None):
    resp = await client.get(url, headers=headers or {})
    assert resp.status_code == 200, (url, resp.status_code, resp.text)
    return resp.json()


async def _second_user(client):
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_day_endpoints_return_the_loaded_votes(db_client):
    client, today = db_client
    day = await _get(client, f"{V}/today")
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0} and day["total"] == 3
    week = await _get(client, f"{V}/week")
    assert len(week["days"]) == 2 and week["totals"] == {"soul": 4, "body": 2, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}
    streaks = await _get(client, f"{V}/streaks")
    assert streaks["streaks"]["soul"] == {"current": 2, "longest": 2}


@pytest.mark.asyncio
async def test_the_pages_read_what_was_loaded(db_client):
    client, today = db_client
    d = today.isoformat()
    tasks = await _get(client, f"{V}/day/{d}/tasks")
    assert sorted(t["text"] for t in tasks) == ["Pay invoice", "Renew domain"]
    assert [g["title"] for g in (await _get(client, f"{V}/goals"))["items"]] == ["Zero debt", "Life simple"]
    pipelines = await _get(client, f"{V}/pipelines")
    assert [s["stream"] for s in pipelines["streams"]] == ["studio", "shop"]
    assert [i["text"] for i in pipelines["streams"][0]["items"]][:1] == ["Wire the router"]
    assert (await _get(client, f"{V}/quarter"))["objective"] == "Allah SWT's satisfaction"
    assert [e["title"] for e in (await _get(client, f"{V}/notebooks"))["streams"][0]["entries"]] == ["Passkeys", "Waiting on legal"]
    assert (await _get(client, f"{V}/schedule"))["meta"]["weekend_days"] == ["fri", "sat"]


@pytest.mark.asyncio
async def test_a_second_user_sees_none_of_the_first_users_data(db_client):
    client, today = db_client
    other = await _second_user(client)
    d = today.isoformat()
    assert await _get(client, f"{V}/day/{d}/tasks", other) == []
    assert (await _get(client, f"{V}/goals", other))["items"] == []
    assert (await _get(client, f"{V}/notebooks", other))["streams"] == []
    assert (await client.get(f"{V}/today", headers=other)).status_code == 404
    assert (await _get(client, f"{V}/quarter", other))["streams"] == []
    assert (await _get(client, f"{V}/schedule", other))["meta"]["city"] is None  # their own starter schedule, not Dhaka
    assert len(await _get(client, f"{V}/day/{d}/tasks")) == 2  # the first user still has theirs


@pytest.mark.asyncio
async def test_schedule_needs_a_login(client: AsyncClient):
    assert (await client.get(f"{V}/schedule")).status_code == 401


@pytest.mark.asyncio
async def test_status_counts_only_the_callers_days(db_client):
    client, _ = db_client
    other = await _second_user(client)
    assert (await _get(client, f"{V}/status"))["days"] == 2
    assert (await _get(client, f"{V}/status", other))["days"] == 0
