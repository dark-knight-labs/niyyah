"""Capture extras (link, deadline_at, tracked_seconds, timer_started_at, done at create) and the device's own sync routes."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.models.planner import Task
from tests.conftest import TestSession
from tests.test_device_tokens import ITEMS, bearer, make_device

TASKS = "/api/v1/capture/tasks"


def body(**extra) -> dict:
    return {"text": "ship the report", "day": _local_now().date().isoformat(), **extra}


def lane(**extra) -> dict:
    return {"text": "ship the report", "lane": "next", "stream": "studio", **extra}


def cid() -> str:
    return str(uuid.uuid4())


async def device(client, name="mac"):
    return (await make_device(client, name))[1]


async def second_user_device(client):
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "testpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "testpass123"})
    as_login = bearer(login.json()["access_token"])
    made = await client.post("/api/v1/devices/tokens", json={"name": "theirs"}, headers=as_login)
    assert made.status_code == 201
    return as_login, bearer(made.json()["token"])


DEADLINE = "2026-12-01T17:30:00+06:00"


@pytest.mark.asyncio
async def test_create_stores_every_extra_and_returns_it(db_client):
    client, _ = db_client
    as_device = await device(client)
    started = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    res = await client.post(ITEMS, headers=as_device, json=body(
        link="https://example.com/a?b=1", deadline_at=DEADLINE, tracked_seconds=90, timer_started_at=started, status="done", client_id=cid()))
    assert res.status_code == 201
    got = res.json()
    assert got["link"] == "https://example.com/a?b=1" and got["tracked_seconds"] == 90 and got["done"] is True and got["status"] == "done"
    assert datetime.fromisoformat(got["deadline_at"]) == datetime.fromisoformat(DEADLINE)
    assert got["deadline_at"].endswith("Z") or got["deadline_at"].endswith("+00:00")  # stored and sent as UTC
    assert datetime.fromisoformat(got["timer_started_at"]) == datetime.fromisoformat(started)
    assert got["due_on"] is None  # the date-only due day is its own field


@pytest.mark.asyncio
async def test_an_old_client_that_sends_none_of_them_still_works(db_client):
    client, _ = db_client
    as_device = await device(client)
    got = (await client.post(ITEMS, headers=as_device, json=body())).json()
    assert (got["link"], got["deadline_at"], got["tracked_seconds"], got["timer_started_at"], got["done"]) == (None, None, 0, None, False)


@pytest.mark.asyncio
async def test_a_pipeline_item_can_be_born_done(db_client):
    client, _ = db_client
    as_device = await device(client)
    res = await client.post(ITEMS, headers=as_device, json=lane(status="done", link="http://example.com"))
    assert res.status_code == 201 and res.json()["done"] is True and res.json()["lane"] == "done"
    assert (await client.post(ITEMS, headers=as_device, json=lane(status="skipped"))).status_code == 422


@pytest.mark.asyncio
async def test_a_login_can_send_and_patch_the_extras_too(db_client):
    client, _ = db_client
    made = (await client.post(ITEMS, json=body(link="https://example.com"))).json()
    res = await client.patch(f"{ITEMS}/{made['id']}", json={"tracked_seconds": 5, "link": None})
    assert res.status_code == 200 and res.json()["tracked_seconds"] == 5 and res.json()["link"] is None


@pytest.mark.asyncio
async def test_replaying_a_capture_with_extras_is_idempotent(db_client):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    first = await client.post(ITEMS, headers=as_device, json=body(link="https://example.com", client_id=key))
    again = await client.post(ITEMS, headers=as_device, json=body(link="https://other.example", tracked_seconds=500, client_id=key))
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json()["id"] == first.json()["id"] and again.json()["link"] == "https://example.com" and again.json()["tracked_seconds"] == 0
    async with TestSession() as db:
        assert len((await db.execute(select(Task).where(Task.text == "ship the report"))).scalars().all()) == 1
    listed = (await client.get(TASKS, headers=as_device)).json()["tasks"]
    assert [t["client_id"] for t in listed] == [key]


@pytest.mark.asyncio
@pytest.mark.parametrize("extra", [
    {"link": "javascript:alert(1)"}, {"link": "file:///etc/passwd"}, {"link": "ftp://example.com"}, {"link": "example.com"},
    {"link": "https://"}, {"link": "https://exa mple.com"}, {"link": "https://example.com/\n"}, {"link": ""},
    {"link": "https://example.com/" + "a" * 2048}, {"tracked_seconds": -1}, {"tracked_seconds": 315_360_001},
    {"deadline_at": "2026-12-01T17:30:00"}, {"deadline_at": "not a date"}, {"timer_started_at": "2026-12-01T17:30:00"},
    {"timer_started_at": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()}, {"text": "x" * 301},
])
async def test_bad_extras_are_a_422_and_save_nothing(db_client, extra):
    client, _ = db_client
    as_device = await device(client)
    res = await client.post(ITEMS, headers=as_device, json=body(client_id=cid(), **extra))
    assert res.status_code == 422
    async with TestSession() as db:
        assert (await db.execute(select(Task).where(Task.text == "ship the report"))).first() is None


@pytest.mark.asyncio
async def test_list_returns_open_tasks_of_this_device_only(db_client):
    client, _ = db_client
    one, two = await device(client, "one"), await device(client, "two")
    a, b, c = cid(), cid(), cid()
    for key, text, who in ((a, "alpha", one), (b, "beta", one), (c, "gamma", two)):
        assert (await client.post(ITEMS, headers=who, json=body(text=text, client_id=key))).status_code == 201
    await client.post(ITEMS, headers=one, json=body(text="no key"))  # captured without a client_id: not syncable
    await client.patch(f"{TASKS}/{b}", headers=one, json={"done": True})
    open_ = (await client.get(TASKS, headers=one)).json()["tasks"]
    assert [t["client_id"] for t in open_] == [a]
    assert [t["client_id"] for t in (await client.get(TASKS, headers=one, params={"include_done": True})).json()["tasks"]] == [b, a]  # newest first
    assert [t["text"] for t in (await client.get(TASKS, headers=two)).json()["tasks"]] == ["gamma"]
    assert set(open_[0]) == {"client_id", "id", "text", "status", "done", "link", "deadline_at", "tracked_seconds", "timer_started_at",
                             "due_on", "scheduled_on", "lane", "stream", "products"}
    assert (await client.get(TASKS, headers=one, params={"limit": 0})).status_code == 422


@pytest.mark.asyncio
async def test_patch_changes_only_the_fields_sent(db_client):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    await client.post(ITEMS, headers=as_device, json=body(client_id=key, link="https://example.com", tracked_seconds=10))
    started = datetime.now(timezone.utc).isoformat()
    res = await client.patch(f"{TASKS}/{key}", headers=as_device, json={"tracked_seconds": 70, "timer_started_at": started, "deadline_at": DEADLINE})
    got = res.json()
    assert res.status_code == 200 and got["tracked_seconds"] == 70 and got["link"] == "https://example.com" and got["done"] is False
    assert datetime.fromisoformat(got["deadline_at"]) == datetime.fromisoformat(DEADLINE) and got["timer_started_at"] is not None
    res = await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True, "timer_started_at": None, "link": None, "deadline_at": None, "text": "renamed"})
    got = res.json()
    assert (got["done"], got["status"], got["timer_started_at"], got["link"], got["deadline_at"], got["text"], got["tracked_seconds"]) == (
        True, "done", None, None, None, "renamed", 70)
    assert (await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": False})).json()["status"] == "open"


@pytest.mark.asyncio
async def test_patching_twice_with_the_same_body_is_a_no_op(db_client):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    await client.post(ITEMS, headers=as_device, json=body(client_id=key))
    change = {"done": True, "tracked_seconds": 30, "link": "https://example.com"}
    first = (await client.patch(f"{TASKS}/{key}", headers=as_device, json=change)).json()
    async with TestSession() as db:
        done_on = (await db.execute(select(Task.done_on).where(Task.id == first["id"]))).scalar_one()
    second = (await client.patch(f"{TASKS}/{key}", headers=as_device, json=change)).json()
    assert first == second
    async with TestSession() as db:
        assert (await db.execute(select(Task.done_on).where(Task.id == first["id"]))).scalar_one() == done_on


@pytest.mark.asyncio
async def test_a_pipeline_task_follows_the_pipeline_when_ticked(db_client):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    assert (await client.post(ITEMS, headers=as_device, json=lane(client_id=key))).json()["lane"] == "next"
    got = (await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True})).json()
    assert got["lane"] == "done" and got["done"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [
    {"done": None}, {"text": None}, {"tracked_seconds": None}, {"text": ""}, {"link": "javascript:x"}, {"tracked_seconds": -5},
    {"deadline_at": "2026-12-01T10:00:00"}, {"done": "maybe"},
])
async def test_patch_validation(db_client, bad):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    await client.post(ITEMS, headers=as_device, json=body(client_id=key))
    assert (await client.patch(f"{TASKS}/{key}", headers=as_device, json=bad)).status_code == 422
    assert (await client.get(TASKS, headers=as_device)).json()["tasks"][0]["tracked_seconds"] == 0  # nothing saved


@pytest.mark.asyncio
async def test_patch_of_an_unknown_or_malformed_id(db_client):
    client, _ = db_client
    as_device = await device(client)
    assert (await client.patch(f"{TASKS}/{cid()}", headers=as_device, json={"done": True})).status_code == 404
    assert (await client.patch(f"{TASKS}/not-a-uuid", headers=as_device, json={"done": True})).status_code == 422


@pytest.mark.asyncio
async def test_a_token_never_reaches_another_users_rows(db_client):
    client, _ = db_client
    mine = await device(client, "mine")
    key = cid()
    await client.post(ITEMS, headers=mine, json=body(text="private", client_id=key))
    as_login, theirs = await second_user_device(client)
    await client.post(ITEMS, headers=theirs, json=body(text="theirs", client_id=cid()))
    assert [t["text"] for t in (await client.get(TASKS, headers=theirs)).json()["tasks"]] == ["theirs"]
    attack = await client.patch(f"{TASKS}/{key}", headers=theirs, json={"done": True, "text": "pwned", "link": "https://evil.example"})
    assert attack.status_code == 404
    async with TestSession() as db:
        row = (await db.execute(select(Task).where(Task.text.in_(["private", "pwned"])))).scalar_one()
    assert (row.text, row.done, row.link) == ("private", False, None)
    # the same client_id on the other user's device is its own, separate task
    theirs_same = await client.post(ITEMS, headers=theirs, json=body(text="theirs too", client_id=key))
    assert theirs_same.status_code == 201 and theirs_same.json()["id"] != row.id


@pytest.mark.asyncio
async def test_another_device_of_the_same_user_cannot_patch_this_devices_task(db_client):
    client, _ = db_client
    one, two = await device(client, "one"), await device(client, "two")
    key = cid()
    await client.post(ITEMS, headers=one, json=body(client_id=key))
    assert (await client.patch(f"{TASKS}/{key}", headers=two, json={"done": True})).status_code == 404


@pytest.mark.asyncio
async def test_a_mapping_that_points_at_another_users_task_is_not_followed(db_client):
    """Belt and braces: even a corrupt device_captures row cannot expose a task whose user_id differs from the token's."""
    from app.models.user import DeviceCapture, DeviceToken
    client, _ = db_client
    mine = await device(client, "mine")
    _, theirs = await second_user_device(client)
    made = (await client.post(ITEMS, headers=theirs, json=body(text="theirs", client_id=cid()))).json()
    async with TestSession() as db:
        token_id = (await db.execute(select(DeviceToken.id).where(DeviceToken.name == "mine"))).scalar_one()
        key = cid()
        db.add(DeviceCapture(device_token_id=token_id, client_id=key, task_id=made["id"]))
        await db.commit()
    assert (await client.get(TASKS, headers=mine)).json()["tasks"] == []
    assert (await client.patch(f"{TASKS}/{key}", headers=mine, json={"text": "pwned"})).status_code == 404


@pytest.mark.asyncio
async def test_logins_and_other_tokens_are_refused_on_the_sync_routes(db_client):
    client, _ = db_client
    key = cid()
    assert (await client.get(TASKS)).status_code == 403  # a login has no device
    assert (await client.patch(f"{TASKS}/{key}", json={"done": True})).status_code == 403
    assert (await client.get(TASKS, headers=bearer("nyd_" + "x" * 43))).status_code == 401
    made = await client.post("/api/v1/tokens", json={"name": "export"})
    if made.status_code in (200, 201):
        assert (await client.get(TASKS, headers=bearer(made.json()["token"]))).status_code == 401


@pytest.mark.asyncio
async def test_a_revoked_token_loses_the_sync_routes_at_once(db_client):
    client, _ = db_client
    made, as_device = await make_device(client)
    assert (await client.get(TASKS, headers=as_device)).status_code == 200
    assert (await client.delete(f"/api/v1/devices/tokens/{made['id']}")).status_code in (200, 204)
    assert (await client.get(TASKS, headers=as_device)).status_code == 401


@pytest.mark.asyncio
async def test_sync_routes_share_the_per_token_rate_limit(db_client):
    from app.core.deps import DEVICE_LIMIT
    client, _ = db_client
    as_device = await device(client)
    for _ in range(DEVICE_LIMIT):
        assert (await client.get(TASKS, headers=as_device)).status_code == 200
    assert (await client.get(TASKS, headers=as_device)).status_code == 429
    assert (await client.patch(f"{TASKS}/{cid()}", headers=as_device, json={"done": True})).status_code == 429


@pytest.mark.asyncio
async def test_extras_show_in_the_day_read(db_client):
    client, today = db_client
    await client.post(ITEMS, json=body(link="https://example.com", tracked_seconds=12))
    items = (await client.get("/api/v1/vault/items", params={"from": today.isoformat(), "to": today.isoformat()})).json()
    mine = next(i for i in (items["items"] if isinstance(items, dict) else items) if i.get("title") == "ship the report")
    assert mine["link"] == "https://example.com" and mine["tracked_seconds"] == 12
