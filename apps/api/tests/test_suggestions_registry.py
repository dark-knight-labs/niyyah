"""Every (entity, op) a suggestion line can do: the same result as by hand, undo, stale lines, and no write outside its scope.

Two accounts hold the same sample data. Account A takes the change as a suggestion line, account B by the route the screen
calls; the rows must match (ids and stamps aside). Run on Postgres too: TEST_DATABASE_URL=postgresql+asyncpg://...
"""
from dataclasses import dataclass
from datetime import timedelta
from typing import Awaitable, Callable

import pytest
from sqlalchemy import event

from app.services.rules import MONTHS, quarter_for, week_for
from app.services.suggestions import registry
from tests.conftest import TestSession
from tests.suggestions_support import V, apply, dump, fixed_clock, make, read, second_account, task_ids, undo, user_ids

IDS = {"cutover": "Plan the DNS cutover", "router": "Wire the router", "switch": "Replace the switch", "modem": "Order the modem",
       "renew": "Renew domain", "invoice": "Pay invoice"}


@dataclass
class World:
    client: object
    today: object
    month: str
    a: int
    b: int
    hb: dict
    ids_a: dict
    ids_b: dict


@dataclass
class Case:
    name: str
    entry: tuple[str, str]
    line: Callable[[World, dict], dict]  # (world, this account's ids) -> a suggestion line
    ui: Callable[[World, dict], Awaitable]  # the same change made by hand on account B
    disturb: Callable[[World, dict], Awaitable] | None = None  # an edit by hand that makes the line's base stale
    seed: Callable[[World], Awaitable] | None = None  # runs by hand on both accounts first
    clock: bool = False


def _item(w, ids, key):
    return ids[IDS[key]]


async def _put(w, path, body, headers=None):
    res = await w.client.put(f"{V}{path}", json=body, headers=headers)
    assert res.status_code == 200, res.text
    return res


async def _patch(w, item_id, body, headers=None):
    res = await w.client.patch(f"{V}/items/{item_id}", json=body, headers=headers)
    assert res.status_code == 200, res.text


def _checklist(*texts):
    return [{"id": f"line{i}", "text": t, "done": i == 0} for i, t in enumerate(texts)]


CASES = [
    Case("item.create lane", ("item", "create"),
         lambda w, i: {"entity": "item", "op": "create", "payload": {"text": "Draft the runbook #router", "lane": "next", "stream": "studio", "description": "steps"}},
         lambda w, i: w.client.post(f"{V}/items", json={"text": "Draft the runbook #router", "lane": "next", "stream": "studio", "description": "steps"}, headers=w.hb)),
    Case("item.create day", ("item", "create"),
         lambda w, i: {"entity": "item", "op": "create", "payload": {"text": "Call the bank", "day": (w.today + timedelta(days=1)).isoformat(), "start_min": 600, "end_min": 630}},
         lambda w, i: w.client.post(f"{V}/items", json={"text": "Call the bank", "day": (w.today + timedelta(days=1)).isoformat(), "start_min": 600, "end_min": 630}, headers=w.hb)),
    Case("item.update fields and done", ("item", "update"),
         lambda w, i: {"entity": "item", "op": "update", "target": {"id": _item(w, i, "cutover")},
                       "payload": {"text": "Plan DNS cutover v2", "description": "notes", "checklist": _checklist("one", "two"), "status": "done"}},
         lambda w, i: _patch(w, _item(w, i, "cutover"), {"text": "Plan DNS cutover v2", "description": "notes", "checklist": _checklist("one", "two"), "status": "done"}, w.hb),
         disturb=lambda w, i: _patch(w, _item(w, i, "cutover"), {"text": "Changed by hand"})),
    Case("item.update focused item done", ("item", "update"),
         lambda w, i: {"entity": "item", "op": "update", "target": {"id": _item(w, i, "router")}, "payload": {"status": "done"}},
         lambda w, i: _patch(w, _item(w, i, "router"), {"status": "done"}, w.hb),
         disturb=lambda w, i: _patch(w, _item(w, i, "router"), {"status": "done"})),
    Case("item.update parent link", ("item", "update"),
         lambda w, i: {"entity": "item", "op": "update", "target": {"id": _item(w, i, "switch")}, "payload": {"parent_id": _item(w, i, "cutover")}},
         lambda w, i: _patch(w, _item(w, i, "switch"), {"parent_id": _item(w, i, "cutover")}, w.hb),
         disturb=lambda w, i: _patch(w, _item(w, i, "switch"), {"parent_id": _item(w, i, "modem")})),
    Case("item.update unschedule", ("item", "update"),
         lambda w, i: {"entity": "item", "op": "update", "target": {"id": _item(w, i, "renew")}, "payload": {"unschedule": True}},
         lambda w, i: _patch(w, _item(w, i, "renew"), {"unschedule": True}, w.hb),
         disturb=lambda w, i: _patch(w, _item(w, i, "renew"), {"day": (w.today + timedelta(days=2)).isoformat()})),
    Case("item.update checkpoint", ("item", "update"),
         lambda w, i: {"entity": "item", "op": "update", "target": {"id": _item(w, i, "switch")}, "payload": {"checkpoint": w.month}},
         lambda w, i: _put(w, "/pipeline/checkpoint", {"stream": "studio", "line": _item(w, i, "switch"), "checkpoint": w.month}, w.hb),
         disturb=lambda w, i: _put(w, "/pipeline/checkpoint", {"stream": "studio", "line": _item(w, i, "switch"), "checkpoint": MONTHS[(MONTHS.index(w.month) + 1) % 12]})),
    Case("item.move to done", ("item", "move"),
         lambda w, i: {"entity": "item", "op": "move", "target": {"id": _item(w, i, "cutover")}, "payload": {"lane": "done"}},
         lambda w, i: _put(w, "/pipeline/move", {"stream": "studio", "line": _item(w, i, "cutover"), "lane": "done"}, w.hb),
         disturb=lambda w, i: _put(w, "/pipeline/move", {"stream": "studio", "line": _item(w, i, "cutover"), "lane": "backlog"})),
    Case("item.move the focused item to done", ("item", "move"),
         lambda w, i: {"entity": "item", "op": "move", "target": {"id": _item(w, i, "router")}, "payload": {"lane": "done"}},
         lambda w, i: _put(w, "/pipeline/move", {"stream": "studio", "line": _item(w, i, "router"), "lane": "done"}, w.hb),
         disturb=lambda w, i: _put(w, "/pipeline/move", {"stream": "studio", "line": _item(w, i, "router"), "lane": "next"})),
    Case("item.focus", ("item", "focus"),
         lambda w, i: {"entity": "item", "op": "focus", "target": {"id": _item(w, i, "cutover")}, "payload": {}},
         lambda w, i: _put(w, "/pipeline/focus", {"stream": "studio", "line": _item(w, i, "cutover")}, w.hb),
         disturb=lambda w, i: _put(w, "/pipeline/focus", {"stream": "studio", "line": _item(w, i, "cutover")})),
    Case("week_objective.update renames the small domino", ("week_objective", "update"),
         lambda w, i: {"entity": "week_objective", "op": "update", "target": {"week": week_for(w.today)[2], "stream": "studio"}, "payload": {"text": "Wire the router and test it", "done": False}},
         lambda w, i: _put(w, "/objectives", {"stream": "studio", "text": "Wire the router and test it", "done": False}, w.hb),
         disturb=lambda w, i: _put(w, "/objectives", {"stream": "studio", "text": "Edited by hand"})),
    Case("week_objective.update folds an objective-only row into a new item", ("week_objective", "update"),
         lambda w, i: {"entity": "week_objective", "op": "update", "target": {"week": week_for(w.today)[2], "stream": "shop"}, "payload": {"text": "Launch the page", "done": False}},
         lambda w, i: _put(w, "/objectives", {"stream": "shop", "text": "Launch the page", "done": False}, w.hb),
         disturb=lambda w, i: _put(w, "/objectives", {"stream": "shop", "text": "Edited by hand"})),
    Case("week_objective.update another week", ("week_objective", "update"),
         lambda w, i: {"entity": "week_objective", "op": "update", "target": {"week": week_for(w.today + timedelta(days=7))[2], "stream": "studio"}, "payload": {"text": "Next week's goal", "checkpoint": w.month}},
         lambda w, i: _put(w, "/objectives", {"stream": "studio", "week": week_for(w.today + timedelta(days=7))[2], "text": "Next week's goal", "checkpoint": w.month}, w.hb),
         disturb=lambda w, i: _put(w, "/objectives", {"stream": "studio", "week": week_for(w.today + timedelta(days=7))[2], "text": "Edited by hand"})),
    Case("log_note.create on a logged day", ("log_note", "create"),
         lambda w, i: {"entity": "log_note", "op": "create", "target": {"day": w.today.isoformat()}, "payload": {"clock": "09:15", "section": "OT", "span": "06:00-16:03", "text": "Fixed DNS"}},
         lambda w, i: w.client.post(f"{V}/day/{w.today.isoformat()}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Fixed DNS"}, headers=w.hb),
         clock=True),
    Case("log_note.create on a day with no row yet", ("log_note", "create"),
         lambda w, i: {"entity": "log_note", "op": "create", "target": {"day": (w.today - timedelta(days=3)).isoformat()}, "payload": {"clock": "09:15", "section": "OT", "span": "06:00-16:03", "text": "Back-filled"}},
         lambda w, i: w.client.post(f"{V}/day/{(w.today - timedelta(days=3)).isoformat()}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Back-filled"}, headers=w.hb),
         clock=True),
    Case("checkpoint.update", ("checkpoint", "update"),
         lambda w, i: {"entity": "checkpoint", "op": "update", "target": {"stream": "studio", "month": w.month}, "payload": {"checklist": _checklist("Router live", "Docs")}},
         lambda w, i: _put(w, "/quarter/stream", {"stream": "studio", "month_checklists": {w.month: _checklist("Router live", "Docs")}}, w.hb),
         disturb=lambda w, i: _put(w, "/quarter/stream", {"stream": "studio", "month_checklists": {w.month: _checklist("Edited by hand")}})),
    Case("quarter_objective.update", ("quarter_objective", "update"),
         lambda w, i: {"entity": "quarter_objective", "op": "update", "target": {"quarter": quarter_for(w.today)}, "payload": {"text": "A clearer objective", "arabic": "هدف"}},
         lambda w, i: _put(w, "/quarter", {"text": "A clearer objective", "arabic": "هدف"}, w.hb),
         disturb=lambda w, i: _put(w, "/quarter", {"text": "Edited by hand"})),
    Case("compass.update", ("compass", "update"),
         lambda w, i: {"entity": "compass", "op": "update", "payload": {"mission": "Serve well", "vision_horizon": "2046"}},
         lambda w, i: w.client.put("/api/v1/compass", json={"mission": "Serve well", "vision_horizon": "2046"}, headers=w.hb),
         disturb=lambda w, i: w.client.put("/api/v1/compass", json={"mission": "Edited by hand"}),
         seed=lambda w: _seed_compass(w)),
]


async def _seed_compass(w):
    for headers in (None, w.hb):
        res = await w.client.put("/api/v1/compass", json={"mission": "Old mission", "vision": "Old vision"}, headers=headers)
        assert res.status_code == 200


@pytest.fixture
async def world(db_client):
    client, today = db_client
    hb, b = await second_account(client, today)
    a = (await user_ids())[0]
    return World(client, today, MONTHS[today.month - 1], a, b, hb, await task_ids(a), await task_ids(b))


async def _ready(world, case, monkeypatch):
    if case.clock:
        fixed_clock(monkeypatch, world.today)
    if case.seed:
        await case.seed(world)
    before = await dump(world.a, keep_ids=True)
    bid = await make(world.a, [case.line(world, world.ids_a)], today=world.today)
    return before, bid


CASE_IDS = [c.name for c in CASES]


def test_every_registry_entry_has_a_case():
    assert set(registry.REGISTRY) == {
        ("item", "create"), ("item", "update"), ("item", "move"), ("item", "focus"), ("week_objective", "update"),
        ("log_note", "create"), ("checkpoint", "update"), ("quarter_objective", "update"), ("compass", "update")}, \
        "a new registry entry needs cases here (same result as by hand, undo, stale) and a place in this list"
    assert {c.entry for c in CASES} == set(registry.REGISTRY)


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
async def test_a_line_gives_the_same_rows_as_the_screen(world, monkeypatch, case):
    before, bid = await _ready(world, case, monkeypatch)
    start = await dump(world.a)
    bundle, lines = await apply(world.a, bid, world.today)
    assert bundle.status == "applied" and [l.status for l in lines] == ["applied"], [l.error for l in lines]
    res = await case.ui(world, world.ids_b)
    if res is not None:
        assert res.status_code in (200, 201), res.text
    after_a, after_b = await dump(world.a), await dump(world.b)
    assert after_a != start, "the case changes nothing: it proves nothing"
    assert after_a == after_b


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
async def test_undo_puts_back_every_row_exactly(world, monkeypatch, case):
    before, bid = await _ready(world, case, monkeypatch)
    await apply(world.a, bid, world.today)
    assert await dump(world.a, keep_ids=True) != before
    bundle, lines = await undo(world.a, bid)
    assert bundle.status == "undone" and [l.status for l in lines] == ["undone"], [l.error for l in lines]
    assert await dump(world.a, keep_ids=True) == before


@pytest.mark.parametrize("case", [c for c in CASES if c.disturb], ids=[c.name for c in CASES if c.disturb])
async def test_a_line_is_stale_when_the_data_changed_since(world, monkeypatch, case):
    before, bid = await _ready(world, case, monkeypatch)
    res = await case.disturb(world, world.ids_a)
    if res is not None:
        assert res.status_code == 200, res.text
    edited = await dump(world.a, keep_ids=True)
    bundle, lines = await apply(world.a, bid, world.today)
    assert [l.status for l in lines] == ["stale"] and bundle.status == "pending"
    assert await dump(world.a, keep_ids=True) == edited


@pytest.mark.parametrize("entry", [("item", "create"), ("log_note", "create")])
async def test_appending_lines_have_no_base_to_go_stale(entry):
    assert registry.REGISTRY[entry].compares_base is False


@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
async def test_a_line_writes_only_rows_it_declared(world, monkeypatch, case):
    """An independent check of the scope: its own session hooks record every row the apply flushes."""
    _, bid = await _ready(world, case, monkeypatch)
    bundle, lines = await read(world.a, bid)
    line = lines[0]
    entry = registry.lookup(line.entity, line.op)
    seen = {"new": [], "dirty": [], "deleted": [], "bulk": []}

    async with TestSession() as db:
        ctx = registry.Ctx(db, world.a, world.today)
        target = entry.target_model.model_validate(line.target)
        payload = entry.payload_model.model_validate(line.payload)
        declared = set(await entry.touched(ctx, target, payload, False))
        sync = db.sync_session

        def flushed(session, _):
            seen["new"] += [(o.__table__.name, o.id) for o in session.new]
            seen["dirty"] += [(o.__table__.name, o.id) for o in session.dirty if session.is_modified(o) and not o.__table__.name.startswith("suggestion_")]
            seen["deleted"] += [(o.__table__.name, o.id) for o in session.deleted]

        def execute(state):
            if state.is_update or state.is_delete:
                seen["bulk"].append(str(state.statement)[:60])

        event.listen(sync, "after_flush", flushed)
        event.listen(sync, "do_orm_execute", execute)
        from app.services import suggestions

        await suggestions.apply(db, world.a, bid, None, today=world.today)
    assert not seen["bulk"], seen["bulk"]
    allowed = declared | set(seen["new"])  # a row the line made may be changed again by the same line
    assert set(seen["dirty"]) <= allowed, set(seen["dirty"]) - allowed
    assert set(seen["deleted"]) <= allowed, set(seen["deleted"]) - allowed
    assert seen["new"] or seen["dirty"] or seen["deleted"], "nothing was written"
