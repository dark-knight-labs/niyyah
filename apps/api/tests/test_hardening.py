import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, check_secrets
from app.core.config import settings as live

GOOD = "x" * 40


def cfg(**kw):
    return Settings(app_env="production", secret_key=GOOD, vault_sync_secret=GOOD, storage_backend="db", **kw)


def test_production_refuses_placeholder_and_short_secrets():
    assert check_secrets(cfg()) == []
    for bad in ["change-me-in-production", "changeme-niyyah-secret-key-generate-secure-random", "short", ""]:
        assert check_secrets(Settings(app_env="production", secret_key=bad, storage_backend="db")), bad


def test_the_vault_secret_only_matters_in_vault_mode():
    assert check_secrets(Settings(app_env="production", secret_key=GOOD, storage_backend="db")) == []
    assert check_secrets(Settings(app_env="production", secret_key=GOOD, storage_backend="vault"))


def test_development_allows_placeholders():
    assert check_secrets(Settings(app_env="development", secret_key="change-me-in-production")) == []


def test_registration_must_be_open_or_closed():
    assert check_secrets(cfg(registration="invite"))


def test_the_app_will_not_start_with_unsafe_secrets(monkeypatch):
    from app.main import app
    monkeypatch.setattr(live, "app_env", "production")
    monkeypatch.setattr(live, "secret_key", "change-me-in-production")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        with TestClient(app):
            pass


@pytest.mark.asyncio
async def test_closed_registration_refuses_new_accounts(client, monkeypatch):
    monkeypatch.setattr(live, "registration", "closed")
    res = await client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "password123"})
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_login_attempts_are_limited_per_email(client):
    await client.post("/api/v1/auth/register", json={"email": "a@example.com", "password": "password123"})
    codes = [(await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "wrong-password"})).status_code
             for _ in range(10)]
    assert codes[:8] == [401] * 8 and codes[8:] == [429, 429]
    blocked = await client.post("/api/v1/auth/login", json={"email": "a@example.com", "password": "password123"})
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0
    other = await client.post("/api/v1/auth/login", json={"email": "b@example.com", "password": "x"})
    assert other.status_code == 401  # another account is not affected


@pytest.mark.asyncio
async def test_registration_is_limited_per_address(client):
    codes = [(await client.post("/api/v1/auth/register", json={"email": f"u{i}@example.com", "password": "password123"})).status_code
             for i in range(12)]
    assert codes[:10] == [201] * 10 and codes[10:] == [429, 429]


@pytest.mark.asyncio
async def test_forwarded_address_is_used_only_when_trusted(client, monkeypatch):
    def attempt(ip):
        return client.post("/api/v1/auth/login", json={"email": f"{ip}@example.com", "password": "x"}, headers={"x-forwarded-for": ip})

    monkeypatch.setattr(live, "trust_forwarded_for", False)
    first = [(await attempt(f"10.0.0.{i}")).status_code for i in range(21)]
    assert first[-1] == 429  # all requests look like one client
    from app.core import ratelimit
    ratelimit.reset()
    monkeypatch.setattr(live, "trust_forwarded_for", True)
    second = [(await attempt(f"10.0.0.{i}")).status_code for i in range(21)]
    assert 429 not in second
