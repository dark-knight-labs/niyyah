import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_db_mode_refuses_vault_writes(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    monkeypatch.setattr(settings, "storage_backend", "db")
    resp = await auth_client.put("/api/v1/vault/day/2026-10-07/mode", json={"mode": "full"})
    assert resp.status_code == 501
    assert "STORAGE_BACKEND" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_vault_mode_still_blocks_readers_who_are_not_allow_listed(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "")
    monkeypatch.setattr(settings, "storage_backend", "vault")
    resp = await auth_client.get("/api/v1/vault/goals")
    assert resp.status_code == 403
