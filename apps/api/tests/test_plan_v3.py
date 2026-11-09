"""Plan v3: products of a block, goal lines with a product, quarter tabs (future goals), habits linked to goals, task -> habit."""
import asyncio
from datetime import date, datetime

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.api.v1 import vault
from app.models.planner import EventOverlay, PlannerBlock, PlannerHabit, PlannerProduct, Quarter, QuarterStream, Task
from app.models.user import User
from app.services import plan_v2, tree_shadow
from tests.conftest import TestSession

V = "/api/v1/vault"
NOV = datetime(2026, 11, 9, 9, 0)


def _line(line_id, text, done=False, **extra):
    return {"id": line_id, "text": text, "done": done, **extra}


def _stream(uid, quarter, slug, name, goals, position):
    return QuarterStream(user_id=uid, quarter=quarter, slug=slug, name=name, color="violet", icon="server", slot="", weekly=True,
                         has_pipeline=True, in_note=True, goal=" · ".join(g["text"] for g in goals), goal_checklist=goals,
                         status="committed", checkpoints=[], position=position)


def _task(uid, stream, text, lane="next", position=0, **extra):
    return Task(user_id=uid, stream=stream, text=text, lane=lane, lane_position=position, done=lane == "done",
                status="done" if lane == "done" else "open", **{"products": [], "blocked_by": [], **extra})


@pytest_asyncio.fixture
async def acct(auth_client, monkeypatch):
    """One user, quarter 2026-Q4 (frozen at 2026-11-09) with blocks studio (2 goals) and fitness (1), a few tasks (the account's starter day blocks include 'soul')."""
    monkeypatch.setattr(vault, "_local_now", lambda: NOV)
    async with TestSession() as db:
        uid = (await db.execute(select(User.id))).scalar_one()
        db.add(Quarter(user_id=uid, label="2026-Q4", objective="Obj", objective_ar=""))
        db.add(_stream(uid, "2026-Q4", "studio", "Studio", [_line("g1000000", "Ship DNS"), _line("g2000000", "Launch site")], 0))
        db.add(_stream(uid, "2026-Q4", "fitness", "Fitness", [_line("f1000000", "Run 5k")], 1))
        rows = {"a": _task(uid, "studio", "Wire the router", "now", 0, products=["Router", "plain"]),
                "b": _task(uid, "studio", "Plan the cutover", "next", 1, products=["router"]),
                "c": _task(uid, "studio", "Replace the switch", "backlog", 2),
                "d": _task(uid, "fitness", "Run more", "next", 0, products=["router"])}
        db.add_all(rows.values())
        await db.commit()
        return auth_client, uid, {k: r.id for k, r in rows.items()}


async def _products(client, block=None):
    return (await client.get(f"{V}/products", params={"block": block} if block else None)).json()["products"]


async def _add(client, block, name):
    r = await client.post(f"{V}/products", json={"block": block, "name": name})
    assert r.status_code == 201, r.text
    return next(p for p in r.json()["products"] if p["name"] == " ".join(name.split()))


async def _studio(client):
    return next(s for s in (await client.get(f"{V}/pipelines")).json()["streams"] if s["stream"] == "studio")


async def _row(uid, quarter, slug):
    async with TestSession() as db:
        return (await db.execute(select(QuarterStream).where(QuarterStream.user_id == uid, QuarterStream.quarter == quarter,
                                                             QuarterStream.slug == slug))).scalar_one_or_none()


async def _tags(uid):
    async with TestSession() as db:
        return {t.text: list(t.products) for t in (await db.execute(select(Task).where(Task.user_id == uid))).scalars()}


async def _tree_equal(uid):
    async with TestSession() as db:
        return await tree_shadow.compare(db, uid)


# --- products ---------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_list_and_reject(acct):
    client, uid, _ = acct
    router = await _add(client, "studio", "  Router  ")
    assert router["slug"] == "router" and router["name"] == "Router" and router["block"] == "studio" and router["position"] == 0
    wifi = await _add(client, "studio", "Home Wi-Fi")
    assert wifi["slug"] == "home-wi-fi" and wifi["position"] == 1
    assert [p["slug"] for p in await _products(client, "studio")] == ["router", "home-wi-fi"]
    assert await _products(client, "fitness") == []
    dup = await client.post(f"{V}/products", json={"block": "studio", "name": "ROUTER"})
    assert dup.status_code == 409
    for body in ({"block": "studio", "name": "  "}, {"block": "studio", "name": "9 lives"}, {"block": "studio", "name": "x" * 61},
                 {"block": "nope", "name": "Fine"}):
        assert (await client.post(f"{V}/products", json=body)).status_code == 422, body
    # the same name can exist in another block
    assert (await client.post(f"{V}/products", json={"block": "fitness", "name": "Router"})).status_code == 201


@pytest.mark.asyncio
async def test_usage_counts_tasks_and_goals(acct):
    client, uid, _ = acct
    await _add(client, "studio", "Router")
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [
        {"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"id": "g2000000", "text": "Launch site"}]})
    router = (await _products(client, "studio"))[0]
    assert (router["tasks"], router["goals"]) == (2, 1)  # 'Router' and 'router' tags are one product; fitness's task is another block


@pytest.mark.asyncio
async def test_rename_propagates_to_tasks_overlays_and_goal_lines_of_every_quarter(acct):
    client, uid, ids = acct
    router = await _add(client, "studio", "Router")
    async with TestSession() as db:  # a later quarter's goal line, an old one's, an overlay, and a plain tag of the same name in another block
        db.add(_stream(uid, "2027-Q1", "studio", "Studio", [_line("n1000000", "Next goal", product="router")], 0))
        old = await db.get(QuarterStream, (await _row(uid, "2026-Q4", "studio")).id)
        db.add(_stream(uid, "2026-Q3", "studio", "Studio", [_line("o1000000", "Old goal", product="router")], 0))
        db.add(EventOverlay(user_id=uid, event_key="e1", stream="studio", products=["Router", "x"]))
        db.add(EventOverlay(user_id=uid, event_key="e2", stream="fitness", products=["router"]))
        await db.commit()
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [
        {"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"id": "g2000000", "text": "Launch site"}]})
    r = await client.put(f"{V}/products/{router['id']}", json={"name": "Core Router"})
    assert r.status_code == 200 and r.json()["products"][0]["slug"] == "core-router" and r.json()["products"][0]["name"] == "Core Router"
    assert await _tags(uid) == {"Wire the router": ["core-router", "plain"], "Plan the cutover": ["core-router"],
                                "Replace the switch": [], "Run more": ["router"]}  # fitness's tag is untouched
    for quarter in ("2026-Q4", "2026-Q3", "2027-Q1"):
        lines = (await _row(uid, quarter, "studio")).goal_checklist
        assert [l.get("product") for l in lines if l.get("product")] == ["core-router"], quarter
    async with TestSession() as db:
        e = {o.event_key: o.products for o in (await db.execute(select(EventOverlay))).scalars()}
    assert e == {"e1": ["core-router", "x"], "e2": ["router"]}
    assert await _tree_equal(uid) == []
    # renaming only the case keeps the slug and the tags
    r = await client.put(f"{V}/products/{router['id']}", json={"name": "CORE ROUTER"})
    assert r.json()["products"][0]["name"] == "CORE ROUTER" and r.json()["products"][0]["slug"] == "core-router"


@pytest.mark.asyncio
async def test_rename_collision_is_409_and_changes_nothing(acct):
    client, uid, _ = acct
    router = await _add(client, "studio", "Router")
    await _add(client, "studio", "Switch")
    before = await _tags(uid)
    r = await client.put(f"{V}/products/{router['id']}", json={"name": "switch"})
    assert r.status_code == 409
    assert await _tags(uid) == before and [p["slug"] for p in await _products(client, "studio")] == ["router", "switch"]
    assert (await client.put(f"{V}/products/{router['id']}", json={"name": "1st"})).status_code == 422
    assert (await client.put(f"{V}/products/999999", json={"name": "Whatever"})).status_code == 422


@pytest.mark.asyncio
async def test_delete_removes_the_tag_keeps_tasks_and_goals(acct):
    client, uid, ids = acct
    router = await _add(client, "studio", "Router")
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [
        {"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"id": "g2000000", "text": "Launch site"}]})
    r = await client.delete(f"{V}/products/{router['id']}")
    assert r.status_code == 200 and r.json()["tasks"] == 2 and r.json()["goals"] == 1 and r.json()["products"] == []
    assert await _tags(uid) == {"Wire the router": ["plain"], "Plan the cutover": [], "Replace the switch": [], "Run more": ["router"]}
    lines = (await _row(uid, "2026-Q4", "studio")).goal_checklist
    assert [l["text"] for l in lines] == ["Ship DNS", "Launch site"] and all("product" not in l for l in lines)
    assert await _tree_equal(uid) == []
    assert (await client.delete(f"{V}/products/{router['id']}")).status_code == 422  # already gone


@pytest.mark.asyncio
async def test_reorder(acct):
    client, uid, _ = acct
    a, b, c = [await _add(client, "studio", n) for n in ("Alpha", "Beta", "Gamma")]
    r = await client.put(f"{V}/products/reorder", json={"block": "studio", "ids": [c["id"], a["id"], b["id"]]})
    assert [p["slug"] for p in r.json()["products"]] == ["gamma", "alpha", "beta"]
    assert (await client.put(f"{V}/products/reorder", json={"block": "studio", "ids": [a["id"]]})).status_code == 422
    assert [p["slug"] for p in (await _studio(client))["products"]] == ["gamma", "alpha", "beta"]


@pytest.mark.asyncio
async def test_another_user_cannot_see_or_change_my_products(acct):
    client, uid, _ = acct
    router = await _add(client, "studio", "Router")
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "testpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "testpass123"})).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    assert (await client.get(f"{V}/products", headers=other)).json()["products"] == []
    assert (await client.put(f"{V}/products/{router['id']}", json={"name": "Mine"}, headers=other)).status_code == 422
    assert (await client.delete(f"{V}/products/{router['id']}", headers=other)).status_code == 422
    assert (await client.post(f"{V}/products", json={"block": "studio", "name": "X"}, headers=other)).status_code == 422  # not their block


# --- goal lines carry a product -----------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_goal_line_product_is_kept_validated_and_dropped_where_it_cannot_live(acct):
    client, uid, _ = acct
    await _add(client, "studio", "Router")
    ok = await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [
        {"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"text": "New one"}]})
    assert ok.status_code == 200
    quarter = (await client.get(f"{V}/quarter")).json()
    lines = next(s for s in quarter["streams"] if s["stream"] == "studio")["goal_checklist"]
    assert lines[0]["product"] == "router" and "product" not in lines[1] and lines[1]["id"]
    bad = await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [{"text": "x", "product": "ghost"}]})
    assert bad.status_code == 422 and "ghost" in bad.json()["detail"]
    assert [l["text"] for l in (await _row(uid, "2026-Q4", "studio")).goal_checklist] == ["Ship DNS", "New one"]  # nothing changed
    # the older endpoint keeps a valid product and drops an unknown one; month lines never carry one
    r = await client.put(f"{V}/quarter/stream", json={"stream": "studio", "goal_checklist": [
        {"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"text": "B", "product": "ghost"}],
        "month_checklists": {"nov": [{"text": "m", "product": "router"}]}})
    assert r.status_code == 200
    row = await _row(uid, "2026-Q4", "studio")
    assert [l.get("product") for l in row.goal_checklist] == ["router", None]
    assert "product" not in row.checkpoints[0]["checklist"][0]
    # ticking a line keeps its product
    await client.put(f"{V}/quarter/stream/item", json={"stream": "studio", "scope": "goal", "id": "g1000000", "done": True})
    assert (await _row(uid, "2026-Q4", "studio")).goal_checklist[0] == {"id": "g1000000", "text": "Ship DNS", "done": True, "product": "router"}
    assert await _tree_equal(uid) == []


# --- tasks: product tags --------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_task_products_are_the_tags_that_are_block_products(acct):
    client, uid, ids = acct
    await _add(client, "studio", "Router")
    await _add(client, "studio", "Switch")
    studio = await _studio(client)
    assert [p["slug"] for p in studio["products"]] == ["router", "switch"]
    ref = {"stream": "studio", "line": ids["a"], "hash": ""}
    assert (await client.put(f"{V}/pipeline/products", json={**ref, "products": ["switch"]})).status_code == 200
    # 'Router' is a product tag and is replaced; the plain tag stays
    assert (await _tags(uid))["Wire the router"] == ["plain", "switch"]
    assert (await client.put(f"{V}/pipeline/products", json={**ref, "products": []})).status_code == 200
    assert (await _tags(uid))["Wire the router"] == ["plain"]
    assert (await client.put(f"{V}/pipeline/products", json={**ref, "products": ["ghost"]})).status_code == 422
    # a tag typed in a new item that is not a product stays a plain tag; one that is a product counts as it
    await client.post(f"{V}/pipeline/studio/items", json={"texts": ["New thing #switch #loose"], "lane": "next"})
    assert (await _tags(uid))["New thing"] == ["switch", "loose"]
    # another block's task cannot be set through this block
    assert (await client.put(f"{V}/pipeline/products", json={"stream": "fitness", "line": ids["a"], "hash": "", "products": []})).status_code == 422


# --- quarter tabs and future goals ------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_quarter_tabs_and_creating_a_future_quarter_on_write_only(acct, monkeypatch):
    client, uid, _ = acct
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2026, 12, 31, 23, 0))
    data = (await client.get(f"{V}/pipelines")).json()
    assert data["quarters"] == ["2026-Q4", "2027-Q1"]  # this and the next, though 2027-Q1 has no row
    assert await _row(uid, "2027-Q1", "studio") is None  # reads create no future quarter
    async with TestSession() as db:
        assert (await db.execute(select(Quarter).where(Quarter.label == "2027-Q1"))).first() is None
    r = await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"id": "n1000000", "text": "Ship v2"}]})
    assert r.status_code == 200
    for slug in ("studio", "fitness"):  # the blocks of the latest earlier quarter came along, with empty goals
        assert await _row(uid, "2027-Q1", slug) is not None
    assert (await _row(uid, "2027-Q1", "fitness")).goal_checklist == [] and (await _row(uid, "2027-Q1", "fitness")).checkpoints == []
    assert (await _row(uid, "2027-Q1", "studio")).goal_checklist == [_line("n1000000", "Ship v2")]
    studio = await _studio(client)
    assert [q["quarter"] for q in studio["quarter_goals"]] == ["2026-Q4", "2027-Q1"]
    # idempotent: the same write again adds no rows
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"id": "n1000000", "text": "Ship v2"}]})
    async with TestSession() as db:
        assert len((await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2027-Q1"))).scalars().all()) == 2
        assert len((await db.execute(select(Quarter).where(Quarter.label == "2027-Q1"))).scalars().all()) == 1
    # the day after: 2027-01-01 the tabs move on
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2027, 1, 1, 0, 5))
    assert (await client.get(f"{V}/pipelines")).json()["quarters"] == ["2027-Q1", "2027-Q2"]
    # an earlier quarter cannot be written, a malformed label is refused
    for q in ("2026-Q4", "2027-5"):
        assert (await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": q, "goals": []})).status_code == 422
    assert await _tree_equal(uid) == []


@pytest.mark.asyncio
async def test_a_block_added_in_the_earlier_quarter_after_the_future_quarter_was_written_is_there_on_day_one(acct, monkeypatch):
    client, uid, ids = acct
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"text": "Ship v2"}]})  # written 2026-11-09
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2026, 12, 20, 9, 0))
    r = await client.post(f"{V}/quarter/stream", json={"stream": "reading", "name": "Reading", "goal_checklist": [{"text": "Ten books"}]})
    assert r.status_code == 200
    assert await _row(uid, "2027-Q1", "reading") is None
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2027, 1, 1, 0, 5))
    pipelines = (await client.get(f"{V}/pipelines")).json()
    assert [s["stream"] for s in pipelines["streams"]] == ["studio", "fitness", "reading"]  # carried on the read, goals empty
    reading = await _row(uid, "2027-Q1", "reading")
    assert reading.goal_checklist == [] and reading.name == "Reading"
    assert [l["text"] for l in (await _row(uid, "2027-Q1", "studio")).goal_checklist] == ["Ship v2"]  # the written rows are untouched
    assert (await client.put(f"{V}/plan/goals", json={"stream": "reading", "quarter": "2027-Q1", "goals": [{"text": "Twelve"}]})).status_code == 200
    async with TestSession() as db:
        assert len((await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2027-Q1"))).scalars().all()) == 3


@pytest.mark.asyncio
async def test_a_tab_appears_for_a_later_quarter_with_goals(acct):
    client, uid, _ = acct
    await client.put(f"{V}/plan/goals", json={"stream": "fitness", "quarter": "2027-Q3", "goals": [{"text": "Marathon"}]})
    assert (await client.get(f"{V}/pipelines")).json()["quarters"] == ["2026-Q4", "2027-Q1", "2027-Q3"]
    await client.put(f"{V}/plan/goals", json={"stream": "fitness", "quarter": "2027-Q3", "goals": []})  # emptied again: the tab goes
    assert (await client.get(f"{V}/pipelines")).json()["quarters"] == ["2026-Q4", "2027-Q1"]


@pytest.mark.asyncio
async def test_a_block_added_after_a_future_quarter_exists_is_copied_into_it(acct):
    client, uid, _ = acct
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"text": "x"}]})
    async with TestSession() as db:  # a block created in the current quarter later
        db.add(_stream(uid, "2026-Q4", "reading", "Reading", [_line("r1000000", "Ten books")], 2))
        await db.commit()
    assert await _row(uid, "2027-Q1", "reading") is None
    await client.put(f"{V}/plan/goals", json={"stream": "reading", "quarter": "2027-Q1", "goals": [{"text": "Twelve books"}]})
    row = await _row(uid, "2027-Q1", "reading")
    assert row.name == "Reading" and [l["text"] for l in row.goal_checklist] == ["Twelve books"] and row.position == 2
    assert (await client.put(f"{V}/plan/goals", json={"stream": "nope", "quarter": "2027-Q1", "goals": []})).status_code == 422


@pytest.mark.asyncio
async def test_two_writers_creating_the_same_future_quarter_end_with_one_set_of_rows(acct):
    client, uid, _ = acct

    async def writer():
        async with TestSession() as db:
            await plan_v2.ensure_block_in_quarter(db, uid, "studio", "2027-Q1", date(2026, 11, 9))
            await db.commit()

    await asyncio.gather(writer(), writer(), return_exceptions=True)
    await writer()
    async with TestSession() as db:
        rows = (await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2027-Q1"))).scalars().all()
        assert sorted(r.slug for r in rows) == ["fitness", "studio"]
        assert len((await db.execute(select(Quarter).where(Quarter.label == "2027-Q1"))).scalars().all()) == 1


@pytest.mark.asyncio
async def test_task_goal_picker_allows_current_and_later_goals_and_keeps_an_old_ref(acct, monkeypatch):
    client, uid, ids = acct
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"id": "n1000000", "text": "Ship v2"}]})
    ref = {"stream": "studio", "line": ids["a"], "hash": ""}
    for goal, code in (("g1000000", 200), ("n1000000", 200), ("nope0000", 422)):
        assert (await client.put(f"{V}/pipeline/goal", json={**ref, "goal_ref": goal})).status_code == code, goal
    assert (await client.put(f"{V}/pipeline/goal", json={"stream": "fitness", "line": ids["d"], "hash": "", "goal_ref": "n1000000"})).status_code == 422
    # the new quarter starts: the task's Q4 ref is no longer pickable by others but stays accepted for the task that has it
    await client.put(f"{V}/pipeline/goal", json={**ref, "goal_ref": "g1000000"})
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2027, 1, 4, 9, 0))
    assert (await client.put(f"{V}/pipeline/goal", json={**ref, "goal_ref": "g1000000"})).status_code == 200
    other = {"stream": "studio", "line": ids["b"], "hash": ""}
    assert (await client.put(f"{V}/pipeline/goal", json={**other, "goal_ref": "g1000000"})).status_code == 422
    assert (await client.put(f"{V}/pipeline/goal", json={**other, "goal_ref": "n1000000"})).status_code == 200


# --- habits linked to goals ---------------------------------------------------------------------------------------------------

async def _habit(client, **extra):
    r = await client.post(f"{V}/habits", json={"name": "Walk", "block": "soul", "stream": "studio", **extra})
    assert r.status_code == 200, r.text
    return r.json()["habits"][-1]


@pytest.mark.asyncio
async def test_habit_goal_set_clear_validate(acct):
    client, uid, _ = acct
    h = await _habit(client)
    assert h["goal_ref"] is None
    r = await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "g1000000"})
    assert r.status_code == 200 and r.json()["habits"][0]["goal_ref"] == "g1000000"
    assert (await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "f1000000"})).status_code == 422  # another block's goal
    assert (await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "nope0000"})).status_code == 422
    assert (await client.get(f"{V}/habits")).json()["habits"][0]["goal_ref"] == "g1000000"
    # a later quarter's goal is fine
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"id": "n1000000", "text": "Ship v2"}]})
    assert (await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "n1000000"})).status_code == 200
    cleared = await client.put(f"{V}/habits/{h['id']}", json={"clear_goal": True})
    assert cleared.json()["habits"][0]["goal_ref"] is None
    # a goal needs the habit's block; moving the habit to another block drops its goal
    await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "g1000000"})
    moved = await client.put(f"{V}/habits/{h['id']}", json={"stream": "fitness"})
    assert moved.json()["habits"][0]["goal_ref"] is None
    loose = await client.post(f"{V}/habits", json={"name": "Read", "block": "soul"})
    assert (await client.put(f"{V}/habits/{loose.json()['habits'][-1]['id']}", json={"goal_ref": "g1000000"})).status_code == 422
    assert (await client.post(f"{V}/habits", json={"name": "Bad", "block": "soul", "stream": "studio", "goal_ref": "zzzz0000"})).status_code == 422


@pytest.mark.asyncio
async def test_habit_keeps_its_goal_when_the_quarter_ends_and_can_be_relinked(acct, monkeypatch):
    client, uid, _ = acct
    h = await _habit(client, goal_ref="g1000000")
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2027-Q1", "goals": [{"id": "n1000000", "text": "Ship v2"}]})
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2027, 1, 4, 9, 0))
    studio = await _studio(client)
    assert studio["ended_goals"] == [{"id": "g1000000", "text": "Ship DNS", "quarter": "2026-Q4"}]  # named so the page can mark it ended
    assert next(x for x in (await client.get(f"{V}/habits")).json()["habits"] if x["id"] == h["id"])["goal_ref"] == "g1000000"
    # editing something else about the habit keeps the ended goal
    assert (await client.put(f"{V}/habits/{h['id']}", json={"per_week": 4})).json()["habits"][0]["goal_ref"] == "g1000000"
    # re-link to a 2027-Q1 goal
    relinked = await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "n1000000"})
    assert relinked.status_code == 200 and relinked.json()["habits"][0]["goal_ref"] == "n1000000"
    assert (await _studio(client))["ended_goals"] == []
    # an ended goal cannot be picked fresh
    assert (await client.put(f"{V}/habits/{h['id']}", json={"goal_ref": "g2000000"})).status_code == 422


@pytest.mark.asyncio
async def test_a_habit_with_only_a_day_block_that_is_a_plan_block_belongs_to_it(acct):
    client, uid, _ = acct
    async with TestSession() as db:
        db.add(_stream(uid, "2026-Q4", "body", "Body", [_line("b1000000", "Lift")], 2))
        db.add_all([PlannerHabit(user_id=uid, name="Gym", block="body", started_on=date(2026, 11, 1)),
                    PlannerHabit(user_id=uid, name="Focus", block="onething", started_on=date(2026, 11, 1))])
        await db.commit()
    habits = {h["name"]: h for h in (await client.get(f"{V}/habits")).json()["habits"]}
    assert (habits["Gym"]["stream"], habits["Gym"]["plan_block"]) == (None, "body")
    assert habits["Focus"]["plan_block"] is None  # 'onething' is a day block, not a Plan block: it stays on the Habits board only
    r = await client.put(f"{V}/habits/{habits['Gym']['id']}", json={"goal_ref": "b1000000"})
    assert r.status_code == 200
    gym = next(h for h in r.json()["habits"] if h["name"] == "Gym")
    assert (gym["goal_ref"], gym["stream"], gym["plan_block"]) == ("b1000000", "body", "body")  # linking names the Plan block
    assert (await client.put(f"{V}/habits/{gym['id']}", json={"goal_ref": "g1000000"})).status_code == 422  # another block's goal
    refused = await client.put(f"{V}/habits/{habits['Focus']['id']}", json={"goal_ref": "b1000000"})
    assert refused.status_code == 422 and "not in a Plan block" in refused.json()["detail"]
    assert next(h for h in (await client.get(f"{V}/habits")).json()["habits"] if h["name"] == "Focus")["stream"] is None
    # the ended goal shows for it after the quarter turns
    assert (await _studio(client))["ended_goals"] == []


@pytest.mark.asyncio
async def test_a_habit_cannot_keep_a_goal_into_another_plan_block(acct):
    client, uid, _ = acct
    h = await _habit(client, goal_ref="g1000000")
    # the same ref sent while the Plan block changes in the same request is checked against the new block
    r = await client.put(f"{V}/habits/{h['id']}", json={"stream": "fitness", "goal_ref": "g1000000"})
    assert r.status_code == 422
    assert next(x for x in (await client.get(f"{V}/habits")).json()["habits"] if x["id"] == h["id"])["stream"] == "studio"
    ok = await client.put(f"{V}/habits/{h['id']}", json={"stream": "fitness", "goal_ref": "f1000000"})
    assert ok.status_code == 200 and ok.json()["habits"][0]["goal_ref"] == "f1000000"


@pytest.mark.asyncio
async def test_a_stale_product_on_a_goal_line_is_dropped_not_refused_but_a_new_unknown_one_is(acct):
    client, uid, _ = acct
    await _add(client, "studio", "Router")
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [{"id": "g1000000", "text": "Ship DNS", "product": "router"}]})
    async with TestSession() as db:  # the product row disappears (e.g. a revert) while the line still carries it
        row = (await db.execute(select(PlannerProduct))).scalar_one()
        await db.delete(row)
        await db.commit()
    ok = await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [{"id": "g1000000", "text": "Ship DNS", "product": "router"}, {"text": "More"}]})
    assert ok.status_code == 200
    assert all("product" not in l for l in (await _row(uid, "2026-Q4", "studio")).goal_checklist)
    bad = await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [{"text": "New", "product": "router"}]})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_product_counts_include_event_annotations_and_task_tags_are_capped(acct):
    client, uid, ids = acct
    router = await _add(client, "studio", "Router")
    async with TestSession() as db:
        db.add(EventOverlay(user_id=uid, event_key="e1", stream="studio", products=["router"]))
        await db.commit()
    assert (await _products(client, "studio"))[0]["tasks"] == 3  # two tasks and one event
    assert (await client.delete(f"{V}/products/{router['id']}")).json()["tasks"] == 3
    await _add(client, "studio", "Alpha")
    async with TestSession() as db:
        t = await db.get(Task, ids["c"])
        t.products = [f"t{n}" for n in range(12)]
        await db.commit()
    r = await client.put(f"{V}/pipeline/products", json={"stream": "studio", "line": ids["c"], "hash": "", "products": ["alpha"]})
    assert r.status_code == 422 and "at most 12 tags" in r.json()["detail"]
    assert len((await _tags(uid))["Replace the switch"]) == 12


# --- task -> habit ---------------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_make_a_habit_from_a_task_creates_and_deletes_in_one_transaction(acct):
    client, uid, ids = acct
    await client.put(f"{V}/pipeline/goal", json={"stream": "studio", "line": ids["b"], "hash": "", "goal_ref": "g2000000"})
    r = await client.post(f"{V}/pipeline/to-habit", json={"stream": "studio", "line": ids["b"], "hash": ""})
    assert r.status_code == 200
    body = r.json()
    habit = next(h for h in body["habits"] if h["id"] == body["habit_id"])
    assert (habit["name"], habit["stream"], habit["per_week"], habit["stage"], habit["goal_ref"], habit["block"]) == \
        ("Plan the cutover", "studio", 3, "installing", "g2000000", "soul")
    assert habit["started_on"] == "2026-11-09"
    assert "Plan the cutover" not in await _tags(uid)
    # short details become the habit's minimum
    async with TestSession() as db:
        db.add(_task(uid, "studio", "With notes", "next", 6, description="Five minutes of stretching"))
        await db.commit()
    line = next(i for i in (await _studio(client))["items"] if i["text"] == "With notes")
    assert line["subtasks"] == 0
    body = (await client.post(f"{V}/pipeline/to-habit", json={"stream": "studio", "line": line["line"], "hash": ""})).json()
    assert next(h for h in body["habits"] if h["id"] == body["habit_id"])["minimum"] == "Five minutes of stretching"
    # a task nested under an ended goal gives a habit with no goal
    async with TestSession() as db:
        db.add(_task(uid, "studio", "Old nest", "next", 5, goal_ref="old00000"))
        await db.commit()
    line = next(i for i in (await _studio(client))["items"] if i["text"] == "Old nest")["line"]
    body = (await client.post(f"{V}/pipeline/to-habit", json={"stream": "studio", "line": line, "hash": ""})).json()
    assert next(h for h in body["habits"] if h["id"] == body["habit_id"])["goal_ref"] is None


@pytest.mark.asyncio
async def test_make_a_habit_is_atomic_when_the_habit_cannot_be_made(acct):
    client, uid, ids = acct
    async with TestSession() as db:
        for b in (await db.execute(select(PlannerBlock))).scalars():
            b.archived = True  # no day block to put the habit in
        await db.commit()
    r = await client.post(f"{V}/pipeline/to-habit", json={"stream": "studio", "line": ids["b"], "hash": ""})
    assert r.status_code == 422
    assert "Plan the cutover" in await _tags(uid)  # the task is still there
    async with TestSession() as db:
        assert (await db.execute(select(PlannerHabit))).first() is None
    assert (await client.post(f"{V}/pipeline/to-habit", json={"stream": "studio", "line": 99999, "hash": ""})).status_code == 422


# --- export / import ------------------------------------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_export_import_round_trip_keeps_products_goal_products_and_habit_goals(acct):
    client, uid, _ = acct
    await _add(client, "studio", "Router")
    await _add(client, "studio", "Switch")
    await client.put(f"{V}/plan/goals", json={"stream": "studio", "quarter": "2026-Q4", "goals": [
        {"id": "g1000000", "text": "Ship DNS", "product": "switch"}, {"id": "g2000000", "text": "Launch site"}]})
    await _habit(client, goal_ref="g1000000")
    snap = (await client.get("/api/v1/export")).json()
    assert [(p["block"], p["slug"], p["name"], p["position"]) for p in snap["products"]] == [("studio", "router", "Router", 0), ("studio", "switch", "Switch", 1)]
    assert snap["habits"][0]["goal_ref"] == "g1000000"
    assert next(s for s in snap["quarters"][0]["streams"] if s["slug"] == "studio")["goal_checklist"][0]["product"] == "switch"
    assert (await client.post("/api/v1/import?replace=true", json=snap)).status_code == 200
    assert (await client.get("/api/v1/export")).json()["products"] == snap["products"]
    assert [p["slug"] for p in await _products(client, "studio")] == ["router", "switch"]
    assert (await client.get(f"{V}/habits")).json()["habits"][0]["goal_ref"] == "g1000000"
    assert (await _row(uid, "2026-Q4", "studio")).goal_checklist[0]["product"] == "switch"
    assert await _tree_equal(uid) == []


@pytest.mark.asyncio
async def test_import_refuses_a_goal_line_product_that_is_not_listed(acct):
    client, uid, _ = acct
    await _add(client, "studio", "Router")
    snap = (await client.get("/api/v1/export")).json()
    snap["quarters"][0]["streams"][0]["goal_checklist"][0]["product"] = "ghost"
    r = await client.post("/api/v1/import?replace=true", json=snap)
    assert r.status_code == 422 and "ghost" in r.text
    assert [p["slug"] for p in await _products(client, "studio")] == ["router"]  # nothing changed
    snap["quarters"][0]["streams"][0]["goal_checklist"][0]["product"] = None
    snap["products"].append(dict(snap["products"][0]))
    assert (await client.post("/api/v1/import?replace=true", json=snap)).status_code == 422  # a product twice
    del snap["products"]  # an older file: the account's products stay
    snap["quarters"][0]["streams"][0]["goal_checklist"][0].pop("product", None)
    assert (await client.post("/api/v1/import?replace=true", json=snap)).status_code == 200
    assert [p["slug"] for p in await _products(client, "studio")] == ["router"]
