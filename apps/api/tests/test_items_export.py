"""Item fields and event overlays through export and import: round trip, ETag, older exports, and overlays after a re-import."""
import copy
from datetime import timedelta

import pytest

from tests.items_support import V, add_feed, events, ics, items, serve

E = "/api/v1/export"
I = "/api/v1/import?replace=true"


def _normalise(snap: dict) -> dict:
    """What legitimately differs after a re-import: task and pipeline ids, the account, and feeds (exports never carry their URLs)."""
    snap = copy.deepcopy(snap)
    snap.pop("user", None)
    snap.pop("feeds", None)
    for key in ("pipeline_items", "tasks"):
        for item in snap[key]:
            item.pop("id", None)
    return snap


async def _annotated_account(client, today):
    timed = (await client.post(f"{V}/items", json={"day": today.isoformat(), "text": "Timed #focus", "start_min": 480, "end_min": 540})).json()
    await client.patch(f"{V}/items/{timed['id']}", json={"weight": 2, "status": "skipped", "description": "notes", "checklist": [{"text": "a"}, {"text": "b", "done": True}]})
    await client.put(f"{V}/items/overlay", json={"key": f"weekly@test|{today.strftime('%Y%m%d')}T090000Z", "title": "Weekly review",
                                                  "calendar": "Personal", "day": today.isoformat(), "status": "done", "weight": 1,
                                                  "stream": "studio", "description": "#prep slides", "checklist": [{"text": "agenda"}]})
    await client.put(f"{V}/items/overlay", json={"key": "once@test", "day": (today + timedelta(days=1)).isoformat(), "weight": 3})


@pytest.mark.asyncio
async def test_export_wipe_import_export_is_unchanged(db_client):
    client, today = db_client
    await _annotated_account(client, today)
    await add_feed(1, "Personal", "https://example.test/p.ics")
    exported = (await client.get(E)).json()
    timed = next(t for t in exported["tasks"] if t["text"] == "Timed")
    assert (timed["status"], timed["done"], timed["start_min"], timed["end_min"], timed["weight"], timed["products"]) == ("skipped", False, 480, 540, 2, ["focus"])
    assert [(l["text"], l["done"]) for l in timed["checklist"]] == [("a", False), ("b", True)]
    assert next(t for t in exported["tasks"] if t["text"] == "Renew domain")["status"] == "done"
    assert [(o["key"], o["status"], o["weight"]) for o in exported["item_overlays"]] == [
        ("once@test", "open", 3), (f"weekly@test|{today.strftime('%Y%m%d')}T090000Z", "done", 1)]
    assert exported["item_overlays"][1]["products"] == ["prep"]

    assert (await client.post(I, json={"version": 1})).status_code == 200  # wipe
    wiped = (await client.get(E)).json()
    assert wiped["tasks"] == [] and wiped["item_overlays"] == []
    res = await client.post(I, json=exported)
    assert res.status_code == 200 and res.json()["imported"]["item_overlays"] == 2
    assert _normalise((await client.get(E)).json()) == _normalise(exported)


@pytest.mark.asyncio
async def test_etag_changes_when_an_items_notes_change(db_client):
    client, today = db_client
    item = (await client.post(f"{V}/items", json={"day": today.isoformat(), "text": "Tagged"})).json()
    tag = (await client.get(E)).headers["etag"]
    assert (await client.get(E, headers={"If-None-Match": tag})).status_code == 304
    await client.patch(f"{V}/items/{item['id']}", json={"description": "new notes"})
    changed = await client.get(E, headers={"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["etag"] != tag
    tag = changed.headers["etag"]
    await client.put(f"{V}/items/overlay", json={"key": "k@test", "description": "event notes"})
    assert (await client.get(E, headers={"If-None-Match": tag})).status_code == 200


@pytest.mark.asyncio
async def test_an_older_export_without_status_imports_with_done_deciding(db_client):
    client, today = db_client
    d = today.isoformat()
    old = {"version": 1, "tasks": [
        {"text": "Old done", "done": True, "scheduled_on": d, "done_on": d},
        {"text": "Old open", "done": False, "scheduled_on": d},
        {"text": "New skipped", "done": False, "scheduled_on": d, "status": "skipped"},
        {"text": "Disagrees", "done": False, "scheduled_on": d, "status": "done"},
        {"text": "Done but skipped", "done": True, "scheduled_on": d, "status": "skipped"},
    ]}
    assert (await client.post(I, json=old)).status_code == 200
    shown = {t["title"]: (t["status"], t["done"], t["weight"], t["checklist"], t["all_day"]) for t in (await items(client, today))["items"]}
    assert shown == {"Old done": ("done", True, 0, [], True), "Old open": ("open", False, 0, [], True),
                     "New skipped": ("skipped", False, 0, [], True), "Disagrees": ("open", False, 0, [], True),
                     "Done but skipped": ("done", True, 0, [], True)}
    statuses = {t["text"]: t["status"] for t in (await client.get(E)).json()["tasks"]}
    assert statuses["Old done"] == "done" and statuses["Disagrees"] == "open"


@pytest.mark.asyncio
async def test_bad_item_fields_in_an_import_are_refused(db_client):
    client, today = db_client
    d = today.isoformat()
    for bad in ({"tasks": [{"text": "t", "scheduled_on": d, "start_min": 600, "end_min": 500}]},
                {"tasks": [{"text": "t", "due_on": d, "start_min": 600, "end_min": 660}]},  # a time needs scheduled_on
                {"tasks": [{"text": "t", "status": "later"}]}, {"tasks": [{"text": "t", "weight": 5}]},
                {"item_overlays": [{"key": "a"}, {"key": "a"}]}, {"item_overlays": [{"key": ""}]}):
        assert (await client.post(I, json={"version": 1, **bad})).status_code == 422, bad
    assert len((await client.get("/api/v1/vault/week")).json()["days"]) == 2  # nothing was lost


@pytest.mark.asyncio
async def test_overlays_are_not_orphaned_after_import_and_re_adding_the_feed(db_client, monkeypatch):
    """Keys carry no feed id, so annotations reattach once the user adds the same calendar again."""
    client, today = db_client
    await add_feed(1, "Personal", "https://example.test/p.ics")
    serve(monkeypatch, {"p.ics": ics(today)})
    once = events(await items(client, today, today + timedelta(days=2)), "Dentist")[0]
    await client.put(f"{V}/items/overlay", json={"key": once["key"], "day": once["day"], "title": once["title"], "description": "bring the x-ray"})
    exported = (await client.get(E)).json()
    assert exported["feeds"] == [{"name": "Personal", "host": "example.test", "color": "#123456", "email": None}]

    assert (await client.post(I, json=exported)).status_code == 200  # the feed comes back without its private URL: skipped
    after_import = await items(client, today, today + timedelta(days=2))
    assert events(after_import) == [] and after_import["orphans"] == []  # no feeds read, so nothing is claimed gone

    await add_feed(1, "Personal (re-added)", "https://example.test/p.ics")
    body = await items(client, today, today + timedelta(days=2))
    assert body["orphans"] == []
    assert [(e["description"], e["annotated"]) for e in events(body, "Dentist")] == [("bring the x-ray", True)]
