import pytest
from httpx import AsyncClient

from app.core.config import settings


@pytest.mark.asyncio
async def test_vault_mode_still_blocks_readers_who_are_not_allow_listed(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "")
    monkeypatch.setattr(settings, "storage_backend", "vault")
    resp = await auth_client.get("/api/v1/vault/goals")
    assert resp.status_code == 403
