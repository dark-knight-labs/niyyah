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
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0} and day["total"] == 3
    week = await _get(auth_client, "/api/v1/vault/week")
    assert len(week["days"]) == 2 and week["totals"] == {"soul": 4, "body": 2, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}
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
    assert (await _get(auth_client, "/api/v1/vault/notebooks", other))["streams"] == []
    assert (await auth_client.get("/api/v1/vault/today", headers=other)).status_code == 404
    assert (await _get(auth_client, "/api/v1/vault/quarter", other))["streams"] == []
    assert (await auth_client.get("/api/v1/vault/schedule", headers=other)).status_code == 404
    assert len(await _get(auth_client, f"/api/v1/vault/day/{d}/tasks")) == 2  # the owner still has theirs


@pytest.mark.asyncio
async def test_schedule_needs_a_login_in_db_mode(client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    assert (await client.get("/api/v1/vault/schedule")).status_code == 401


@pytest.mark.asyncio
async def test_sync_status_counts_only_the_callers_days(auth_client: AsyncClient, tmp_path, monkeypatch):
    today = _local_now().date()
    build_vault(tmp_path, today)
    async with TestSession() as db:
        owner_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, owner_id, tmp_path, today)
    await auth_client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await auth_client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    monkeypatch.setattr(settings, "storage_backend", "db")
    assert (await _get(auth_client, "/api/v1/vault/sync/status"))["days"] == 2
    assert (await _get(auth_client, "/api/v1/vault/sync/status", other))["days"] == 0
    assert (await _get(auth_client, "/api/v1/vault/sync/status"))["storage"] == "db"
    assert (await auth_client.post("/api/v1/vault/sync", json={})).status_code == 409
