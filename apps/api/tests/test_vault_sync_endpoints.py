import logging

import pytest
from httpx import AsyncClient

from app.core import database
from app.core.config import settings
from app.models.vault import VaultDay
from tests.conftest import TestSession
from tests.test_vault_sync import BROKEN_FRONTMATTER, DAY_1, _make_repo


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
async def test_webhook_rejects_non_ascii_secret(client: AsyncClient):
    # secrets.compare_digest raises TypeError on non-ASCII str operands. A
    # request with a non-ASCII header value must still get a clean 401, not
    # an unhandled 500.
    # httpx's Headers coerces str values with strict ascii encoding, so the
    # non-ASCII byte has to be handed in as raw bytes to reach the server at
    # all (a real GitLab webhook would send this as a raw header byte too).
    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Gitlab-Token": "café".encode("utf-8")},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_rejects_missing_header(client: AsyncClient):
    # A required Header(...) param would make FastAPI 422 before the handler's
    # own 401 check ever runs. Both headers are optional now, so a request
    # with neither present must still get a 401, not a validation error.
    resp = await client.post("/api/v1/vault/sync/webhook")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_accepts_correct_secret(client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))
    # The webhook's sync now runs via BackgroundTasks against a fresh session
    # opened from app.core.database.async_session — point that at the test DB
    # (the request-scoped get_db override doesn't cover a background task).
    monkeypatch.setattr(database, "async_session", TestSession)

    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Vault-Sync-Secret": settings.vault_sync_secret},
    )
    assert resp.status_code == 202
    assert resp.json() == {"accepted": True}

    # Starlette awaits BackgroundTasks in-process before the response is
    # handed back, so the synced day is queryable immediately — no poll/sleep.
    async with TestSession() as session:
        rows = (await session.execute(VaultDay.__table__.select())).fetchall()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_webhook_accepts_gitlab_token_header(client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))
    monkeypatch.setattr(database, "async_session", TestSession)

    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Gitlab-Token": settings.vault_sync_secret},
    )
    assert resp.status_code == 202
    assert resp.json() == {"accepted": True}


@pytest.mark.asyncio
async def test_webhook_background_sync_logs_errors_instead_of_discarding_them(
    client: AsyncClient, tmp_path, monkeypatch, caplog
):
    # The webhook's background sync has no caller to return SyncResult.errors
    # to, so per-file errors must at least be logged rather than silently
    # discarded. One good file + one malformed file exercises that path.
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {
        "2026-08-20.md": DAY_1,
        "2026-08-21.md": BROKEN_FRONTMATTER,
    })
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))
    monkeypatch.setattr(database, "async_session", TestSession)

    with caplog.at_level(logging.WARNING, logger="app.api.v1.vault"):
        resp = await client.post(
            "/api/v1/vault/sync/webhook",
            headers={"X-Vault-Sync-Secret": settings.vault_sync_secret},
        )

    assert resp.status_code == 202
    assert resp.json() == {"accepted": True}

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert "2026-08-21.md" in warnings[0].getMessage()
