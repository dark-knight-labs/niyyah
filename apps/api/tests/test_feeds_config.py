import pytest

F = "/api/v1/vault/config/feeds"


@pytest.mark.asyncio
async def test_feeds_are_masked_and_scoped(db_client):
    client, _ = db_client
    added = await client.post(F, json={"name": "Family", "url": "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"})
    assert added.status_code == 200
    listed = (await client.get(F)).json()
    assert listed[0]["name"] == "Family" and listed[0]["host"] == "calendar.google.com" and "private-abc" not in str(listed)
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get(F, headers=other)).json() == []
    assert (await client.delete(f"{F}/{listed[0]['id']}", headers=other)).status_code == 404
    assert (await client.delete(f"{F}/{listed[0]['id']}")).status_code == 204
    assert (await client.get(F)).json() == []


@pytest.mark.asyncio
async def test_feed_input_is_checked(db_client):
    client, _ = db_client
    for body in ({"name": "x", "url": "http://insecure.example/a.ics"}, {"name": " ", "url": "https://x.example/a.ics"}, {"name": "x", "url": "not a url"}):
        assert (await client.post(F, json=body)).status_code == 422
