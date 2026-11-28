import logging
import re
from datetime import timedelta

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.core.deps import DEVICE_LIMIT
from app.core.plugins import flat_routes
from app.main import app
from app.models.user import DeviceToken
from tests.conftest import TestSession

D = "/api/v1/devices/tokens"
ITEMS = "/api/v1/vault/items"
OPTIONS = "/api/v1/capture/options"
ALLOWED = {("POST", ITEMS), ("GET", OPTIONS), ("GET", "/api/v1/capture/tasks"), ("PATCH", "/api/v1/capture/tasks/{client_id}")}
# Routes that take no bearer token at all: a device token is irrelevant there.
OPEN = {("GET", "/health"), ("POST", "/api/v1/auth/register"), ("POST", "/api/v1/auth/login"), ("POST", "/api/v1/auth/refresh"),
        ("POST", "/api/v1/auth/logout"),
        ("GET", "/api/v1/vault/calendar/google/callback")}  # the OAuth callback is checked by its state, it takes no bearer


DOCS = {"/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"}


def bearer(raw: str) -> dict:
    return {"Authorization": f"Bearer {raw}"}


async def make_device(auth_client, name="mac") -> tuple[dict, dict]:
    res = await auth_client.post(D, json={"name": name})
    assert res.status_code == 201
    made = res.json()
    return made, bearer(made["token"])


def item_body() -> dict:
    return {"text": "call the bank #errand", "day": _local_now().date().isoformat()}


@pytest.mark.asyncio
async def test_create_shows_the_token_once_and_list_never_does(auth_client):
    made, _ = await make_device(auth_client, "  mac  ")
    raw = made["token"]
    assert made["name"] == "mac" and made["scope"] == "capture"
    assert raw.startswith("nyd_") and len(raw) == len("nyd_") + 43  # 32 random bytes, base64url without padding
    listed = await auth_client.get(D)
    assert listed.status_code == 200 and raw not in listed.text
    row = listed.json()[0]
    assert set(row) == {"id", "name", "prefix", "scope", "created_at", "last_used_at"}  # no token, no hash
    assert row["prefix"] == raw[:8]


@pytest.mark.asyncio
async def test_only_a_hash_is_stored_and_never_returned(auth_client):
    made, _ = await make_device(auth_client)
    raw = made["token"]
    async with TestSession() as db:
        stored = (await db.execute(select(DeviceToken))).scalar_one()
    assert stored.token_hash != raw and len(stored.token_hash) == 64
    assert raw not in {str(getattr(stored, c.name)) for c in DeviceToken.__table__.columns}
    for res in (await auth_client.get(D), await auth_client.post(D, json={"name": "second"})):
        assert stored.token_hash not in res.text


@pytest.mark.asyncio
async def test_a_revoked_token_gets_401_at_once(auth_client):
    made, as_device = await make_device(auth_client)
    assert (await auth_client.get(OPTIONS, headers=as_device)).status_code == 200
    assert (await auth_client.delete(f"{D}/{made['id']}")).status_code == 204
    for res in (await auth_client.get(OPTIONS, headers=as_device), await auth_client.post(ITEMS, json=item_body(), headers=as_device)):
        assert res.status_code == 401
    assert (await auth_client.get(D)).json() == []
    assert (await auth_client.delete(f"{D}/{made['id']}")).status_code == 404  # already revoked
    async with TestSession() as db:
        assert (await db.execute(select(DeviceToken.revoked_at))).scalar_one() is not None


@pytest.mark.asyncio
async def test_unknown_and_malformed_device_tokens_get_401(auth_client):
    for raw in ["nyd_" + "A" * 43, "nyd_", "nyd_x"]:
        assert (await auth_client.get(OPTIONS, headers=bearer(raw))).status_code == 401


@pytest.mark.asyncio
async def test_a_device_token_creates_a_task_and_reads_options(auth_client):
    _, as_device = await make_device(auth_client)
    made = await auth_client.post(ITEMS, json=item_body(), headers=as_device)
    assert made.status_code == 201 and made.json()["title"].startswith("call the bank")
    assert (await auth_client.post(ITEMS, json={"text": "later", "lane": "next"}, headers=as_device)).status_code == 422  # a lane needs a stream
    opts = await auth_client.get(OPTIONS, headers=as_device)
    assert opts.status_code == 200
    body = opts.json()
    assert set(body) == {"blocks", "products", "streams", "day"} and body["day"] in ("weekday", "weekend")
    assert (await auth_client.get(D)).json()[0]["last_used_at"] is not None


@pytest.mark.asyncio
async def test_options_have_the_shape_the_menubar_app_reads(db_client):
    client, _ = db_client
    added = await client.post("/api/v1/vault/products", json={"block": "studio", "name": "Router"})
    assert added.status_code == 201, added.text
    _, as_device = await make_device(client)
    body = (await client.get(OPTIONS, headers=as_device)).json()
    assert body["blocks"] and body["products"] and body["streams"]
    assert set(body["blocks"][0]) == {"block", "start", "end", "what", "stream"}
    assert set(body["products"][0]) == {"slug", "name", "block"}
    assert body["products"] == [{"slug": "router", "name": "Router", "block": "studio"}]
    assert {p["block"] for p in body["products"]} <= {s["slug"] for s in body["streams"]}
    assert {s["slug"] for s in body["streams"]} == {"studio", "shop"}
    stream = body["streams"][0]["slug"]
    lane = await client.post(ITEMS, json={"text": "wire it", "lane": "next", "stream": stream, "products": ["Router"]}, headers=as_device)
    assert lane.status_code == 201, lane.text  # a lane capture works with a stream from the options


@pytest.mark.asyncio
async def test_a_device_token_is_refused_with_403_on_every_other_route(auth_client):
    _, as_device = await make_device(auth_client)
    seen, leaks = 0, []
    for path_template, method in sorted(flat_routes(app.routes)):
        if method in ("HEAD", "OPTIONS") or (method, path_template) in ALLOWED | OPEN or path_template in DOCS:
            continue
        path = re.sub(r"\{[^}]+\}", "1", path_template)
        res = await auth_client.request(method, path, headers=as_device, json={} if method in ("POST", "PUT", "PATCH") else None)
        seen += 1
        if res.status_code != 403:
            leaks.append(f"{method} {path_template} -> {res.status_code}")
    assert seen > 50, "the route walk found too few routes"
    assert not leaks, "\n".join(leaks)


@pytest.mark.asyncio
async def test_a_device_token_cannot_reach_export_or_manage_tokens(auth_client):
    _, as_device = await make_device(auth_client)
    assert (await auth_client.get("/api/v1/export", headers=as_device)).status_code == 403
    assert (await auth_client.get("/api/v1/auth/me", headers=as_device)).status_code == 403
    assert (await auth_client.get("/api/v1/tokens", headers=as_device)).status_code == 403
    assert (await auth_client.get(D, headers=as_device)).status_code == 403
    assert (await auth_client.post(D, json={"name": "more"}, headers=as_device)).status_code == 403
    assert (await auth_client.delete(f"{D}/1", headers=as_device)).status_code == 403
    assert (await auth_client.get("/api/v1/vault/items", params={"from": "2026-01-01", "to": "2026-01-02"},
                                  headers=as_device)).status_code == 403  # same path as the allowed POST, other method
    assert (await auth_client.patch(f"{ITEMS}/1", json={"text": "x"}, headers=as_device)).status_code == 403
    assert (await auth_client.delete(f"{ITEMS}/1", headers=as_device)).status_code == 403


@pytest.mark.asyncio
async def test_the_export_token_still_works_and_is_refused_on_the_new_routes(auth_client):
    raw = (await auth_client.post("/api/v1/tokens", json={"name": "mirror"})).json()["token"]
    assert raw.startswith("nyt_")
    as_export = bearer(raw)
    assert (await auth_client.get("/api/v1/export", headers=as_export)).status_code == 200
    assert (await auth_client.get(OPTIONS, headers=as_export)).status_code == 401
    assert (await auth_client.post(ITEMS, json=item_body(), headers=as_export)).status_code == 401
    assert (await auth_client.get(D, headers=as_export)).status_code == 401


@pytest.mark.asyncio
async def test_a_login_still_creates_items_and_reads_options(auth_client):
    assert (await auth_client.post(ITEMS, json=item_body())).status_code == 201
    assert (await auth_client.get(OPTIONS)).status_code == 200


@pytest.mark.asyncio
async def test_device_tokens_are_private_to_their_owner(auth_client):
    mine, _ = await make_device(auth_client)
    await auth_client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await auth_client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = bearer(login.json()["access_token"])
    assert (await auth_client.get(D, headers=other)).json() == []
    assert (await auth_client.delete(f"{D}/{mine['id']}", headers=other)).status_code == 404
    assert len((await auth_client.get(D)).json()) == 1  # still live for its owner


@pytest.mark.asyncio
async def test_name_and_count_are_checked(auth_client):
    for bad in ["", "   ", "x" * 81]:
        assert (await auth_client.post(D, json={"name": bad})).status_code == 422, bad
    for i in range(10):
        assert (await auth_client.post(D, json={"name": f"d{i}"})).status_code == 201
    assert (await auth_client.post(D, json={"name": "eleventh"})).status_code == 422


@pytest.mark.asyncio
async def test_the_rate_limit_trips_per_token(auth_client):
    _, first = await make_device(auth_client, "first")
    _, second = await make_device(auth_client, "second")
    for _ in range(DEVICE_LIMIT):
        assert (await auth_client.get(OPTIONS, headers=first)).status_code == 200
    over = await auth_client.get(OPTIONS, headers=first)
    assert over.status_code == 429 and int(over.headers["Retry-After"]) >= 1
    assert (await auth_client.post(ITEMS, json=item_body(), headers=first)).status_code == 429  # one budget across both routes
    assert (await auth_client.get(OPTIONS, headers=second)).status_code == 200  # another device is unaffected
    assert (await auth_client.get(OPTIONS)).status_code == 200  # so is a login


@pytest.mark.asyncio
async def test_the_token_never_appears_in_a_log_line(auth_client, caplog, capsys):
    caplog.set_level(logging.DEBUG)
    logging.getLogger().setLevel(logging.DEBUG)
    made, as_device = await make_device(auth_client)
    raw = made["token"]
    await auth_client.get(OPTIONS, headers=as_device)
    await auth_client.post(ITEMS, json=item_body(), headers=as_device)
    await auth_client.get("/api/v1/export", headers=as_device)  # 403
    await auth_client.get(D)
    for _ in range(DEVICE_LIMIT):  # reach the 429 path too
        await auth_client.get(OPTIONS, headers=as_device)
    await auth_client.delete(f"{D}/{made['id']}")
    await auth_client.get(OPTIONS, headers=as_device)  # 401 after revoke
    assert caplog.records, "nothing was captured: the test would pass for the wrong reason"
    out = capsys.readouterr()
    for text in (caplog.text, out.out, out.err):
        assert raw not in text and raw[4:] not in text


# --- idempotent capture: client_id -------------------------------------------------------------------------------------

CID = "6f1c2f3e-8d0a-4c53-9a35-0f4d5b0e2a11"


def lane_body(**extra) -> dict:
    return {"text": "call the bank", "lane": "next", "stream": "studio", **extra}


async def count_tasks(text: str) -> int:
    from app.models.planner import Task
    async with TestSession() as db:
        return len((await db.execute(select(Task).where(Task.text == text))).scalars().all())


@pytest.mark.asyncio
async def test_a_repeated_client_id_returns_the_first_item(db_client):
    client, _ = db_client
    _, as_device = await make_device(client)
    first = await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)
    again = await client.post(ITEMS, json=lane_body(client_id=CID, text="a different text"), headers=as_device)
    assert first.status_code == 201 and again.status_code == 200
    assert again.json()["id"] == first.json()["id"] and again.json()["title"] == "call the bank"  # the repeat's other fields are ignored
    assert await count_tasks("call the bank") == 1 and await count_tasks("a different text") == 0


@pytest.mark.asyncio
async def test_the_same_client_id_from_another_device_is_a_new_item(db_client):
    client, _ = db_client
    _, one = await make_device(client, "one")
    _, two = await make_device(client, "two")
    a = await client.post(ITEMS, json=lane_body(client_id=CID), headers=one)
    b = await client.post(ITEMS, json=lane_body(client_id=CID), headers=two)
    assert a.status_code == b.status_code == 201 and a.json()["id"] != b.json()["id"]  # unique per device token, not global
    assert await count_tasks("call the bank") == 2


@pytest.mark.asyncio
async def test_without_a_client_id_every_post_is_a_new_item(db_client):
    client, _ = db_client
    _, as_device = await make_device(client)
    for _ in range(2):
        assert (await client.post(ITEMS, json=lane_body(), headers=as_device)).status_code == 201
    assert await count_tasks("call the bank") == 2


@pytest.mark.asyncio
async def test_a_login_ignores_client_id(db_client):
    from app.models.user import DeviceCapture
    client, _ = db_client
    for _ in range(2):
        assert (await client.post(ITEMS, json=lane_body(client_id=CID))).status_code == 201
    assert await count_tasks("call the bank") == 2
    async with TestSession() as db:
        assert (await db.execute(select(DeviceCapture))).first() is None  # only device tokens record one


@pytest.mark.asyncio
async def test_a_bad_client_id_is_a_422(db_client):
    client, _ = db_client
    _, as_device = await make_device(client)
    for bad in ["not-a-uuid", "", 5]:
        assert (await client.post(ITEMS, json=lane_body(client_id=bad), headers=as_device)).status_code == 422, bad
    assert await count_tasks("call the bank") == 0


@pytest.mark.asyncio
async def test_a_failed_capture_leaves_no_mapping_so_the_retry_can_succeed(db_client):
    from app.models.user import DeviceCapture
    client, _ = db_client
    _, as_device = await make_device(client)
    bad = await client.post(ITEMS, json=lane_body(client_id=CID, stream="nope"), headers=as_device)
    assert bad.status_code == 422
    async with TestSession() as db:
        assert (await db.execute(select(DeviceCapture))).first() is None
    assert (await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)).status_code == 201


@pytest.mark.asyncio
async def test_a_deleted_item_can_be_captured_again(db_client):
    client, _ = db_client
    _, as_device = await make_device(client)
    first = (await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)).json()
    assert (await client.delete(f"{ITEMS}/{first['id']}")).status_code == 204
    again = await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)
    assert again.status_code == 201  # not a 200 replay of a task that is gone
    assert await count_tasks("call the bank") == 1


@pytest.mark.asyncio
async def test_a_concurrent_retry_that_loses_the_unique_key_gets_the_first_item(db_client, monkeypatch):
    """Both calls pass the first lookup; the second's insert hits the unique key and must return the winner, not a 500 or a duplicate."""
    from app.services import device_tokens
    client, _ = db_client
    _, as_device = await make_device(client)
    first = await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)
    real, calls = device_tokens.captured_task, []

    async def blind_once(*args, **kwargs):
        calls.append(1)
        return None if len(calls) == 1 else await real(*args, **kwargs)

    monkeypatch.setattr(device_tokens, "captured_task", blind_once)
    raced = await client.post(ITEMS, json=lane_body(client_id=CID), headers=as_device)
    assert len(calls) == 2 and raced.status_code == 200 and raced.json()["id"] == first.json()["id"]
    assert await count_tasks("call the bank") == 1  # the loser's task was rolled back
