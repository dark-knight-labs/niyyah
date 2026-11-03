"""Pipeline items and week objectives as planner_tasks rows: the new abilities and the rules that keep the old outcomes.

Criterion numbers and "v3 item" numbers refer to the plan in the Phase C task (additive undated items, parent links,
invariants on generic writes to pipeline items, export/import, current-week-only objectives, folding rules).
"""
import copy
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.planner import Task
from app.services.planner_mapping import map_planning, origin_for, parse_origin
from app.services.rules import week_for
from tests.conftest import TestSession
from tests.sample_snapshot import sample_snapshot

V = "/api/v1/vault"
E, I = "/api/v1/export", "/api/v1/import?replace=true"


async def pipe(client, stream="studio"):
    data = (await client.get(f"{V}/pipelines")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["items"]


async def one(client, text, stream="studio"):
    return next(i for i in await pipe(client, stream) if i["text"] == text)


async def objectives(client):
    return {i["stream"]: i for i in (await client.get(f"{V}/objectives")).json()["items"]}


async def undated(client):
    res = await client.get(f"{V}/items/undated")
    assert res.status_code == 200, res.text
    return res.json()["items"]


async def lane_item(client, text, lane="next", stream="studio", **extra):
    res = await client.post(f"{V}/items", json={"text": text, "lane": lane, "stream": stream, **extra})
    assert res.status_code == 201, res.text
    return res.json()


async def items_on(client, day):
    res = await client.get(f"{V}/items", params={"from": day.isoformat(), "to": day.isoformat()})
    return [i for i in res.json()["items"] if i["kind"] == "task"]


async def db_rows(**where):
    async with TestSession() as db:
        return list((await db.execute(select(Task).filter_by(**where).order_by(Task.id))).scalars())


# --- criterion 4: undated items, scheduling the same row, parents --------------------------------------------------------

@pytest.mark.asyncio
async def test_a_lane_item_has_no_day_and_sits_in_the_pipeline(db_client):
    client, today = db_client
    made = await lane_item(client, "Pick a domain #dns #nov", lane="backlog")
    assert (made["lane"], made["day"], made["title"], made["products"], made["checkpoint"], made["stream"]) == ("backlog", None, "Pick a domain", ["dns"], "nov", "studio")
    row = await one(client, "Pick a domain")
    assert row["line"] == made["id"] and row["lane"] == "backlog" and row["added"] == today.isoformat() and row["checkpoint"] == "nov"
    listed = next(i for i in await undated(client) if i["id"] == made["id"])
    assert (listed["lane"], listed["pieces"], listed["origin"], listed["stream"]) == ("backlog", 0, None, "studio")
    week_start = week_for(today)[0]
    shown = [i for d in range(7) for i in await items_on(client, week_start + timedelta(days=d))]
    assert all(i["id"] != made["id"] for i in shown)  # no day: not in any range


@pytest.mark.asyncio
async def test_an_item_needs_a_day_or_a_lane_not_both_not_neither(db_client):
    client, today = db_client
    base = {"text": "x", "stream": "studio"}
    assert (await client.post(f"{V}/items", json={**base, "day": today.isoformat(), "lane": "next"})).status_code == 422
    assert (await client.post(f"{V}/items", json=base)).status_code == 422
    assert (await client.post(f"{V}/items", json={"text": "x", "lane": "next"})).status_code == 422  # a lane needs a stream
    assert (await client.post(f"{V}/items", json={**base, "lane": "done"})).status_code == 422
    assert (await client.post(f"{V}/items", json={"text": "x", "stream": "nope", "lane": "next"})).status_code == 422
    assert (await client.post(f"{V}/items", json={**base, "lane": "next", "status": "done"})).status_code == 422
    assert (await client.post(f"{V}/items", json={**base, "lane": "next", "start_min": 540, "end_min": 600})).status_code == 422  # a time needs a day
    assert (await client.post(f"{V}/items", json={"text": "plain", "day": today.isoformat()})).status_code == 201


@pytest.mark.asyncio
async def test_patching_the_day_schedules_the_same_row(db_client):
    client, today = db_client
    made = await lane_item(client, "Book the venue", lane="now")
    day = today + timedelta(days=2)
    res = await client.patch(f"{V}/items/{made['id']}", json={"day": day.isoformat()})
    assert res.status_code == 200
    body = res.json()
    assert (body["id"], body["day"], body["scheduled_on"], body["lane"], body["path"]) == (made["id"], day.isoformat(), day.isoformat(), "now", f"Calendar/Daily/{day.isoformat()}.md")
    assert (await one(client, "Book the venue"))["line"] == made["id"]  # still in its pipeline lane
    on_day = [i for i in await items_on(client, day) if i["title"] == "Book the venue"]
    assert len(on_day) == 1 and on_day[0]["id"] == made["id"] and on_day[0]["lane"] == "now"
    assert [t["line"] for t in (await client.get(f"{V}/day/{day.isoformat()}/tasks")).json() if t["text"] == "Book the venue"] == [made["id"]]
    assert all(i["id"] != made["id"] for i in await undated(client))  # it has a day now
    assert len([r for r in await db_rows() if r.text == "Book the venue"]) == 1  # no twin


@pytest.mark.asyncio
async def test_parent_links(db_client):
    client, today = db_client
    domino = await lane_item(client, "Launch the shop", lane="now")
    piece = await lane_item(client, "Write copy", parent_id=domino["id"])
    assert piece["parent_id"] == domino["id"]
    listed = {i["id"]: i for i in await undated(client)}
    assert listed[domino["id"]]["pieces"] == 1 and listed[piece["id"]]["parent_id"] == domino["id"]
    other = await lane_item(client, "Pick a theme")
    # one level: a piece has no pieces, an item with pieces is not a piece, never itself, never someone else's
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": piece["id"]})).status_code == 422
    assert (await client.patch(f"{V}/items/{domino['id']}", json={"parent_id": other["id"]})).status_code == 422
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": other["id"]})).status_code == 422
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": 99999})).status_code == 422
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    from app.models.user import User
    async with TestSession() as db:
        other_user = (await db.execute(select(User.id).where(User.email == "other@niyyah.app"))).scalar_one()
        stranger = Task(user_id=other_user, text="theirs", due_on=today)
        db.add(stranger)
        await db.commit()
        stranger_id = stranger.id
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": stranger_id})).status_code == 422  # someone else's item
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": domino["id"]})).json()["parent_id"] == domino["id"]
    assert (await client.patch(f"{V}/items/{other['id']}", json={"parent_id": None})).json()["parent_id"] is None
    # deleting the parent leaves the piece, unlinked
    assert (await client.delete(f"{V}/items/{domino['id']}")).status_code == 204
    assert next(i for i in await undated(client) if i["id"] == piece["id"])["parent_id"] is None


@pytest.mark.asyncio
async def test_undated_lists_pipeline_items_with_text_and_hides_objectives(db_client):
    client, today = db_client
    listed = await undated(client)
    texts = {i["title"] for i in listed}
    assert {"Wire the router", "Plan the DNS cutover", "Replace the switch", "Order the modem"} <= texts
    assert "Launch page" not in texts  # shop's objective has no item: it is not in the tray
    wired = next(i for i in listed if i["title"] == "Wire the router")
    assert (wired["lane"], wired["focus_week"], wired["stream"], wired["checkpoint"]) == ("now", week_for(today)[2], "studio", wired["checkpoint"])
    assert wired["checkpoint"] is not None and wired["products"] == ["Router", "Studio"]
    async with TestSession() as db:  # an item whose text is only spaces never shows
        row = (await db.execute(select(Task).where(Task.text == "Replace the switch"))).scalar_one()
        row.text = "   "
        await db.commit()
    assert "   " not in {i["title"] for i in await undated(client)} and len(await undated(client)) == len(listed) - 1


@pytest.mark.asyncio
async def test_objective_only_rows_are_not_items(db_client):
    client, today = db_client
    [objective_row] = await db_rows(stream="shop", lane=None)
    assert objective_row.objective_text == "Launch page" and objective_row.focus_week == week_for(today)[2] and objective_row.done is True
    assert (await client.patch(f"{V}/items/{objective_row.id}", json={"text": "x"})).status_code == 404
    assert (await client.delete(f"{V}/items/{objective_row.id}")).status_code == 404
    assert (await client.post(f"{V}/tasks/remove", json={"line": objective_row.id})).status_code == 422
    assert (await client.put(f"{V}/tasks", json={"line": objective_row.id, "done": False})).status_code == 422
    assert (await objectives(client))["shop"]["text"] == "Launch page"


@pytest.mark.asyncio
async def test_there_is_no_server_side_now_limit(db_client):
    client, today = db_client
    for n in range(5):
        await lane_item(client, f"now {n}", lane="now")
    assert len([i for i in await pipe(client) if i["lane"] == "now" and not i["done"]]) == 6


# --- criterion 5 and v3 item 4: every Task write path keeps the pipeline's rules ---------------------------------------------

@pytest.mark.asyncio
async def test_item_status_moves_the_lane_and_ticks_the_objective(db_client):
    client, today = db_client
    domino = await one(client, "Wire the router")
    res = await client.patch(f"{V}/items/{domino['line']}", json={"status": "done"})
    assert res.status_code == 200 and res.json()["status"] == "done" and res.json()["lane"] == "done"
    row = await one(client, "Wire the router")
    assert (row["lane"], row["done"], row["done_on"]) == ("done", True, today.isoformat())
    assert (await objectives(client))["studio"]["done"] is True  # the small domino finished: so did the objective
    await client.patch(f"{V}/items/{domino['line']}", json={"status": "open"})
    row = await one(client, "Wire the router")
    assert (row["lane"], row["done"], row["done_on"]) == ("now", False, None)
    assert (await objectives(client))["studio"]["done"] is False
    assert (await client.patch(f"{V}/items/{domino['line']}", json={"status": "skipped"})).status_code == 422
    plan = await one(client, "Plan the DNS cutover")  # a plain "open" on an open item is not a move
    await client.patch(f"{V}/items/{plan['line']}", json={"status": "open"})
    assert (await one(client, "Plan the DNS cutover"))["lane"] == "next"


@pytest.mark.asyncio
async def test_item_done_keeps_an_existing_done_on(db_client):
    client, today = db_client
    modem = await one(client, "Order the modem")  # done today already
    async with TestSession() as db:
        row = (await db.execute(select(Task).where(Task.id == modem["line"]))).scalar_one()
        row.done_on = today - timedelta(days=3)
        await db.commit()
    await client.patch(f"{V}/items/{modem['line']}", json={"status": "open"})
    await client.patch(f"{V}/items/{modem['line']}", json={"status": "done"})
    assert (await one(client, "Order the modem"))["done_on"] == today.isoformat()  # reopening cleared it; ticking stamps today


@pytest.mark.asyncio
async def test_item_stream_follows_the_pipeline_rule(db_client):
    client, today = db_client
    plan = await one(client, "Plan the DNS cutover")
    assert (await client.patch(f"{V}/items/{plan['line']}", json={"stream": "sleep"})).status_code == 422  # not a stream with a pipeline
    assert (await client.patch(f"{V}/items/{plan['line']}", json={"stream": None})).status_code == 422
    moved = await client.patch(f"{V}/items/{plan['line']}", json={"stream": "shop"})
    assert moved.status_code == 200 and (await one(client, "Plan the DNS cutover", "shop"))["lane"] == "next"
    domino = await one(client, "Wire the router")
    await lane_item(client, "shop domino", stream="shop")
    await client.put(f"{V}/pipeline/focus", json={"stream": "shop", "line": (await one(client, "shop domino", "shop"))["line"], "hash": ""})
    assert (await client.patch(f"{V}/items/{domino['line']}", json={"stream": "shop"})).status_code == 422  # shop has this week's domino
    res = await client.put(f"{V}/tasks/stream", json={"line": plan["line"], "stream": None})
    assert res.status_code == 422  # the day endpoint obeys the same rule


@pytest.mark.asyncio
async def test_deleting_a_domino_clears_the_objective_like_a_pipeline_remove(db_client):
    client, today = db_client
    domino = await one(client, "Wire the router")
    assert (await client.delete(f"{V}/items/{domino['line']}")).status_code == 204
    assert (await objectives(client))["studio"]["text"] == "" and all(i["text"] != "Wire the router" for i in await pipe(client))
    # a ticked objective survives the removal of its domino, as it did with two tables
    await client.put(f"{V}/objectives", json={"stream": "studio", "text": "Cut over DNS"})
    await client.put(f"{V}/objectives", json={"stream": "studio", "done": True})
    cut = await one(client, "Cut over DNS")
    assert (await client.post(f"{V}/tasks/remove", json={"line": cut["line"]})).status_code == 200
    assert (await objectives(client))["studio"] == {**(await objectives(client))["studio"], "text": "", "done": True}
    assert all(r.lane is not None or r.focus_week is None or r.objective_done for r in await db_rows(stream="studio"))


@pytest.mark.asyncio
async def test_renaming_a_domino_keeps_tags_and_sets_the_checkpoint(db_client):
    client, today = db_client
    domino = await one(client, "Wire the router")
    res = await client.patch(f"{V}/items/{domino['line']}", json={"text": "Wire the core router #dec"})
    assert res.status_code == 200
    row = await one(client, "Wire the core router")
    assert row["products"] == ["Router", "Studio"] and row["checkpoint"] == "dec" and row["focus"] == domino["focus"]
    assert (await objectives(client))["studio"]["text"] == "Wire the router"  # the objective's own text did not change
    await client.put(f"{V}/tasks/text", json={"line": domino["line"], "text": "Wire it #infra"})
    row = await one(client, "Wire it")
    assert row["products"] == ["infra"] and row["checkpoint"] == "dec"


@pytest.mark.asyncio
async def test_day_endpoints_on_a_scheduled_pipeline_item(db_client):
    client, today = db_client
    made = await lane_item(client, "Call the registrar", lane="now")
    day = today + timedelta(days=1)
    await client.patch(f"{V}/items/{made['id']}", json={"day": day.isoformat()})
    assert (await client.put(f"{V}/tasks", json={"line": made["id"], "done": True})).status_code == 200
    row = await one(client, "Call the registrar")
    assert (row["lane"], row["done"]) == ("done", True)  # not "lane now with done true"
    await client.put(f"{V}/tasks", json={"line": made["id"], "done": False})
    assert (await one(client, "Call the registrar"))["lane"] == "now"
    moved = day + timedelta(days=1)
    assert (await client.put(f"{V}/tasks/move", json={"line": made["id"], "from_day": day.isoformat(), "to_day": moved.isoformat()})).status_code == 200
    assert [t["line"] for t in (await client.get(f"{V}/day/{moved.isoformat()}/tasks")).json()] == [made["id"]]
    assert (await client.post(f"{V}/tasks/remove", json={"line": made["id"]})).status_code == 200
    assert all(i["text"] != "Call the registrar" for i in await pipe(client))


# --- v3 items 2 and 3: the objective's own row folds in and out ---------------------------------------------------------------

async def objective_without_item(client, stream="studio"):
    """Leave this week's objective with no pipeline item: tick the domino's objective, then remove the domino."""
    domino = (await client.get(f"{V}/pipelines")).json()
    domino = next(i for s in domino["streams"] if s["stream"] == stream for i in s["items"] if i["focus"])
    await client.put(f"{V}/objectives", json={"stream": stream, "done": True})
    await client.post(f"{V}/pipeline/remove", json={"stream": stream, "line": domino["line"], "hash": ""})
    return (await objectives(client))[stream]


@pytest.mark.asyncio
async def test_focusing_an_item_folds_in_the_objective_row(db_client):
    client, today = db_client
    left = await objective_without_item(client)
    assert (left["text"], left["done"]) == ("", True)
    assert [r.lane for r in await db_rows(stream="studio", objective_done=True)] == [None]  # alone on a row of its own
    plan = await one(client, "Plan the DNS cutover")
    res = await client.put(f"{V}/pipeline/focus", json={"stream": "studio", "line": plan["line"], "hash": ""})
    assert res.status_code == 200
    now = (await objectives(client))["studio"]
    assert (now["text"], now["done"]) == ("Plan the DNS cutover", False)  # focus rewrites the objective, as it did
    week = week_for(today)[2]
    rows = [r for r in await db_rows(stream="studio") if r.focus_week == week]
    assert [(r.id, r.lane) for r in rows] == [(plan["line"], "now")]  # the objective-only row is gone, one marker for the week


@pytest.mark.asyncio
async def test_objective_text_naming_an_open_item_links_it(db_client):
    client, today = db_client
    await objective_without_item(client)
    res = await client.put(f"{V}/objectives", json={"stream": "studio", "text": "plan the dns cutover"})
    assert res.status_code == 200
    week = week_for(today)[2]
    plan = await one(client, "Plan the DNS cutover")
    assert plan["focus"] == week and plan["lane"] == "now"
    assert (await objectives(client))["studio"]["text"] == "plan the dns cutover"  # the objective keeps what was typed
    assert len([r for r in await db_rows(stream="studio") if r.focus_week == week]) == 1


@pytest.mark.asyncio
async def test_clearing_a_ticked_objectives_text_keeps_the_tick(db_client):
    client, today = db_client
    await client.put(f"{V}/objectives", json={"stream": "studio", "done": True})
    await client.put(f"{V}/objectives", json={"stream": "studio", "text": ""})
    assert (await objectives(client))["studio"] == {**(await objectives(client))["studio"], "text": "", "done": True}
    items = await pipe(client)
    assert all(i["focus"] is None for i in items)  # the domino lost its marker, kept its place
    assert "Wire the router" in {i["text"] for i in items}
    rows = [r for r in await db_rows(stream="studio") if r.focus_week]
    assert [(r.lane, r.objective_text, r.objective_done) for r in rows] == [(None, "", True)]
    await client.put(f"{V}/objectives", json={"stream": "studio", "done": False})  # an empty, unticked objective is deleted
    assert [r for r in await db_rows(stream="studio") if r.focus_week] == []


@pytest.mark.asyncio
async def test_refocusing_keeps_the_objective_of_the_week_it_left(db_client):
    client, today = db_client
    week = week_for(today)[2]
    old = copy.deepcopy(sample_snapshot(today))
    last = week_for(today - timedelta(days=7))[2]
    old["pipeline_items"][2]["focus_week"] = last  # "Replace the switch" was last week's domino
    old["week_objectives"].append({"week": last, "stream": "studio", "text": "Last week's line", "done": True, "checkpoint": None})
    assert (await client.post(I, json=old)).status_code == 200
    switch = await one(client, "Replace the switch")
    await client.put(f"{V}/pipeline/focus", json={"stream": "studio", "line": switch["line"], "hash": ""})  # now this week's
    snap = (await client.get(E)).json()
    assert {(o["week"], o["text"]) for o in snap["week_objectives"] if o["stream"] == "studio"} == {(last, "Last week's line"), (week, "Replace the switch")}
    assert (await one(client, "Replace the switch"))["focus"] == week


# --- criterion 8: objectives are the current week's ------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_objective_edits_only_ever_touch_this_week(db_client):
    client, today = db_client
    last = week_for(today - timedelta(days=7))[2]
    snap = sample_snapshot(today)
    snap["week_objectives"].append({"week": last, "stream": "shop", "text": "Old line", "done": False, "checkpoint": None})
    await client.post(I, json=snap)
    await client.put(f"{V}/objectives", json={"stream": "shop", "text": "New line"})
    await client.put(f"{V}/objectives", json={"stream": "shop", "text": ""})
    exported = {(o["week"], o["stream"]): o for o in (await client.get(E)).json()["week_objectives"]}
    assert exported[(last, "shop")]["text"] == "Old line"  # last week's line is history
    assert (await objectives(client))["shop"]["text"] == ""


# --- criterion 6 and v3 item 8: export and import ------------------------------------------------------------------------

def _strip(snap):
    snap = copy.deepcopy(snap)
    snap.pop("user", None)
    for key in ("pipeline_items", "tasks", "planning_rows"):
        for item in snap[key]:
            item.pop("id", None)
            item.pop("parent_ref", None)
    return snap


@pytest.mark.asyncio
async def test_export_keeps_version_1_and_adds_the_full_rows(db_client):
    client, today = db_client
    snap = (await client.get(E)).json()
    assert snap["version"] == 1
    assert [t["text"] for t in snap["tasks"]] == ["Pay invoice", "Renew domain", "Future thing"]  # plain tasks only
    assert [p["text"] for p in snap["pipeline_items"]] == ["Wire the router", "Plan the DNS cutover", "Replace the switch", "Order the modem"]
    assert {(o["stream"], o["text"]) for o in snap["week_objectives"]} == {("studio", "Wire the router"), ("shop", "Launch page")}
    rows = snap["planning_rows"]
    assert len(rows) == 5 and [r["lane"] for r in rows if r["stream"] == "shop"] == [None]
    domino = next(r for r in rows if r["text"] == "Wire the router")
    assert (domino["objective_text"], domino["focus_week"], domino["lane_position"]) == ("Wire the router", week_for(today)[2], 0)
    assert all(r["origin"] is None for r in rows)  # rows made by an import carry no old id


@pytest.mark.asyncio
async def test_export_import_export_is_identical_and_keeps_pieces(db_client):
    client, today = db_client
    domino = await lane_item(client, "Launch the shop", lane="now")
    piece = await lane_item(client, "Write copy", parent_id=domino["id"])
    await client.patch(f"{V}/items/{piece['id']}", json={"day": (today + timedelta(days=1)).isoformat()})
    first = (await client.get(E)).json()
    assert next(r for r in first["planning_rows"] if r["text"] == "Write copy")["parent_ref"] == next(
        r["id"] for r in first["planning_rows"] if r["text"] == "Launch the shop")
    assert (await client.post(I, json=first)).status_code == 200
    second = (await client.get(E)).json()
    assert _strip(second) == _strip(first)
    pieces = [r for r in second["planning_rows"] if r["parent_ref"]]
    assert [r["text"] for r in pieces] == ["Write copy"] and pieces[0]["scheduled_on"] == (today + timedelta(days=1)).isoformat()
    assert [i["pieces"] for i in await undated(client) if i["title"] == "Launch the shop"] == [1]


@pytest.mark.asyncio
async def test_a_v1_snapshot_imports_as_the_migration_maps_it(db_client):
    client, today = db_client
    v1 = sample_snapshot(today)  # no planning_rows: pipeline_items and week_objectives are read
    assert "planning_rows" not in v1
    snap = (await client.get(E)).json()
    items = {r["text"]: r for r in snap["planning_rows"]}
    assert (items["Wire the router"]["objective_text"], items["Wire the router"]["focus_checkpoint"]) == ("Wire the router", v1["week_objectives"][0]["checkpoint"])
    assert items["Order the modem"]["status"] == "done" and items["Order the modem"]["done_on"] == today.isoformat()
    assert [r["lane_position"] for r in snap["planning_rows"] if r["lane"]] == [0, 1, 2, 3]
    only = next(r for r in snap["planning_rows"] if r["lane"] is None)
    assert (only["stream"], only["objective_text"], only["objective_done"], only["text"]) == ("shop", "Launch page", True, "Launch page")
    # the same function, called directly on the same data, gives the same rows
    rows, _ = map_planning(
        [{"id": None, "user_id": 1, "position": n, **{k: v for k, v in p.items() if k != "product"}} for n, p in enumerate(v1["pipeline_items"])],
        [{"id": None, "user_id": 1, **o} for o in v1["week_objectives"]])
    assert [(r["lane"], r["text"], r["objective_text"], r["lane_position"]) for r in rows] == [
        (r["lane"], r["text"], r["objective_text"], r["lane_position"]) for r in snap["planning_rows"]]


@pytest.mark.asyncio
async def test_planning_rows_win_over_the_derived_sections(db_client):
    client, today = db_client
    snap = (await client.get(E)).json()
    snap["pipeline_items"] = []
    snap["week_objectives"] = []
    assert (await client.post(I, json=snap)).status_code == 200
    assert len(await pipe(client)) == 4 and (await objectives(client))["studio"]["text"] == "Wire the router"
    dup = copy.deepcopy(snap)
    dup["planning_rows"].append({**dup["planning_rows"][0], "text": "twin"})
    res = await client.post(I, json=dup)
    assert res.status_code == 422 and "small domino" in res.json()["detail"]
    bare = {"version": 1, "planning_rows": [{"stream": "studio", "text": "x", "lane": None}]}
    assert (await client.post(I, json=bare)).status_code == 422  # a row with no lane must be an objective


@pytest.mark.asyncio
async def test_a_v1_snapshot_with_a_duplicate_marker_imports_with_one(db_client):
    client, today = db_client
    snap = sample_snapshot(today)
    twin = {**snap["pipeline_items"][1], "text": "Twin", "focus_week": snap["pipeline_items"][0]["focus_week"]}
    snap["pipeline_items"].append(twin)
    assert (await client.post(I, json=snap)).status_code == 200
    assert [i["text"] for i in await pipe(client) if i["focus"]] == ["Wire the router"]  # the lower position keeps the marker


# --- the mapping function ----------------------------------------------------------------------------------------------

def _item(id, position, focus=None, **extra):
    return {"id": id, "user_id": 1, "stream": "s", "lane": "now", "text": f"t{id}", "description": "", "products": [], "checkpoint": None, "added_on": None,
            "done_on": None, "focus_week": focus, "done": False, "blocked_by": [], "position": position, **extra}


def test_mapping_keeps_positions_and_origins_and_never_merges_state():
    rows, notes = map_planning(
        [_item(10, 5, "2026-W45"), _item(11, 2, "2026-W45"), _item(12, 7)],
        [{"id": 3, "user_id": 1, "week": "2026-W45", "stream": "s", "text": "Obj #x", "done": True, "checkpoint": "oct"},
         {"id": 4, "user_id": 1, "week": "2026-W44", "stream": "s", "text": "", "done": True, "checkpoint": None}])
    assert [r["origin"] for r in rows] == ["pipeline:10", "pipeline:11+objective:3", "pipeline:12", "objective:4"]
    assert [r["lane_position"] for r in rows] == [5, 2, 7, None]  # copied verbatim, not renumbered
    assert [r["focus_week"] for r in rows] == [None, "2026-W45", None, "2026-W44"]  # item 11 (position 2) kept the duplicate marker
    assert len(notes) == 1 and "pipeline:10" in notes[0]
    assert (rows[1]["text"], rows[1]["objective_text"], rows[1]["objective_done"], rows[1]["done"]) == ("t11", "Obj #x", True, False)
    assert parse_origin("pipeline:11+objective:3") == {"pipeline": 11, "objective": 3} and origin_for(None, None) is None


@pytest.mark.asyncio
async def test_another_account_sees_none_of_it(db_client):
    client, today = db_client
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    theirs = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get(f"{V}/items/undated", headers=theirs)).json() == {"items": []}
    mine = await one(client, "Wire the router")
    assert (await client.patch(f"{V}/items/{mine['line']}", json={"status": "done"}, headers=theirs)).status_code == 404
    assert (await client.delete(f"{V}/items/{mine['line']}", headers=theirs)).status_code == 404
    assert (await client.put(f"{V}/tasks", json={"line": mine["line"], "done": True}, headers=theirs)).status_code == 422
    assert (await one(client, "Wire the router"))["done"] is False
