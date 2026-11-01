"""The items API: own items with times, weight, status and sub-tasks; calendar events with overlays; the range read."""
from datetime import timedelta
from pathlib import Path

import pytest
from sqlalchemy import select, text, update

from app.core.config import Settings, settings
from app.models.planner import EventOverlay, Task
from app.services import calendar_events, google_calendar
from app.services.planner_items import RECONCILE_SQL
from tests.conftest import TestSession
from tests.items_support import V, add_feed, events, ics, items, serve, tasks

FIXTURE = Path(__file__).parent / "fixtures" / "calendar.ics"


async def _post(client, day, text, **fields):
    res = await client.post(f"{V}/items", json={"day": day.isoformat(), "text": text, **fields})
    assert res.status_code == 201, res.text
    return res.json()


async def _task_row(task_id: int) -> Task:
    async with TestSession() as db:
        return (await db.execute(select(Task).where(Task.id == task_id))).scalar_one()


# --- Own items -------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_range_is_capped_at_fourteen_days(db_client):
    client, today = db_client
    assert (await client.get(f"{V}/items", params={"from": today.isoformat(), "to": (today + timedelta(days=13)).isoformat()})).status_code == 200
    for to in (today + timedelta(days=14), today - timedelta(days=1)):
        assert (await client.get(f"{V}/items", params={"from": today.isoformat(), "to": to.isoformat()})).status_code == 422
    assert (await client.get(f"{V}/items", params={"from": today.isoformat()})).status_code == 422


@pytest.mark.asyncio
async def test_quick_add_all_day_timed_and_bad_times(db_client):
    client, today = db_client
    timed = await _post(client, today, "Call the bank #money", start_min=540, end_min=600)
    assert (timed["title"], timed["products"], timed["all_day"], timed["start_min"], timed["end_min"]) == ("Call the bank", ["money"], False, 540, 600)
    assert timed["scheduled_on"] == today.isoformat() and timed["due_on"] is None and timed["status"] == "open"
    plain = await _post(client, today, "Buy milk")
    assert plain["all_day"] is True and plain["start_min"] is None
    for bad in ({"start_min": 600, "end_min": 600}, {"start_min": 540}, {"start_min": 0, "end_min": 1441}, {"start_min": -5, "end_min": 30}):
        assert (await client.post(f"{V}/items", json={"day": today.isoformat(), "text": "x", **bad})).status_code == 422, bad
    assert (await client.post(f"{V}/items", json={"day": today.isoformat(), "text": " "})).status_code == 422
    assert (await client.post(f"{V}/items", json={"day": (today + timedelta(days=400)).isoformat(), "text": "far"})).status_code == 422
    body = await items(client, today)
    assert {"Buy milk", "Call the bank"} <= {t["title"] for t in tasks(body)}
    assert [t["title"] for t in tasks(body) if not t["all_day"]] == ["Call the bank"]


@pytest.mark.asyncio
async def test_details_weight_stream_tags_notes_and_sub_tasks(db_client):
    client, today = db_client
    item = await _post(client, today, "Write report")
    url = f"{V}/items/{item['id']}"
    res = await client.patch(url, json={"weight": 3, "stream": "studio", "description": "Ask #legal first", "products": ["work"],
                                        "checklist": [{"text": "outline"}, {"text": "draft"}]})
    assert res.status_code == 200, res.text
    got = res.json()
    assert (got["weight"], got["stream"], got["products"], got["description"]) == (3, "studio", ["work", "legal"], "Ask #legal first")
    lines = got["checklist"]
    assert [(l["text"], l["done"]) for l in lines] == [("outline", False), ("draft", False)] and all(l["id"] for l in lines)
    ticked = (await client.patch(url, json={"checklist": [{**lines[0], "done": True}]})).json()["checklist"]
    assert ticked == [{**lines[0], "done": True}]  # the id survives, the removed line is gone
    assert (await client.patch(url, json={"stream": None})).json()["stream"] is None
    for bad in ({"stream": "nope"}, {"weight": 4}, {"products": [f"t{n}" for n in range(13)]}, {"description": "x" * 4001},
                {"checklist": [{"text": f"l{n}"} for n in range(51)]}, {"checklist": [{"text": "y" * 201}]}, {"status": "later"}):
        assert (await client.patch(url, json=bad)).status_code == 422, bad
    assert (await client.patch(url, json={"products": [f"t{n}" for n in range(12)]})).json()["products"][-1] == "t11"


@pytest.mark.asyncio
async def test_a_time_shows_only_on_the_scheduled_date(db_client):
    """Due Monday, scheduled Wednesday at 09:00: Monday shows it all day, Wednesday at 09:00."""
    client, today = db_client
    mon, wed = today + timedelta(days=1), today + timedelta(days=3)
    async with TestSession() as db:
        db.add(Task(user_id=1, text="Multi date", due_on=mon, scheduled_on=wed, start_min=540, end_min=600, position=50, products=[], description=""))
        await db.commit()
    body = await items(client, today, today + timedelta(days=6))
    found = [(t["day"], t["all_day"], t["start_min"]) for t in tasks(body, "Multi date")]
    assert found == [(mon.isoformat(), True, None), (wed.isoformat(), False, 540)]


@pytest.mark.asyncio
async def test_a_time_needs_a_scheduled_day_and_rescheduling_leaves_the_due_date(db_client):
    client, today = db_client
    due = next(t for t in tasks(await items(client, today)) if t["title"] == "Pay invoice")  # due today, never scheduled
    url = f"{V}/items/{due['id']}"
    res = await client.patch(url, json={"start_min": 600, "end_min": 660})
    assert res.status_code == 422 and "scheduled day" in res.json()["detail"]
    target = today + timedelta(days=2)
    moved = (await client.patch(url, json={"day": target.isoformat(), "start_min": 600, "end_min": 660})).json()
    assert (moved["scheduled_on"], moved["due_on"], moved["start_min"]) == (target.isoformat(), today.isoformat(), 600)
    cleared = (await client.patch(url, json={"start_min": None, "end_min": None})).json()
    assert cleared["all_day"] is True and (await _task_row(due["id"])).start_min is None


@pytest.mark.asyncio
async def test_delete_and_another_users_items_are_404(db_client):
    client, today = db_client
    mine = await _post(client, today, "Mine")
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    assert (await client.patch(f"{V}/items/{mine['id']}", json={"weight": 1}, headers=other)).status_code == 404
    assert (await client.delete(f"{V}/items/{mine['id']}", headers=other)).status_code == 404
    assert tasks(await items(client, today, headers=other)) == []
    await client.put(f"{V}/items/overlay", json={"key": "weekly@test", "description": "mine"})
    theirs = (await client.put(f"{V}/items/overlay", json={"key": "weekly@test", "description": "theirs"}, headers=other)).json()
    assert theirs["description"] == "theirs"
    async with TestSession() as db:
        assert sorted((await db.execute(select(EventOverlay.user_id, EventOverlay.description))).all()) == [(1, "mine"), (2, "theirs")]
    assert (await client.delete(f"{V}/items/{mine['id']}")).status_code == 204
    assert (await client.delete(f"{V}/items/{mine['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_api_tokens_get_the_same_answer_as_on_the_task_routes(db_client):
    client, today = db_client
    raw = (await client.post("/api/v1/tokens", json={"name": "mirror"})).json()["token"]
    h = {"Authorization": f"Bearer {raw}"}
    item = await _post(client, today, "Token check")
    assert (await client.get(f"{V}/day/{today}/tasks", headers=h)).status_code == 401
    calls = [client.get(f"{V}/items", params={"from": today.isoformat(), "to": today.isoformat()}, headers=h),
             client.post(f"{V}/items", json={"day": today.isoformat(), "text": "x"}, headers=h),
             client.patch(f"{V}/items/{item['id']}", json={"weight": 1}, headers=h),
             client.delete(f"{V}/items/{item['id']}", headers=h),
             client.put(f"{V}/items/overlay", json={"key": "k"}, headers=h)]
    for call in calls:
        assert (await call).status_code == 401


# --- Status and done never drift -------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_status_writes_keep_done_in_step_on_every_path(db_client):
    client, today = db_client
    item = await _post(client, today, "Status check")
    url = f"{V}/items/{item['id']}"
    skipped = (await client.patch(url, json={"status": "skipped"})).json()
    row = await _task_row(item["id"])
    assert (skipped["status"], skipped["done"], row.done, row.done_on, row.status) == ("skipped", False, False, None, "skipped")
    done = (await client.patch(url, json={"status": "done"})).json()
    row = await _task_row(item["id"])
    assert (done["done"], row.done, row.done_on, row.status) == (True, True, today, "done")
    legacy = next(t for t in (await client.get(f"{V}/day/{today}/tasks")).json() if t["line"] == item["id"])
    assert legacy["done"] is True

    # The legacy tick route writes through the same status writer.
    await client.patch(url, json={"status": "skipped"})
    assert (await client.put(f"{V}/tasks", json={"line": item["id"], "done": True})).status_code == 200
    assert tasks(await items(client, today), "Status check")[0]["status"] == "done" and (await _task_row(item["id"])).status == "done"
    await client.put(f"{V}/tasks", json={"line": item["id"], "done": False})
    row = await _task_row(item["id"])
    assert (row.done, row.status, row.done_on) == (False, "open", None)


@pytest.mark.asyncio
async def test_done_wins_when_old_code_left_status_behind_and_reconcile_fixes_the_rows(db_client):
    """The old image writes only `done`. Reads trust `done`; the reconcile SQL brings `status` back in line."""
    client, today = db_client
    ticked = await _post(client, today, "Ticked by old code")
    unticked = await _post(client, today, "Unticked by old code")
    skipped = await _post(client, today, "Skipped")
    await client.patch(f"{V}/items/{unticked['id']}", json={"status": "done"})
    await client.patch(f"{V}/items/{skipped['id']}", json={"status": "skipped"})
    async with TestSession() as db:  # what the old image's set_task_done does: done and done_on only
        await db.execute(update(Task).where(Task.id == ticked["id"]).values(done=True, done_on=today))
        await db.execute(update(Task).where(Task.id == unticked["id"]).values(done=False, done_on=None))
        await db.commit()
    shown = {t["title"]: (t["status"], t["done"]) for t in tasks(await items(client, today))}
    assert shown["Ticked by old code"] == ("done", True) and shown["Unticked by old code"] == ("open", False) and shown["Skipped"] == ("skipped", False)
    exported = {t["text"]: t["status"] for t in (await client.get("/api/v1/export")).json()["tasks"]}
    assert exported["Ticked by old code"] == "done" and exported["Unticked by old code"] == "open"
    async with TestSession() as db:
        await db.execute(text(RECONCILE_SQL))
        await db.commit()
        rows = dict((await db.execute(select(Task.text, Task.status))).all())
        done_count = len((await db.execute(select(Task.id).where(Task.done.is_(True)))).all())
        status_count = len((await db.execute(select(Task.id).where(Task.status == "done"))).all())
    assert (rows["Ticked by old code"], rows["Unticked by old code"], rows["Skipped"]) == ("done", "open", "skipped")
    assert done_count == status_count


# --- Old queries do not see overlays ------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_legacy_task_reads_return_only_own_tasks_with_overlays_present(db_client):
    client, today = db_client
    before_day = (await client.get(f"{V}/day/{today}/tasks")).json()
    before_export = (await client.get("/api/v1/export")).json()["tasks"]
    for n in range(3):
        assert (await client.put(f"{V}/items/overlay", json={"key": f"uid-{n}", "title": f"Overlay {n}", "day": today.isoformat(),
                                                             "status": "done", "description": "notes"})).status_code == 200
    assert (await client.get(f"{V}/day/{today}/tasks")).json() == before_day
    after = (await client.get("/api/v1/export")).json()
    assert [t["text"] for t in after["tasks"]] == [t["text"] for t in before_export]
    assert len(after["item_overlays"]) == 3
    async with TestSession() as db:
        overlay_ids = [r for r in (await db.execute(select(EventOverlay.id))).scalars()]
        task_ids = set((await db.execute(select(Task.id))).scalars())
    for oid in overlay_ids:  # an overlay id is never a task to the legacy routes
        if oid not in task_ids:
            assert (await client.put(f"{V}/tasks", json={"line": oid, "done": True})).status_code == 422


# --- Calendar events and overlays -------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_overlay_annotates_an_event_and_never_overrides_its_title_or_time(db_client, monkeypatch):
    client, today = db_client
    await add_feed(1, "Personal", "https://example.test/p.ics")
    serve(monkeypatch, {"p.ics": ics(today)})
    weekly = events(await items(client, today), "Weekly review")[0]
    assert (weekly["annotated"], weekly["status"], weekly["start_min"], weekly["calendar"]) == (False, "open", 540, "Personal")
    assert weekly["key"] == f"weekly@test|{today.strftime('%Y%m%d')}T090000Z"
    res = await client.put(f"{V}/items/overlay", json={"key": weekly["key"], "title": "Renamed by me", "day": weekly["day"], "calendar": "Personal",
                                                        "status": "done", "weight": 2, "stream": "shop", "description": "bring #notes",
                                                        "checklist": [{"text": "agenda"}]})
    assert res.status_code == 200 and res.json()["products"] == ["notes"]
    got = events(await items(client, today), "Weekly review")[0]
    assert (got["annotated"], got["status"], got["done"], got["weight"], got["stream"], got["title"], got["start_min"]) == (
        True, "done", True, 2, "shop", "Weekly review", 540)
    assert [l["text"] for l in got["checklist"]] == ["agenda"]
    again = (await client.put(f"{V}/items/overlay", json={"key": weekly["key"], "weight": 0})).json()
    assert again["status"] == "done" and again["weight"] == 0  # partial update
    next_week = events(await items(client, today + timedelta(days=7)), "Weekly review")[0]
    assert next_week["annotated"] is False  # one occurrence, not the series
    for bad in ({"key": ""}, {"key": "x" * 401}, {"key": "k", "status": "nope"}, {"key": "k", "stream": "nope"}):
        assert (await client.put(f"{V}/items/overlay", json=bad)).status_code == 422, bad


@pytest.mark.asyncio
async def test_notes_on_a_moved_occurrence_survive_the_move(db_client, monkeypatch):
    client, today = db_client
    await add_feed(1, "Personal", "https://example.test/p.ics")
    serve(monkeypatch, {"p.ics": ics(today)})
    second = events(await items(client, today + timedelta(days=7)), "Weekly review")[0]
    await client.put(f"{V}/items/overlay", json={"key": second["key"], "day": second["day"], "description": "prep the slides"})
    serve(monkeypatch, {"p.ics": ics(today, moved=True)})
    body = await items(client, today, today + timedelta(days=13))
    moved = events(body, "Weekly review (moved)")
    assert [(e["day"], e["start_min"], e["description"]) for e in moved] == [((today + timedelta(days=8)).isoformat(), 900, "prep the slides")]
    assert body["orphans"] == []


@pytest.mark.asyncio
async def test_the_same_uid_in_two_feeds_shares_one_overlay(db_client, monkeypatch):
    client, today = db_client
    await add_feed(1, "Work", "https://example.test/work.ics")
    await add_feed(1, "Shared", "https://example.test/shared.ics")
    serve(monkeypatch, {"work.ics": ics(today), "shared.ics": ics(today)})
    await client.put(f"{V}/items/overlay", json={"key": "once@test", "weight": 3})
    dentists = events(await items(client, today, today + timedelta(days=2)), "Dentist")
    assert sorted(e["calendar"] for e in dentists) == ["Shared", "Work"] and {e["weight"] for e in dentists} == {3}


@pytest.mark.asyncio
async def test_orphans_only_when_every_feed_was_read_and_no_feed_holds_the_uid(db_client, monkeypatch):
    client, today = db_client
    tomorrow = today + timedelta(days=1)
    await add_feed(1, "Personal", "https://example.test/p.ics")
    serve(monkeypatch, {"p.ics": ics(today)})
    await client.put(f"{V}/items/overlay", json={"key": "once@test", "title": "Dentist", "day": tomorrow.isoformat(), "calendar": "Old name",
                                                  "description": "x"})
    week = (today, today + timedelta(days=6))
    assert (await items(client, *week))["orphans"] == []  # shows (the cached calendar name does not matter)

    serve(monkeypatch, {"p.ics": ics(today, one_off_day=today + timedelta(days=40))})
    assert (await items(client, *week))["orphans"] == []  # moved out of the range: the feed still holds the UID

    serve(monkeypatch, {"p.ics": ConnectionError("down")})
    failed = await items(client, *week)
    assert failed["orphans"] == [] and failed["errors"] == ["Personal: ConnectionError"]

    serve(monkeypatch, {"p.ics": ics(today, drop_one_off=True)})
    gone = await items(client, *week)
    assert [(o["key"], o["title"], o["description"]) for o in gone["orphans"]] == [("once@test", "Dentist", "x")]
    assert (await items(client, today + timedelta(days=7)))["orphans"] == []  # outside the overlay's last-seen day
    async with TestSession() as db:
        assert len((await db.execute(select(EventOverlay))).all()) == 1  # never removed


@pytest.mark.asyncio
async def test_google_feed_range_is_one_paged_listing_and_orphans_are_checked_with_google(db_client, monkeypatch):
    from app.models.google import GoogleCredential
    client, today = db_client
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "cs")
    async with TestSession() as db:
        db.add(GoogleCredential(user_id=1, email="me@gmail.com", refresh_token="r"))
        await db.commit()
    await add_feed(1, "Personal", "https://example.test/p.ics", email="me@gmail.com")
    monkeypatch.setattr(calendar_events, "_download", lambda url: pytest.fail("the Google feed must not be read as iCal"))
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")
    when = lambda h: f"{today.isoformat()}T{h:02d}:00:00+00:00"  # noqa: E731
    pages = [{"items": [{"id": "a", "iCalUID": "a@google.com", "summary": "First", "start": {"dateTime": when(9)}, "end": {"dateTime": when(10)}}],
              "nextPageToken": "p2"},
             {"items": [{"id": "b", "iCalUID": "b@google.com", "summary": "Second", "start": {"dateTime": when(11)}, "end": {"dateTime": when(12)}}]}]
    calls = []

    def api(method, token, event_id=None, **kw):
        params = kw["params"]
        calls.append(params.get("iCalUID") or params.get("pageToken") or "list")
        if "iCalUID" in params:
            return {"items": [{"id": "x"}] if params["iCalUID"] == "moved@google.com" else []}
        return pages[1] if params.get("pageToken") else pages[0]

    monkeypatch.setattr(google_calendar, "_api", api)
    for key in ("moved@google.com", "deleted@google.com"):
        await client.put(f"{V}/items/overlay", json={"key": key, "day": today.isoformat()})
    body = await items(client, today, today + timedelta(days=13))
    assert [e["title"] for e in events(body)] == ["First", "Second"] and events(body)[0]["event_id"] == "a"
    assert calls[:2] == ["list", "p2"]  # one listing for 14 days, two pages
    assert sorted(calls[2:]) == ["deleted@google.com", "moved@google.com"]
    assert [o["key"] for o in body["orphans"]] == ["deleted@google.com"]


@pytest.mark.asyncio
async def test_the_range_read_parses_each_feed_once(db_client, monkeypatch):
    client, today = db_client
    await add_feed(1, "Personal", "https://example.test/p.ics")
    serve(monkeypatch, {"p.ics": ics(today)})
    parsed = []
    real = calendar_events.icalendar.Calendar.from_ical
    monkeypatch.setattr(calendar_events.icalendar.Calendar, "from_ical", lambda body: parsed.append(1) or real(body))
    body = await items(client, today, today + timedelta(days=13))
    assert len(parsed) == 1 and len(events(body, "Weekly review")) == 2


# --- The calendar fixture file (development and browser tests only) ---------------------------------------------

def test_the_fixture_file_is_ignored_under_production_config(tmp_path):
    path = tmp_path / "f.ics"
    path.write_bytes(b"BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
    assert calendar_events.fixture_file(Settings(_env_file=None, app_env="production", calendar_fixture_file=str(path))) is None
    assert calendar_events.fixture_feeds(Settings(_env_file=None, app_env="production", calendar_fixture_file=str(path))) is None
    assert calendar_events.fixture_file(Settings(_env_file=None, app_env="development", calendar_fixture_file=str(path))) == path
    assert calendar_events.fixture_file(Settings(_env_file=None, app_env="development")) is None


@pytest.mark.asyncio
async def test_the_fixture_file_replaces_the_feeds_in_development_only(db_client, monkeypatch):
    client, today = db_client
    calendar_events._parsed.clear()
    monkeypatch.setattr(settings, "calendar_fixture_file", str(FIXTURE))
    body = await items(client, today, today + timedelta(days=6))
    assert {e["calendar"] for e in events(body)} == {"Fixture"} and len(events(body)) >= 7
    day = (await client.get(f"{V}/day/{today}/events")).json()
    assert day["errors"] == [] and {e["calendar"] for e in day["events"]} == {"Fixture"}
    monkeypatch.setattr(settings, "app_env", "production")
    assert events(await items(client, today, today + timedelta(days=6))) == []  # production: the user's feeds (none here)
