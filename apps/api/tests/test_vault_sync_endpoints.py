import pytest
from httpx import AsyncClient

from app.core.config import settings
from tests.test_vault_sync import DAY_1, _make_repo


@pytest.mark.asyncio
async def test_manual_sync_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/vault/sync")
    assert resp.status_code == 401  # HTTPBearer with no credentials


@pytest.mark.asyncio
async def test_manual_sync_triggers_sync(auth_client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))

    resp = await auth_client.post("/api/v1/vault/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["synced_days"] == 1
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_webhook_rejects_wrong_secret(client: AsyncClient):
    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Vault-Sync-Secret": "wrong-secret"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_accepts_correct_secret(client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))

    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Vault-Sync-Secret": settings.vault_sync_secret},
    )
    assert resp.status_code == 200
    assert resp.json()["synced_days"] == 1
