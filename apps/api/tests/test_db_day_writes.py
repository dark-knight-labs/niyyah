import pytest


@pytest.mark.asyncio
async def test_fixture_gives_an_imported_user_in_db_mode(db_client):
    client, today = db_client
    day = (await client.get("/api/v1/vault/today")).json()
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1}
