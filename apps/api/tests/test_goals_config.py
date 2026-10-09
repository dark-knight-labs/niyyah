import pytest

from app.core.config import settings

G = "/api/v1/vault/config/goals"
GOAL = {"title": "Zero debt", "value": "62% paid", "caption": "what it is for", "progress": 62}


@pytest.mark.asyncio
async def test_replace_and_read_back(db_client):
    client, _ = db_client
    res = await client.put(G, json={"items": [GOAL, {"title": "Life simple", "value": "Fewer things"}]})
    assert res.status_code == 200
    items = (await client.get("/api/v1/vault/goals")).json()["items"]
    assert [(g["title"], g["value"], g["caption"], g["progress"]) for g in items] == [
        ("Zero debt", "62% paid", "what it is for", 62), ("Life simple", "Fewer things", "", None)]
    assert (await client.put(G, json={"items": []})).json()["items"] == []


@pytest.mark.asyncio
async def test_goal_input_is_checked(db_client):
    client, _ = db_client
    for bad in [{**GOAL, "title": " "}, {**GOAL, "value": ""}, {**GOAL, "progress": 101}, {**GOAL, "progress": -1},
                {**GOAL, "title": "a|b"}, {**GOAL, "caption": "two\nlines"}, {**GOAL, "title": "x" * 61}]:
        assert (await client.put(G, json={"items": [bad]})).status_code == 422, bad
    assert (await client.put(G, json={"items": [GOAL] * 7})).status_code == 422


@pytest.mark.asyncio
async def test_goals_are_per_user(db_client):
    client, _ = db_client
    await client.put(G, json={"items": [GOAL]})
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get("/api/v1/vault/goals", headers=other)).json()["items"] == []


