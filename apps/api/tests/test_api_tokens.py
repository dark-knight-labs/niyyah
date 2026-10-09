import pytest
from sqlalchemy import select

from app.models.user import ApiToken
from tests.conftest import TestSession

T = "/api/v1/tokens"


@pytest.mark.asyncio
async def test_create_list_and_revoke(auth_client):
    res = await auth_client.post(T, json={"name": "  mirror  "})
    assert res.status_code == 201
    made = res.json()
    assert made["name"] == "mirror" and made["token"].startswith("nyt_") and len(made["token"]) > 30
    listed = (await auth_client.get(T)).json()
    assert [t["name"] for t in listed] == ["mirror"]
    assert "token" not in listed[0] and listed[0]["prefix"] == made["token"][:8]
    assert (await auth_client.delete(f"{T}/{made['id']}")).status_code == 204
    assert (await auth_client.get(T)).json() == []
    assert (await auth_client.delete(f"{T}/{made['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_only_a_hash_is_stored(auth_client):
    raw = (await auth_client.post(T, json={"name": "mirror"})).json()["token"]
    async with TestSession() as db:
        row = (await db.execute(select(ApiToken))).scalar_one()
    assert row.token_hash != raw and len(row.token_hash) == 64
    assert raw not in {str(getattr(row, c.name)) for c in ApiToken.__table__.columns}


@pytest.mark.asyncio
async def test_name_and_count_are_checked(auth_client):
    for bad in ["", "   ", "x" * 81]:
        assert (await auth_client.post(T, json={"name": bad})).status_code == 422, bad
    for i in range(10):
        assert (await auth_client.post(T, json={"name": f"t{i}"})).status_code == 201
    assert (await auth_client.post(T, json={"name": "eleventh"})).status_code == 422


@pytest.mark.asyncio
async def test_tokens_are_private_to_their_owner(auth_client):
    mine = (await auth_client.post(T, json={"name": "mine"})).json()
    await auth_client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await auth_client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await auth_client.get(T, headers=other)).json() == []
    assert (await auth_client.delete(f"{T}/{mine['id']}", headers=other)).status_code == 404


@pytest.mark.asyncio
async def test_a_token_cannot_manage_tokens(auth_client):
    raw = (await auth_client.post(T, json={"name": "mirror"})).json()["token"]
    as_token = {"Authorization": f"Bearer {raw}"}
    assert (await auth_client.get(T, headers=as_token)).status_code == 401
    assert (await auth_client.post(T, json={"name": "more"}, headers=as_token)).status_code == 401
    assert (await auth_client.get("/api/v1/auth/me", headers=as_token)).status_code == 401
