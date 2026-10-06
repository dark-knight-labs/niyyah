import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register", json={
        "email": "new@niyyah.app",
        "password": "securepass",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_register_duplicate(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={"email": "dup@niyyah.app", "password": "pass"})
    resp = await client.post("/api/v1/auth/register", json={"email": "dup@niyyah.app", "password": "pass"})
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_login(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={"email": "login@niyyah.app", "password": "pass123"})
    resp = await client.post("/api/v1/auth/login", json={"email": "login@niyyah.app", "password": "pass123"})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post("/api/v1/auth/register", json={"email": "wrong@niyyah.app", "password": "correct"})
    resp = await client.post("/api/v1/auth/login", json={"email": "wrong@niyyah.app", "password": "incorrect"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me(auth_client: AsyncClient):
    resp = await auth_client.get("/api/v1/auth/me")
    assert resp.status_code == 200
    assert resp.json()["email"] == "test@niyyah.app"


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={"email": "refresh@niyyah.app", "password": "pass"})
    refresh_token = reg.json()["refresh_token"]
    resp = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_logout(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={"email": "logout@niyyah.app", "password": "pass"})
    refresh_token = reg.json()["refresh_token"]
    resp = await client.post("/api/v1/auth/logout", json={"refresh_token": refresh_token})
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_refresh_token_survives_concurrent_use(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={"email": "twice@niyyah.app", "password": "pass"})
    refresh_token = reg.json()["refresh_token"]
    first = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    second = await client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
    assert first.status_code == 200 and second.status_code == 200
