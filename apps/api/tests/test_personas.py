import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_persona(auth_client: AsyncClient):
    resp = await auth_client.post("/api/v1/personas", json={
        "name": "Siddiq",
        "arabic_name": "الصِّدِّيق",
        "domain": "Practice + Dawah",
        "eventually": "Muslim Scholar",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Siddiq"
    assert data["arabic_name"] == "الصِّدِّيق"


@pytest.mark.asyncio
async def test_list_personas(auth_client: AsyncClient):
    await auth_client.post("/api/v1/personas", json={"name": "P1", "domain": "D1"})
    await auth_client.post("/api/v1/personas", json={"name": "P2", "domain": "D2"})
    resp = await auth_client.get("/api/v1/personas")
    assert resp.status_code == 200
    assert len(resp.json()) >= 2


@pytest.mark.asyncio
async def test_update_persona(auth_client: AsyncClient):
    create = await auth_client.post("/api/v1/personas", json={"name": "Old", "domain": "D"})
    pid = create.json()["id"]
    resp = await auth_client.patch(f"/api/v1/personas/{pid}", json={"name": "New"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "New"


@pytest.mark.asyncio
async def test_delete_persona(auth_client: AsyncClient):
    create = await auth_client.post("/api/v1/personas", json={"name": "Del", "domain": "D"})
    pid = create.json()["id"]
    resp = await auth_client.delete(f"/api/v1/personas/{pid}")
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_add_milestone(auth_client: AsyncClient):
    create = await auth_client.post("/api/v1/personas", json={"name": "M", "domain": "D"})
    pid = create.json()["id"]
    resp = await auth_client.post(f"/api/v1/personas/{pid}/milestones", json={
        "goal": "Complete CKA",
        "target_date": "2026-03-31",
    })
    assert resp.status_code == 201
    assert resp.json()["goal"] == "Complete CKA"


@pytest.mark.asyncio
async def test_persona_not_found(auth_client: AsyncClient):
    resp = await auth_client.get("/api/v1/personas/9999")
    assert resp.status_code == 404
