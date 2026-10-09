import socket

import pytest

from app.services import vault_calendar

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


@pytest.fixture(autouse=True)
def fake_dns(monkeypatch):
    """Hostnames resolve to fixed addresses so the tests need no network."""
    real = socket.getaddrinfo
    table = {"calendar.google.com": "142.250.80.46", "x.example": "93.184.216.34", "internal.example": "10.0.0.8"}

    def fake(host, port, *args, **kwargs):
        if host in table:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (table[host], port))]
        return real(host, port, *args, **kwargs)

    monkeypatch.setattr(vault_calendar.socket, "getaddrinfo", fake)


@pytest.mark.asyncio
@pytest.mark.parametrize("url", [
    "https://127.0.0.1/a.ics", "https://localhost/a.ics", "https://10.0.0.5/a.ics", "https://169.254.169.254/latest/meta-data",
    "https://[::1]/a.ics", "https://internal.example/a.ics", "https://x.example:8443/a.ics", "https://[::ffff:10.0.0.1]/a.ics",
])
async def test_feeds_cannot_point_at_private_or_unusual_addresses(db_client, url):
    client, _ = db_client
    res = await client.post(F, json={"name": "Probe", "url": url})
    assert res.status_code == 422, url
    assert (await client.get(F)).json() == []


@pytest.mark.asyncio
async def test_a_public_address_is_accepted(db_client):
    client, _ = db_client
    assert (await client.post(F, json={"name": "Public", "url": "https://x.example/a.ics"})).status_code == 200


def test_a_redirect_into_the_private_network_is_refused(monkeypatch):
    class Hop:
        is_redirect = True
        headers = {"location": "https://internal.example/steal"}
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(vault_calendar.httpx, "stream", lambda *a, **k: Hop())
    vault_calendar._cache.clear()
    with pytest.raises(ValueError, match="public host"):
        vault_calendar._download("https://x.example/a.ics")


def test_an_oversized_feed_is_refused(monkeypatch):
    class Big:
        is_redirect = False
        def raise_for_status(self): pass
        def iter_bytes(self): yield b"x" * (vault_calendar.MAX_FEED_BYTES + 1)
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(vault_calendar.httpx, "stream", lambda *a, **k: Big())
    vault_calendar._cache.clear()
    with pytest.raises(ValueError, match="too large"):
        vault_calendar._download("https://x.example/a.ics")
