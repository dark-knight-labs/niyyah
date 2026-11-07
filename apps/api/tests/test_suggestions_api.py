"""Suggestions end to end: who may use them, limits, refs, failure, undo guards, the checks hook.

The per-entry rules (same rows as by hand, undo, stale) are in test_suggestions_registry.py."""
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, func, select

from app.core.plugins import suggestion_checks
from app.main import create_app
from app.models.board import Board, BoardEdge, BoardNode
from app.models.compass import Compass
from app.models.planner import Task
from app.services import suggestions
from app.services.rules import week_for
from tests.conftest import ON_POSTGRES, TestSession
from tests.suggestions_support import V, apply, dump, make, read, second_account, task_ids, undo, user_ids

S = "/api/v1/suggestions"
NOTE = {"entity": "log_note", "op": "create", "target": {"day": "2026-01-01"}, "payload": {"clock": "09:15", "section": "OT", "span": "06:00-16:03", "text": "x"}}


@pytest.fixture(autouse=True)
def no_registered_checks():
    """create_app registers its plugins' checks globally (the last app wins): start and end every test with none."""
    suggestions.set_checks([])
    yield
    suggestions.set_checks([])


@pytest.fixture
async def ctx(db_client):
    client, today = db_client
    return client, today, (await user_ids())[0]


def note(today, text="Fixed DNS"):
    return {**NOTE, "target": {"day": today.isoformat()}, "payload": {**NOTE["payload"], "text": text}}


def compass(**fields):
    return {"entity": "compass", "op": "update", "payload": fields}


def create_item(text, ref=None, **payload):
    return {"entity": "item", "op": "create", "ref": ref, "payload": {"text": text, "lane": "next", "stream": "studio", **payload}}


# --- Who may use it ------------------------------------------------------------------------------------------------

ROUTES = [("get", S), ("get", f"{S}/1"), ("post", S), ("post", f"{S}/1/apply"), ("post", f"{S}/1/reject"), ("post", f"{S}/1/undo")]


@pytest.mark.parametrize("method,path", ROUTES)
async def test_no_login_is_401(client, method, path):
    res = await getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert res.status_code == 401


@pytest.mark.parametrize("method,path", ROUTES)
async def test_an_api_token_is_401_everywhere(ctx, client, method, path):
    http, _, _ = ctx
    token = (await http.post("/api/v1/tokens", json={"name": "mirror"})).json()["token"]
    res = await getattr(client, method)(path, headers={"Authorization": f"Bearer {token}"}, **({"json": {}} if method == "post" else {}))
    assert res.status_code == 401


async def test_the_owner_writes_a_bundle_and_the_source_is_always_the_owner(ctx):
    http, today, uid = ctx
    body = {"title": "Tidy up", "reason": "Fewer open ends", "source": "somebody-else", "lines": [compass(mission="Serve")]}
    res = await http.post(S, json=body)
    assert res.status_code == 201, res.text
    assert res.json()["source"] == "owner" and res.json()["status"] == "pending"
    with pytest.raises(suggestions.SuggestionError):  # code cannot claim to be the owner
        async with TestSession() as db:
            await suggestions.create(db, uid, "owner", "T", "R", [compass(mission="x")], today=today)


async def test_other_users_do_not_see_a_bundle(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="mine")], today=today)
    headers, other = await second_account(http, today)
    assert (await http.get(f"{S}/{bid}", headers=headers)).status_code == 404
    assert (await http.post(f"{S}/{bid}/apply", json={}, headers=headers)).status_code == 404
    assert (await http.get(S, headers=headers)).json() == {"pending": 0, "items": []}
    assert (await http.get(S)).json()["pending"] == 1


async def test_a_line_cannot_name_another_users_item(ctx):
    http, today, uid = ctx
    _, other = await second_account(http, today)
    theirs = (await task_ids(other))["Plan the DNS cutover"]
    with pytest.raises(suggestions.SuggestionError, match="target was not found"):
        await make(uid, [{"entity": "item", "op": "update", "target": {"id": theirs}, "payload": {"text": "hijack"}}], today=today)


# --- Limits and shapes ---------------------------------------------------------------------------------------------

async def test_limits(ctx):
    http, today, uid = ctx
    assert (await http.post(S, json={"title": "t", "lines": [compass(mission="x")] * 41})).status_code == 422
    assert (await http.post(S, json={"title": "t", "lines": []})).status_code == 422
    assert (await http.post(S, json={"title": "x" * 201, "lines": [compass(mission="x")]})).status_code == 422
    for n in range(30):
        await make(uid, [compass(mission=f"m{n}")], today=today)
    res = await http.post(S, json={"title": "one too many", "lines": [compass(mission="x")]})
    assert res.status_code == 422 and "30" in res.json()["detail"]
    bid = (await http.get(S, params={"status": "pending"})).json()["items"][0]["id"]
    await http.post(f"{S}/{bid}/reject")
    assert (await http.post(S, json={"title": "room again", "lines": [compass(mission="x")]})).status_code == 201


@pytest.mark.parametrize("line,why", [
    ({"entity": "compass", "op": "delete"}, "unknown change"),
    ({"entity": "compass", "op": "update", "payload": {"mission": "x" * 1001}}, "payload"),
    ({"entity": "compass", "op": "update", "payload": {"mission": "x", "extra": 1}}, "payload"),
    ({"entity": "compass", "op": "update", "payload": {}}, "payload"),
    ({"entity": "log_note", "op": "create", "target": {"day": "2026-01-01"}, "payload": {"clock": "9:5", "section": "a", "span": "b", "text": "c"}}, "clock"),
    ({"entity": "item", "op": "create", "payload": {"text": "t"}}, "payload"),
    ({"entity": "item", "op": "create", "payload": {"text": "t", "lane": "next", "day": "2026-01-01"}}, "payload"),
    ({"entity": "item", "op": "update", "target": {"id": 1, "ref": "a"}, "payload": {"text": "t"}}, "target"),
    ({"entity": "item", "op": "update", "target": {"id": 1}, "payload": {"day": "2026-01-01", "unschedule": True}}, "payload"),
    ({"entity": "week_objective", "op": "update", "target": {"week": "26-W1", "stream": "studio"}, "payload": {"text": "t"}}, "target"),
])
async def test_a_bad_line_is_refused_with_its_number(ctx, line, why):
    http, _, _ = ctx
    res = await http.post(S, json={"title": "t", "lines": [compass(mission="ok"), line]})
    assert res.status_code == 422, res.text
    assert "line 2" in res.text or "lines" in res.text


async def test_the_base_must_have_the_fields_the_entry_reads(ctx):
    http, today, uid = ctx
    with pytest.raises(suggestions.SuggestionError, match="base must have"):
        await make(uid, [{**compass(mission="x"), "base": {"vision": ""}}], today=today)
    bid = await make(uid, [{**compass(mission="x"), "base": {"mission": ""}}], today=today)
    assert (await read(uid, bid))[1][0].base == {"mission": ""}


# --- Status rules --------------------------------------------------------------------------------------------------

async def test_apply_some_lines_is_partly_applied_and_the_rest_skipped(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="one"), note(today, "two"), compass(vision="three")], today=today)
    bundle, lines = await apply(uid, bid, today, [1, 3])
    assert bundle.status == "partly_applied" and [l.status for l in lines] == ["applied", "skipped", "applied"]
    assert bundle.decided_at is not None


async def test_the_state_machine(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="one")], today=today)
    assert (await http.post(f"{S}/{bid}/undo")).status_code == 409  # nothing applied yet
    assert (await http.post(f"{S}/{bid}/apply", json={"lines": [9]})).status_code == 422
    assert (await http.post(f"{S}/{bid}/apply", json={"lines": []})).status_code == 422
    assert (await http.post(f"{S}/{bid}/apply")).json()["status"] == "applied"  # a body is optional: all lines
    assert (await http.post(f"{S}/{bid}/apply")).status_code == 409
    assert (await http.post(f"{S}/{bid}/reject")).status_code == 409
    assert (await http.post(f"{S}/{bid}/undo")).json()["status"] == "undone"
    assert (await http.post(f"{S}/{bid}/undo")).status_code == 409
    other = await make(uid, [compass(mission="two")], today=today)
    assert (await http.post(f"{S}/{other}/reject")).json()["status"] == "rejected"
    assert (await http.post(f"{S}/{other}/apply")).status_code == 409


async def test_undo_works_for_seven_days(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="one")], today=today)
    await apply(uid, bid, today)
    _, _ = await read(uid, bid)
    with pytest.raises(suggestions.Conflict):
        await undo(uid, bid, now=datetime.now(timezone.utc) + timedelta(days=8))
    bundle, _ = await undo(uid, bid, now=datetime.now(timezone.utc) + timedelta(days=6))
    assert bundle.status == "undone"


async def test_undo_until_is_shown_while_it_is_possible(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="one")], today=today)
    assert (await http.get(f"{S}/{bid}")).json()["undo_until"] is None
    res = (await http.post(f"{S}/{bid}/apply")).json()
    assert res["undo_until"] and res["lines"][0]["status"] == "applied" and "inverse" not in res["lines"][0]


# --- Refs ----------------------------------------------------------------------------------------------------------

async def test_a_line_can_point_at_an_item_an_earlier_line_creates(ctx):
    http, today, uid = ctx
    lines = [create_item("Parent step", ref="P"), create_item("Child step", ref="C", parent_ref="P"),
             {"entity": "item", "op": "update", "target": {"ref": "P"}, "payload": {"description": "made first"}}]
    bid = await make(uid, lines, today=today)
    bundle, got = await apply(uid, bid, today)
    assert bundle.status == "applied" and got[0].created_key["id"]
    async with TestSession() as db:
        parent = (await db.execute(select(Task).where(Task.text == "Parent step"))).scalar_one()
        child = (await db.execute(select(Task).where(Task.text == "Child step"))).scalar_one()
    assert child.parent_id == parent.id and parent.description == "made first"
    before = await dump(uid, keep_ids=True)
    await undo(uid, bid)
    assert await dump(uid, keep_ids=True) != before
    async with TestSession() as db:
        assert (await db.execute(select(func.count(Task.id)).where(Task.text.in_(["Parent step", "Child step"])))).scalar_one() == 0


async def test_refs_are_checked_when_the_bundle_is_made_and_when_lines_are_picked(ctx):
    http, today, uid = ctx
    update = {"entity": "item", "op": "update", "target": {"ref": "P"}, "payload": {"description": "d"}}
    with pytest.raises(suggestions.SuggestionError, match="not made by an earlier line"):
        await make(uid, [update, create_item("Late", ref="P")], today=today)
    with pytest.raises(suggestions.SuggestionError, match="used twice"):
        await make(uid, [create_item("A", ref="P"), create_item("B", ref="P")], today=today)
    with pytest.raises(suggestions.SuggestionError, match="only an item.create"):
        await make(uid, [{**compass(mission="x"), "ref": "P"}], today=today)
    bid = await make(uid, [create_item("Only", ref="P"), update], today=today)
    with pytest.raises(suggestions.SuggestionError, match="line 2 needs line 1"):
        await apply(uid, bid, today, [2])
    assert (await apply(uid, bid, today, [1, 2]))[0].status == "applied"


# --- A failing line ------------------------------------------------------------------------------------------------

async def test_a_failing_line_rolls_everything_back_and_is_marked_failed(ctx):
    """Includes the compass service: it used to commit by itself, so a line before a failing one would have stuck."""
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="Should not stick"), create_item("Nowhere", stream="no-such-stream"), note(today)], today=today)
    before = await dump(uid, keep_ids=True)
    res = await http.post(f"{S}/{bid}/apply")
    assert res.status_code == 422 and "no-such-stream" in res.json()["detail"]
    assert await dump(uid, keep_ids=True) == before
    bundle, lines = await read(uid, bid)
    assert bundle.status == "pending" and [l.status for l in lines] == ["pending", "failed", "pending"]
    assert "no-such-stream" in lines[1].error
    async with TestSession() as db:
        assert (await db.execute(select(func.count(Compass.id)))).scalar_one() == 0
    # picking only the good lines still works afterwards
    assert (await apply(uid, bid, today, [1, 3]))[0].status == "partly_applied"


async def test_a_unique_rule_broken_by_a_change_made_meanwhile_fails_the_line(ctx, monkeypatch):
    """FOR UPDATE cannot lock a row that does not exist yet: a week marker typed at the same time hits the unique index."""
    http, today, uid = ctx
    week = week_for(today + timedelta(days=14))[2]
    from app.services import planner_work

    real, state = planner_work._week_row, {"raced": False}

    async def racing(db, user_id, stream, wk):
        found = await real(db, user_id, stream, wk)
        if found is None and not state["raced"]:  # the other request's row lands after our lookup, before our insert
            state["raced"] = True
            async with TestSession() as other:
                other.add(planner_work._objective_row(user_id, stream, wk, "Typed at the same time", False, None))
                await other.commit()
        return found

    monkeypatch.setattr(planner_work, "_week_row", racing)
    line = {"entity": "week_objective", "op": "update", "target": {"week": week, "stream": "studio"}, "payload": {"text": "Mine"}}
    bid = await make(uid, [line], today=today)
    before = await dump(uid, keep_ids=True)
    with pytest.raises(suggestions.ApplyFailed, match="unique rule"):
        await apply(uid, bid, today)
    bundle, lines = await read(uid, bid)
    assert state["raced"] and bundle.status == "pending" and lines[0].status == "failed"
    after = await dump(uid, keep_ids=True)
    assert [r["objective_text"] for r in after["planner_tasks"] if r["focus_week"] == week] == ["Typed at the same time"]
    assert len(after["planner_tasks"]) == len(before["planner_tasks"]) + 1  # only the other request's row


# --- Undo guards ---------------------------------------------------------------------------------------------------

async def test_undo_leaves_a_line_alone_when_its_rows_were_edited_since(ctx):
    http, today, uid = ctx
    line = {"entity": "week_objective", "op": "update", "target": {"week": week_for(today)[2], "stream": "studio"}, "payload": {"text": "Wire it twice"}}
    bid = await make(uid, [line, compass(mission="kept")], today=today)
    await apply(uid, bid, today)
    await http.put(f"{V}/objectives", json={"stream": "studio", "text": "Edited by hand after"})
    bundle, lines = await undo(uid, bid)
    assert [l.status for l in lines] == ["applied", "undone"] and "left as it is" in lines[0].error
    assert bundle.status == "applied"  # a line is still applied
    texts = (await http.get(f"{V}/objectives")).json()["items"]
    assert next(i for i in texts if i["stream"] == "studio")["text"] == "Edited by hand after"
    async with TestSession() as db:
        assert (await db.execute(select(func.count(Compass.id)))).scalar_one() == 0  # the other line was put back


async def test_edits_to_other_rows_of_the_same_stream_do_not_block_undo(ctx):
    http, today, uid = ctx
    bid = await make(uid, [{"entity": "item", "op": "move", "target": {"id": (await task_ids(uid))["Plan the DNS cutover"]}, "payload": {"lane": "backlog"}}], today=today)
    await apply(uid, bid, today)
    await http.put(f"{V}/pipeline/move", json={"stream": "studio", "line": (await task_ids(uid))["Replace the switch"], "lane": "next"})
    assert (await undo(uid, bid))[0].status == "undone"


async def _created_item(uid, today):
    bid = await make(uid, [create_item("Made by suggestion", ref="N")], today=today)
    await apply(uid, bid, today)
    return bid, (await task_ids(uid))["Made by suggestion"]


async def _piece(http, uid, task_id):
    res = await http.post(f"{V}/items", json={"text": "A piece", "lane": "next", "stream": "studio", "parent_id": task_id})
    assert res.status_code == 201, res.text


async def _board(db, uid):
    board = Board(user_id=uid, title="Free", kind="free")
    db.add(board)
    await db.flush()
    return board


async def _node_ref(uid, task_id):
    async with TestSession() as db:
        board = await _board(db, uid)
        db.add(BoardNode(board_id=board.id, id="n1", kind="thought", text="x", ref_key=f"task:{task_id}"))
        await db.commit()


async def _node_parent(uid, task_id):
    async with TestSession() as db:
        board = await _board(db, uid)
        db.add(BoardNode(board_id=board.id, id="n1", kind="thought", text="x", parent_key=f"task:{task_id}"))
        await db.commit()


async def _edge_from(uid, task_id):
    async with TestSession() as db:
        board = await _board(db, uid)
        db.add(BoardEdge(board_id=board.id, id="e1", from_id=f"task:{task_id}", to_id="n2"))
        await db.commit()


async def _edge_to(uid, task_id):
    async with TestSession() as db:
        board = await _board(db, uid)
        db.add(BoardEdge(board_id=board.id, id="e1", from_id="n2", to_id=f"task:{task_id}"))
        await db.commit()


@pytest.mark.parametrize("attach", ["piece", "node_ref", "node_parent", "edge_from", "edge_to"])
async def test_undo_does_not_delete_a_created_item_something_points_at(ctx, attach):
    http, today, uid = ctx
    bid, task_id = await _created_item(uid, today)
    if attach == "piece":
        await _piece(http, uid, task_id)
    else:
        await {"node_ref": _node_ref, "node_parent": _node_parent, "edge_from": _edge_from, "edge_to": _edge_to}[attach](uid, task_id)
    bundle, lines = await undo(uid, bid)
    assert lines[0].status == "applied" and "used by something else" in lines[0].error
    async with TestSession() as db:
        assert (await db.get(Task, task_id)) is not None


async def test_undo_after_an_import_renumbered_the_rows_changes_nothing(ctx):
    http, today, uid = ctx
    bid, task_id = await _created_item(uid, today)
    snapshot = (await http.get("/api/v1/export")).json()
    for row in snapshot["planning_rows"]:  # sqlite may hand the same number out again: make the row differ either way
        if row["text"] == "Made by suggestion":
            row["description"] = "came back from a file"
    assert (await http.post("/api/v1/import?replace=true", json=snapshot)).status_code == 200
    rows = await dump(uid, keep_ids=True)
    bundle, lines = await undo(uid, bid)
    assert lines[0].status == "applied" and "left as it is" in lines[0].error
    assert await dump(uid, keep_ids=True) == rows


# --- Checks hook ---------------------------------------------------------------------------------------------------

def test_a_plugin_without_the_hook_loads_and_is_not_asked():
    app = create_app(plugin_specs=["tests.fake_plugin:FakePlugin"], entry_points=lambda: [])
    assert [p.name for p in app.state.plugins] == ["fake"] and suggestion_checks(app.state.plugins) == []


def test_a_plugin_with_the_hook_is_asked():
    app = create_app(plugin_specs=["tests.fake_plugin:FakePlugin", "tests.fake_plugin:CheckingPlugin"], entry_points=lambda: [])
    checks = suggestion_checks(app.state.plugins)
    assert len(checks) == 1 and checks[0]("fine") is None and checks[0]("Forbidden word")


async def test_checks_run_over_title_reason_and_text_fields_at_create_and_at_apply(ctx):
    http, today, uid = ctx
    check = lambda text: "no" if "forbidden" in text.lower() else None  # noqa: E731
    for kwargs in ({"title": "A forbidden title"}, {"title": "ok", "reason": "forbidden reason"}):
        async with TestSession() as db:
            with pytest.raises(suggestions.SuggestionError, match="no"):
                await suggestions.create(db, uid, "demo", kwargs.get("title", "t"), kwargs.get("reason", ""), [compass(mission="ok")], today=today, checks=[check])
    for line in (compass(mission="forbidden mission"), note(today, "a forbidden note"),
                 create_item("A forbidden item"), create_item("ok", description="forbidden description"),
                 create_item("ok", checklist=[{"text": "forbidden line"}])):
        with pytest.raises(suggestions.SuggestionError):
            await make(uid, [line], today=today, checks=[check])
    # a bundle made before the check existed is refused when it is applied, and nothing changes
    bid = await make(uid, [compass(mission="forbidden but old")], today=today)
    before = await dump(uid, keep_ids=True)
    with pytest.raises(suggestions.SuggestionError, match="no"):
        await apply(uid, bid, today, checks=[check])
    assert await dump(uid, keep_ids=True) == before and (await read(uid, bid))[0].status == "pending"


async def test_registered_plugin_checks_run_at_create_without_being_passed(ctx):
    http, today, uid = ctx
    old = await make(uid, [compass(mission="forbidden but old")], today=today)  # made before the plugin was loaded
    try:
        create_app(plugin_specs=["tests.fake_plugin:CheckingPlugin"], entry_points=lambda: [])  # sets the registered checks
        async with TestSession() as db:
            with pytest.raises(suggestions.SuggestionError, match="not allowed"):
                await suggestions.create(db, uid, "demo", "A forbidden title", "", [compass(mission="ok")], today=today)
            with pytest.raises(suggestions.SuggestionError, match="not allowed"):
                await suggestions.create(db, uid, "demo", "ok", "", [compass(mission="forbidden")], today=today, checks=[lambda t: None])
            await suggestions.create(db, uid, "demo", "fine", "", [compass(mission="ok")], today=today)
            await suggestions.create_for_owner(db, uid, "forbidden", "", [compass(mission="forbidden")], today=today)  # owner: not filtered
        with pytest.raises(suggestions.SuggestionError, match="not allowed"):
            await apply(uid, old, today)
    finally:
        create_app(plugin_specs=[], entry_points=lambda: [])


async def test_a_quarter_objective_for_another_quarter_is_refused_when_made(ctx):
    http, today, uid = ctx
    with pytest.raises(suggestions.SuggestionError, match="only this quarter"):
        await make(uid, [{"entity": "quarter_objective", "op": "update", "target": {"quarter": "2001-Q1"}, "payload": {"text": "x"}}], today=today)


async def test_a_parent_change_by_hand_makes_a_parent_line_stale(ctx):
    http, today, uid = ctx
    ids = await task_ids(uid)
    line = {"entity": "item", "op": "update", "target": {"id": ids["Replace the switch"]}, "payload": {"parent_id": ids["Plan the DNS cutover"]}}
    bid = await make(uid, [line], today=today)
    assert (await read(uid, bid))[1][0].base == {"parent_id": None}
    await http.patch(f"{V}/items/{ids['Replace the switch']}", json={"parent_id": ids["Order the modem"]})
    assert [l.status for l in (await apply(uid, bid, today))[1]] == ["stale"]


async def test_the_undo_guard_only_looks_at_the_users_own_boards(ctx):
    http, today, uid = ctx
    bid, task_id = await _created_item(uid, today)
    _, other = await second_account(http, today)
    await _node_ref(other, task_id)  # someone else's board names the same key: not this user's concern
    assert (await undo(uid, bid))[1][0].status == "undone"


async def test_the_owners_own_bundles_are_not_filtered(ctx):
    http, today, uid = ctx
    check = lambda text: "no"  # noqa: E731
    async with TestSession() as db:
        bundle = await suggestions.create_for_owner(db, uid, "forbidden", "forbidden", [compass(mission="forbidden")], today=today)
        await db.commit()
    assert (await apply(uid, bundle.id, today, checks=[check]))[0].status == "applied"


# --- Odds and ends -------------------------------------------------------------------------------------------------

async def test_suggestions_are_not_exported(ctx):
    http, today, uid = ctx
    await make(uid, [compass(mission="x")], today=today)
    assert "suggestion" not in json.dumps((await http.get("/api/v1/export")).json()).lower()


async def test_apply_logs_its_latency(ctx, caplog):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="x"), note(today)], today=today)
    with caplog.at_level(logging.INFO, logger="app.suggestions"):
        await apply(uid, bid, today)
    assert any(f"suggestions.apply bundle={bid} lines=2 ms=" in r.getMessage() for r in caplog.records)


@pytest.mark.skipif(not ON_POSTGRES, reason="sqlite has no row locks")
async def test_apply_locks_the_rows_it_reads(ctx):
    http, today, uid = ctx
    bid = await make(uid, [compass(mission="x")], today=today)
    statements = []
    async with TestSession() as db:
        event.listen(db.sync_session.get_bind(), "before_cursor_execute", lambda c, cur, stmt, *a: statements.append(stmt))
        await suggestions.apply(db, uid, bid, None, today=today)
    assert any("FOR UPDATE" in s and "compass" in s for s in statements)
    assert any("FOR UPDATE" in s and "suggestion_bundles" in s for s in statements)


async def test_the_list_counts_pending_and_filters_by_status(ctx):
    http, today, uid = ctx
    one = await make(uid, [compass(mission="one")], today=today)
    two = await make(uid, [compass(vision="two"), note(today)], today=today)
    await apply(uid, one, today)
    got = (await http.get(S)).json()
    assert got["pending"] == 1 and [i["id"] for i in got["items"]] == [two, one]
    assert next(i for i in got["items"] if i["id"] == two)["lines"] == 2
    assert [i["id"] for i in (await http.get(S, params={"status": "applied"})).json()["items"]] == [one]
    assert (await http.get(S, params={"status": "bogus"})).status_code == 422
