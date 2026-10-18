import pytest
from httpx import AsyncClient

API = "/api/v1/vault/pins"


@pytest.mark.asyncio
async def test_pin_and_unpin_are_idempotent(auth_client: AsyncClient):
    assert (await auth_client.get(API)).json() == []
    for _ in range(2):
        r = await auth_client.put(API, json={"key": "e:abc", "pinned": True})
        assert r.status_code == 200 and r.json() == ["e:abc"]
    r = await auth_client.put(API, json={"key": "t:Pay rent", "pinned": True})
    assert r.json() == ["e:abc", "t:Pay rent"]
    for _ in range(2):
        r = await auth_client.put(API, json={"key": "e:abc", "pinned": False})
        assert r.json() == ["t:Pay rent"]


@pytest.mark.asyncio
async def test_pin_key_must_name_an_event_or_task(auth_client: AsyncClient):
    assert (await auth_client.put(API, json={"key": "x:abc", "pinned": True})).status_code == 422
    assert (await auth_client.put(API, json={"key": "e:" + "a" * 400, "pinned": True})).status_code == 422


@pytest.mark.asyncio
async def test_pins_need_sign_in(client: AsyncClient):
    assert (await client.get(API)).status_code == 401
