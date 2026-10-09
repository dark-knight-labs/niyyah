import pytest

from app.core.config import settings


@pytest.mark.asyncio
async def test_imported_vault_exports_in_db_mode(db_client):
    client, today = db_client
    snap = (await client.get("/api/v1/export")).json()
    assert snap["days"] and snap["quarters"] and snap["schedule"]
    assert any(day["date"] == today.isoformat() for day in snap["days"])
    today_api = (await client.get("/api/v1/vault/today")).json()
    exported = next(d for d in snap["days"] if d["date"] == today.isoformat())
    assert exported["mode"] == today_api["mode"] and exported["total"] == today_api["total"]


@pytest.mark.asyncio
async def test_rolling_back_to_vault_mode_stops_the_export(db_client, monkeypatch):
    client, _ = db_client
    monkeypatch.setattr(settings, "storage_backend", "vault")
    assert (await client.get("/api/v1/export")).status_code == 409
