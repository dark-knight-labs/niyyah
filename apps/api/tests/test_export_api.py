import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models.planner import PlannerCalendarFeed
from app.models.vault import VaultDay
from tests.conftest import TestSession

E = "/api/v1/export"
SECTIONS = ("blocks", "schedule", "feeds", "goals", "quarters", "week_objectives", "pipeline_items", "notebook_entries", "days", "tasks")


async def _token(client) -> str:
    return (await client.post("/api/v1/tokens", json={"name": "mirror"})).json()["token"]


@pytest.mark.asyncio
async def test_snapshot_carries_the_users_data(db_client):
    client, _ = db_client
    await client.put("/api/v1/vault/config/goals", json={"items": [{"title": "Zero debt", "value": "62% paid", "progress": 62}]})
    snap = (await client.get(E)).json()
    assert snap["version"] == 1 and snap["user"] == {"email": "test@niyyah.app", "timezone": "UTC"}
    assert all(key in snap for key in SECTIONS)
    assert snap["goals"] == [{"title": "Zero debt", "value": "62% paid", "caption": "", "checklist": [], "progress": 62}]
    async with TestSession() as db:
        days = (await db.execute(select(func.count()).select_from(VaultDay).where(VaultDay.user_id.is_not(None)))).scalar_one()
    assert days > 0 and len(snap["days"]) == days
    day = snap["days"][0]
    assert {"date", "mode", "possible", "total", "focus", "votes", "log"} <= day.keys() and isinstance(day["votes"], dict)
    assert snap["quarters"] and snap["quarters"][0]["streams"]
    assert snap["schedule"]["days"]["weekday"]


@pytest.mark.asyncio
async def test_feed_addresses_never_leave(db_client):
    client, _ = db_client
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=1, name="Family", url="https://cal.example.com/private/SECRETPART.ics", position=0))
        await db.commit()
    res = await client.get(E)
    assert res.json()["feeds"] == [{"name": "Family", "host": "cal.example.com", "color": None, "email": None}]
    assert "SECRETPART" not in res.text


@pytest.mark.asyncio
async def test_etag_answers_304_until_something_changes(db_client):
    client, _ = db_client
    first = await client.get(E)
    tag = first.headers["etag"]
    same = await client.get(E, headers={"If-None-Match": tag})
    assert same.status_code == 304 and same.content == b""
    await client.put("/api/v1/vault/config/goals", json={"items": [{"title": "New", "value": "goal"}]})
    changed = await client.get(E, headers={"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["etag"] != tag


@pytest.mark.asyncio
async def test_a_token_reads_the_export_and_nothing_else(db_client):
    client, _ = db_client
    as_token = {"Authorization": f"Bearer {await _token(client)}"}
    assert (await client.get(E, headers=as_token)).status_code == 200
    for url in ("/api/v1/vault/goals", "/api/v1/vault/today", "/api/v1/auth/me", "/api/v1/tokens"):
        assert (await client.get(url, headers=as_token)).status_code == 401, url
    assert (await client.put("/api/v1/vault/config/goals", json={"items": []}, headers=as_token)).status_code == 401


@pytest.mark.asyncio
async def test_a_revoked_token_stops_working(db_client):
    client, _ = db_client
    made = (await client.post("/api/v1/tokens", json={"name": "mirror"})).json()
    as_token = {"Authorization": f"Bearer {made['token']}"}
    assert (await client.get(E, headers=as_token)).status_code == 200
    await client.delete(f"/api/v1/tokens/{made['id']}")
    assert (await client.get(E, headers=as_token)).status_code == 401
    assert (await client.get(E, headers={"Authorization": "Bearer nyt_" + "x" * 43})).status_code == 401


@pytest.mark.asyncio
async def test_a_token_exports_its_own_user_only(db_client):
    client, _ = db_client
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    raw = (await client.post("/api/v1/tokens", json={"name": "theirs"}, headers=other)).json()["token"]
    snap = (await client.get(E, headers={"Authorization": f"Bearer {raw}"})).json()
    assert snap["user"]["email"] == "o@niyyah.app"
    assert snap["days"] == [] and snap["tasks"] == [] and snap["goals"] == []




@pytest.mark.asyncio
async def test_export_needs_a_login(auth_client):
    assert (await auth_client.get(E)).status_code == 200
    del auth_client.headers["Authorization"]
    assert (await auth_client.get(E)).status_code in (401, 403)
