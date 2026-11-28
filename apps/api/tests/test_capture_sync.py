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
async def test_a_capture_can_be_born_done_and_a_stale_lane_is_ignored(db_client):
    client, _ = db_client
    as_device = await device(client)
    res = await client.post(ITEMS, headers=as_device, json=lane(status="done", link="http://example.com"))
    assert res.status_code == 201 and res.json()["done"] is True and res.json()["lane"] is None


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
    assert made.status_code == 201, made.text
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


OPTIONS = "/api/v1/capture/options"
PIPELINES = "/api/v1/vault/pipelines"
WEEKLY = "/api/v1/vault/weekly-log"


async def add_streams(*rows):
    """Streams in the current quarter, bypassing the Plan page: (slug, name, has_pipeline, status)."""
    from app.api.v1.vault import _local_now
    from app.models.planner import QuarterStream
    from app.services.rules import quarter_for
    async with TestSession() as db:
        label = quarter_for(_local_now().date())
        for n, (slug, name, goal, status) in enumerate(rows, start=50):
            db.add(QuarterStream(user_id=1, quarter=label, slug=slug, name=name, color="violet", icon="circle-dot", slot="", weekly=True,
                                 has_pipeline=goal, in_note=True, goal="", goal_checklist=[], status=status, checkpoints=[], position=n))
        await db.commit()


@pytest.mark.asyncio
async def test_options_list_every_non_archived_stream_with_its_optional_products(db_client):
    from app.models.planner import PlannerProduct
    client, _ = db_client
    as_device = await device(client)
    await add_streams(("kahf", "Kahf", False, "committed"), ("alisha", "Alisha Noor", False, "active"), ("old", "Old", True, "archived"))
    async with TestSession() as db:
        db.add_all([PlannerProduct(user_id=1, block="studio", slug="router", name="Router", position=0),
                    PlannerProduct(user_id=1, block="shop", slug="cart", name="Cart", position=0)])
        await db.commit()
    opts = (await client.get(OPTIONS, headers=as_device)).json()
    assert {"blocks", "products", "streams", "day"} <= set(opts) and "day_blocks" not in opts  # the v1.33 keys stay
    by = {s["slug"]: s for s in opts["streams"]}
    assert {"studio", "shop", "kahf", "alisha"} <= set(by) and "old" not in by  # no goal or pipeline needed; archived is out
    assert by["kahf"]["name"] == "Kahf" and by["kahf"]["color"] == "violet" and by["kahf"]["products"] == []
    assert by["studio"]["products"] == [{"slug": "router", "name": "Router"}]
    assert all(set(s) == {"slug", "name", "color", "products"} for s in opts["streams"])


@pytest.mark.asyncio
async def test_options_carry_a_stream_that_only_the_earlier_quarter_has(db_client):
    from app.api.v1.vault import _local_now
    from app.models.planner import QuarterStream
    client, _ = db_client
    as_device = await device(client)
    async with TestSession() as db:
        db.add(QuarterStream(user_id=1, quarter="2020-Q1", slug="past", name="Past", color="rose", icon="circle-dot", slot="", weekly=True,
                             has_pipeline=False, in_note=True, goal="", goal_checklist=[], status="committed", checkpoints=[], position=0))
        await db.commit()
    assert "past" in {s["slug"] for s in (await client.get(OPTIONS, headers=as_device)).json()["streams"]}


@pytest.mark.asyncio
async def test_a_capture_is_a_day_task_with_a_stream_and_never_a_pipeline_item(db_client):
    client, today = db_client
    as_device = await device(client)
    await add_streams(("kahf", "Kahf", False, "committed"))
    res = await client.post(ITEMS, headers=as_device, json={"text": "ship it", "stream": "kahf", "products": ["x"], "client_id": cid()})
    got = res.json()
    assert res.status_code == 201 and got["stream"] == "kahf" and got["day"] == today.isoformat() and got["lane"] is None and got["products"] == ["x"]
    # an older client that still sends a lane (with or without a stream, or one without a pipeline) is not refused: the lane is ignored
    for extra in ({"lane": "now", "stream": "studio"}, {"lane": "next"}, {"lane": "backlog", "stream": "kahf"}):
        res = await client.post(ITEMS, headers=as_device, json={"text": f"old {extra}", "client_id": cid(), **extra})
        assert res.status_code == 201 and res.json()["lane"] is None and res.json()["day"] == today.isoformat(), (extra, res.text)
    plan = (await client.get(PIPELINES)).json()
    assert not any("old" in i["text"] or i["text"] == "ship it" for s in plan["streams"] for i in s["items"])  # no lane entries made
    assert (await client.post(ITEMS, headers=as_device, json={"text": "x", "stream": "nope"})).status_code == 422  # an unknown stream is refused


@pytest.mark.asyncio
async def test_a_login_keeps_the_day_or_lane_rule(db_client):
    client, today = db_client
    assert (await client.post(ITEMS, json={"text": "x"})).status_code == 422
    as_device = await device(client)
    assert (await client.post(ITEMS, headers=as_device, json={"text": "x", "day": today.isoformat(), "lane": "now", "stream": "studio"})).status_code == 422


def sunday_of(day):
    from app.services.rules import week_for
    return week_for(day)[0]


@pytest.mark.asyncio
async def test_capture_to_weekly_log_regression(db_client):
    """What the owner hit: a capture was not on the Plan page. The pipelines read never lists it (it has no lane); the weekly log does."""
    client, today = db_client
    as_device = await device(client)
    await add_streams(("kahf", "Kahf", False, "committed"))
    open_id = (await client.post(ITEMS, headers=as_device, json={"text": "open kahf task", "stream": "kahf", "client_id": cid()})).json()["id"]
    key = cid()
    await client.post(ITEMS, headers=as_device, json={"text": "finished kahf task", "stream": "kahf", "client_id": key})
    await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True})
    await client.post(ITEMS, headers=as_device, json={"text": "born done", "stream": "studio", "status": "done", "client_id": cid()})
    await client.post(ITEMS, headers=as_device, json={"text": "no stream", "client_id": cid()})
    plan = (await client.get(PIPELINES)).json()
    assert not any("kahf task" in i["text"] for s in plan["streams"] for i in s["items"])  # the old read: invisible
    log = (await client.get(WEEKLY)).json()
    assert log["week"] and log["start"] == sunday_of(today).isoformat() and len(log["days"]) == 7
    today_entries = next(d for d in log["days"] if d["day"] == today.isoformat())["entries"]
    by_text = {e["text"]: e for e in today_entries}
    assert by_text["open kahf task"]["on"] == "captured" and by_text["open kahf task"]["done"] is False
    assert by_text["finished kahf task"]["on"] == "done" and by_text["born done"]["stream"] == "studio"
    assert by_text["no stream"]["stream"] is None  # a capture without a stream is shown too, as Unfiled
    totals = {s["stream"]: s for s in log["streams"]}
    assert (totals["kahf"]["done"], totals["kahf"]["total"], totals["kahf"]["name"]) == (1, 2, "Kahf")
    assert (totals[None]["name"], totals[None]["done"], totals[None]["total"]) == ("Unfiled", 0, 1)
    assert log["streams"][-1]["stream"] is None  # Unfiled last
    assert totals["studio"]["done"] == 2  # "born done" and the sample account's own pipeline item finished today: pipeline items count too
    assert open_id in {e["id"] for e in today_entries}


@pytest.mark.asyncio
async def test_weekly_log_puts_a_task_on_its_finish_day_and_picks_the_week(db_client):
    client, today = db_client
    as_device = await device(client)
    await add_streams(("kahf", "Kahf", False, "committed"))
    last_week = sunday_of(today) - timedelta(days=1)  # the Saturday before this week: inside the 7-day edit window
    old_day = last_week.isoformat()
    key = cid()
    assert (await client.post(ITEMS, headers=as_device, json={"text": "old one", "stream": "kahf", "day": old_day, "client_id": key})).status_code == 201
    await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True})  # finished today, planned the week before
    here = (await client.get(WEEKLY)).json()
    assert "old one" in [e["text"] for d in here["days"] for e in d["entries"]]  # on the day it was finished
    from app.services.rules import week_for
    far = (await client.get(WEEKLY, params={"week": week_for(last_week)[2]})).json()
    assert "old one" not in [e["text"] for d in far["days"] for e in d["entries"]]
    assert (await client.get(WEEKLY, params={"week": "nonsense"})).status_code == 422
    assert (await client.get(WEEKLY, params={"week": "2026-W99"})).status_code == 422


@pytest.mark.asyncio
async def test_weekly_log_is_private_and_logins_only(db_client):
    client, _ = db_client
    as_device = await device(client)
    await add_streams(("kahf", "Kahf", False, "committed"))
    await client.post(ITEMS, headers=as_device, json={"text": "mine", "stream": "kahf", "client_id": cid()})
    as_login, theirs = await second_user_device(client)
    assert (await client.get(WEEKLY, headers=as_login)).json()["streams"] == []
    assert (await client.get(WEEKLY, headers=theirs)).status_code == 403  # a device token cannot read it
    assert (await client.get(WEEKLY, headers=as_device)).status_code == 403


@pytest.mark.asyncio
async def test_window_names_are_never_stored_or_returned(db_client):
    from sqlalchemy import inspect
    from app.models.planner import Task
    from app.models.user import DeviceCapture
    from app.schemas.vault import ItemCreateIn
    client, _ = db_client
    as_device = await device(client)
    res = await client.post(ITEMS, headers=as_device, json={"text": "t", "window_title": "Secret doc", "window": "Safari", "client_id": cid()})
    assert res.status_code == 201 and "Secret" not in res.text and "Safari" not in res.text  # ignored, not stored
    key = cid()
    await client.post(ITEMS, headers=as_device, json={"text": "u", "client_id": key})
    patched = await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True, "window_title": "Secret doc", "window_name": "Safari"})
    assert patched.status_code == 200 and "Secret" not in patched.text and "Safari" not in patched.text
    listed = await client.get(TASKS, headers=as_device, params={"include_done": True})
    assert "Secret" not in listed.text and "Safari" not in listed.text and "window" not in listed.text
    assert not [f for f in ItemCreateIn.model_fields if "window" in f]
    assert not [c.name for model in (Task, DeviceCapture) for c in inspect(model).columns if "window" in c.name]
    async with TestSession() as db:
        rows = (await db.execute(select(Task))).scalars().all()
    assert not any("Secret" in str(r.__dict__) or "Safari" in str(r.__dict__) for r in rows)


@pytest.mark.asyncio
async def test_a_task_that_became_a_week_objective_is_a_404_not_a_500(db_client):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    made = (await client.post(ITEMS, headers=as_device, json={"text": "later an objective", "client_id": key})).json()
    async with TestSession() as db:
        row = (await db.execute(select(Task).where(Task.id == made["id"]))).scalar_one()
        row.lane, row.focus_week = None, "2026-W48"  # objective-only: not an item anyone can edit
        await db.commit()
    assert (await client.patch(f"{TASKS}/{key}", headers=as_device, json={"done": True})).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", [{"deadline_at": "0001-01-01T00:00:00+06:00"}, {"deadline_at": "9999-12-31T23:59:59-06:00"},
                                 {"timer_started_at": "0001-01-01T00:00:00+06:00"}])
async def test_overflowing_date_times_are_a_422(db_client, bad):
    client, _ = db_client
    as_device = await device(client)
    key = cid()
    assert (await client.post(ITEMS, headers=as_device, json=body(client_id=cid(), **bad))).status_code == 422
    await client.post(ITEMS, headers=as_device, json=body(client_id=key))
    assert (await client.patch(f"{TASKS}/{key}", headers=as_device, json=bad)).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("week", ["9999-W52", "0001-W01", "1999-W52", "2101-W01", "2026-W00", "2026-W54", "2026-48"])
async def test_weekly_log_week_is_bounded(db_client, week):
    client, _ = db_client
    assert (await client.get(WEEKLY, params={"week": week})).status_code == 422
    assert (await client.get(WEEKLY, params={"week": "2000-W01"})).status_code == 200
    assert (await client.get(WEEKLY, params={"week": "2100-W40"})).status_code == 200


@pytest.mark.asyncio
async def test_a_device_cannot_attach_to_another_task_or_set_what_the_contract_leaves_out(db_client):
    client, today = db_client
    as_device = await device(client)
    parent = (await client.post(ITEMS, json=body(text="someone else's task"))).json()  # a login's own task
    res = await client.post(ITEMS, headers=as_device, json=body(text="piece", parent_id=parent["id"], client_id=cid(), checklist=[{"text": "a"}],
                                                                 start_min=60, end_min=120, weight=3, description="notes"))
    got = res.json()
    assert res.status_code == 201 and got["parent_id"] is None and got["checklist"] == [] and got["weight"] == 0
    assert got["all_day"] is True and got["start_min"] is None and got["description"] == "notes"  # description stays
    # another user's task id is no better
    _, theirs = await second_user_device(client)
    other = (await client.post(ITEMS, headers=theirs, json=body(text="theirs", client_id=cid()))).json()
    res = await client.post(ITEMS, headers=as_device, json=body(text="sneaky", parent_id=other["id"], client_id=cid()))
    assert res.status_code == 201 and res.json()["parent_id"] is None
