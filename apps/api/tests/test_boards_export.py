import copy

import pytest
from sqlalchemy import delete, select

from app.models.board import Board, BoardEdge, BoardNode
from app.models.planner import Task
from app.services import board_transfer
from app.services.planner_export import FORMAT_VERSION
from tests.conftest import TestSession
from tests.test_boards import other_client

URL = "/api/v1/boards"
E = "/api/v1/export"
I = "/api/v1/import?replace=true"


def up(id, **kw):
    return {"op": "upsert_node", "node": {"id": id, "kind": "mind", "text": id, **kw}}


async def tasks_by_id() -> dict[int, tuple]:
    async with TestSession() as db:
        return {t.id: (t.text, t.stream, t.lane) for t in (await db.execute(select(Task))).scalars()}


async def shift_task_ids():
    """Delete the first plain task so the next import (which numbers from 1) gives every other row a different id."""
    async with TestSession() as db:
        first = (await db.execute(select(Task).where(Task.lane.is_(None)).order_by(Task.id))).scalars().first()
        await db.delete(first)
        await db.commit()


async def life_and_free_boards(c):
    """A free board linking two live items (ref nodes), with a thought under one and a connector, plus view state on Life."""
    tasks = await tasks_by_id()
    pick = [i for i, (_t, s, l) in tasks.items() if l in ("now", "next")][:2]
    b = (await c.post(URL, json={"title": "Linked"})).json()["id"]
    await c.post(f"{URL}/{b}/ops", json={"ops": [
        up("root", x=0, y=0), up("r1", kind="ref", ref_key=f"task:{pick[0]}", parent_id="root"), up("r2", kind="ref", ref_key=f"task:{pick[1]}", parent_id="root"),
        up("th", parent_id="r1", parent_key=f"task:{pick[0]}", style={"c": 2}, collapsed=True),
        {"op": "upsert_edge", "edge": {"id": "e1", "from_id": "r1", "to_id": f"task:{pick[1]}", "label": "needs"}}]})
    life = (await c.get(URL)).json()[0]["id"]
    await c.patch(f"{URL}/{life}", json={"viewport": {"zoom": 2}})
    await c.post(f"{URL}/{life}/ops", json={"ops": [up("lt", parent_key=f"task:{pick[0]}")]})
    return b, pick, tasks


async def linked(c, board):
    """{node id: text of the task its ref_key points at}, read through the live task table."""
    tasks = await tasks_by_id()
    out = {}
    for n in (await c.get(f"{URL}/{board}")).json()["nodes"]:
        if n["ref_key"]:
            out[n["id"]] = tasks.get(int(n["ref_key"].split(":")[1]), ("<none>",))[0]
    return out


async def board_by_title(c, title):
    for b in (await c.get(URL)).json():
        if b["title"] == title:
            return (await c.get(f"{URL}/{b['id']}")).json()


async def test_format_version_is_unchanged():
    assert FORMAT_VERSION == 1


async def test_export_carries_boards_without_db_ids(db_client):
    c, _ = db_client
    await life_and_free_boards(c)
    boards = (await c.get(E)).json()["boards"]
    assert [b["kind"] for b in boards] == ["life", "free"]
    free = boards[1]
    assert set(free) == {"title", "kind", "viewport", "nodes", "edges"} and free["title"] == "Linked"
    assert {n["id"] for n in free["nodes"]} == {"root", "r1", "r2", "th"}
    th = next(n for n in free["nodes"] if n["id"] == "th")
    assert th["collapsed"] is True and th["style"] == {"c": 2} and "board_id" not in th and "updated_at" not in th
    assert free["edges"] == [{"id": "e1", "from_id": "r1", "to_id": free["edges"][0]["to_id"], "label": "needs", "style": {}}]
    assert free["edges"][0]["to_id"].startswith("task:")
    assert boards[0]["viewport"] == {"zoom": 2}


async def test_task_export_already_carries_ids(db_client):
    """Assumption A2: the export writes row ids for tasks and planning rows."""
    c, _ = db_client
    snap = (await c.get(E)).json()
    assert all(isinstance(t["id"], int) for t in snap["tasks"]) and all(isinstance(r["id"], int) for r in snap["planning_rows"])


async def test_round_trip_keeps_boards_and_points_links_at_the_same_tasks(db_client):
    c, _ = db_client
    b, pick, tasks = await life_and_free_boards(c)
    await shift_task_ids()
    snap = (await c.get(E)).json()
    before = await linked(c, b)
    async with TestSession() as db:   # wipe the boards: the file alone must bring them back
        await db.execute(delete(BoardEdge)); await db.execute(delete(BoardNode)); await db.execute(delete(Board))
        await db.commit()
    res = await c.post(I, json=snap)
    assert res.status_code == 200, res.text
    assert "boards" not in res.json()["imported"]
    got = await board_by_title(c, "Linked")
    assert {n["id"] for n in got["nodes"]} == {"root", "r1", "r2", "th"} and [e["id"] for e in got["edges"]] == ["e1"]
    assert await linked(c, got["id"]) == before and "<none>" not in before.values()
    new_ids = {n["ref_key"] for n in got["nodes"] if n["ref_key"]}
    assert new_ids != {f"task:{p}" for p in pick}   # the ids really moved
    assert got["edges"][0]["to_id"] in new_ids
    th = next(n for n in got["nodes"] if n["id"] == "th")
    assert th["parent_id"] == "r1" and th["collapsed"] is True and th["parent_key"] in new_ids
    life = await board_by_title(c, "Life")
    assert life["viewport"] == {"zoom": 2} and life["nodes"][0]["parent_key"] in new_ids


async def test_file_without_boards_leaves_boards_and_remaps_their_task_keys(db_client):
    c, _ = db_client
    b, pick, tasks = await life_and_free_boards(c)
    await shift_task_ids()
    snap = (await c.get(E)).json()
    del snap["boards"]
    before = await linked(c, b)
    assert (await c.post(I, json=snap)).status_code == 200
    got = (await c.get(f"{URL}/{b}")).json()
    assert {n["id"] for n in got["nodes"]} == {"root", "r1", "r2", "th"}
    assert await linked(c, b) == before
    assert {n["ref_key"] for n in got["nodes"] if n["ref_key"]} != {f"task:{p}" for p in pick}
    assert got["edges"][0]["to_id"] in {n["ref_key"] for n in got["nodes"]}


async def test_reimporting_the_first_file_after_ids_shifted_twice(db_client):
    c, _ = db_client
    b, pick, tasks = await life_and_free_boards(c)
    await shift_task_ids()
    first = (await c.get(E)).json()
    before = await linked(c, b)
    assert (await c.post(I, json=first)).status_code == 200      # ids shift once
    await shift_task_ids()
    assert (await c.post(I, json=first)).status_code == 200      # and again: the file is older than the database
    got = await board_by_title(c, "Linked")
    assert await linked(c, got["id"]) == before and "<none>" not in before.values()


async def test_file_with_only_pipeline_items_keeps_unmatched_keys(db_client):
    """A file from before planning_rows has ids in another space: nothing may be rewritten to a wrong task."""
    c, _ = db_client
    await life_and_free_boards(c)
    snap = (await c.get(E)).json()
    old_keys = sorted(n["ref_key"] for b in snap["boards"] for n in b["nodes"] if n["ref_key"])
    del snap["planning_rows"]
    assert (await c.post(I, json=snap)).status_code == 200
    got = await board_by_title(c, "Linked")
    assert sorted(n["ref_key"] for n in got["nodes"] if n["ref_key"]) == sorted(k.replace("task:", "task:gone-") for k in old_keys)   # unmatched: never linked to a guess


async def test_duplicate_text_is_not_remapped_others_are(db_client):
    c, _ = db_client
    await c.post("/api/v1/vault/pipeline/studio/items", json={"texts": ["Solo item"], "lane": "next"})
    for _ in range(2):
        await c.post("/api/v1/vault/pipeline/studio/items", json={"texts": ["Twin"], "lane": "next"})
    tasks = await tasks_by_id()
    twins = [i for i, t in tasks.items() if t[0] == "Twin"]
    solo = next(i for i, t in tasks.items() if t[0] == "Solo item")
    b = (await c.post(URL, json={"title": "Dups"})).json()["id"]
    await c.post(f"{URL}/{b}/ops", json={"ops": [up("a", kind="ref", ref_key=f"task:{twins[0]}"), up("b", kind="ref", ref_key=f"task:{twins[1]}"),
                                                    up("s", kind="ref", ref_key=f"task:{solo}")]})
    await shift_task_ids()
    snap = (await c.get(E)).json()
    del snap["boards"]
    assert (await c.post(I, json=snap)).status_code == 200
    keys = {n["id"]: n["ref_key"] for n in (await c.get(f"{URL}/{b}")).json()["nodes"]}
    assert keys["a"] == f"task:gone-{twins[0]}" and keys["b"] == f"task:gone-{twins[1]}"
    assert keys["s"] != f"task:{solo}" and (await tasks_by_id())[int(keys["s"].split(":")[1])][0] == "Solo item"


async def test_import_validates_boards(db_client):
    c, _ = db_client
    snap = (await c.get(E)).json()
    node = lambda i, **kw: {"id": i, "kind": "mind", "text": i, **kw}
    two_life = {**snap, "boards": [{"title": "One", "kind": "life", "viewport": {}, "nodes": [], "edges": []},
                                    {"title": "Two", "kind": "life", "viewport": {}, "nodes": [], "edges": []}]}
    assert (await c.post(I, json=two_life)).status_code == 200
    assert [(b["title"], b["kind"]) for b in (await c.get(URL)).json()] == [("Life", "life"), ("Two", "free")]   # the life board is always called Life; the extra one becomes free
    dangling = {**snap, "boards": [{"title": "X", "kind": "free", "viewport": {}, "nodes": [node("a", parent_id="ghost")], "edges": []}]}
    assert (await c.post(I, json=dangling)).status_code == 422
    twice = {**snap, "boards": [{"title": "X", "kind": "free", "viewport": {}, "nodes": [node("a"), node("a")], "edges": []}]}
    assert (await c.post(I, json=twice)).status_code == 422
    badkind = {**snap, "boards": [{"title": "X", "kind": "free", "viewport": {}, "nodes": [{"id": "a", "kind": "blob"}], "edges": []}]}
    assert (await c.post(I, json=badkind)).status_code == 422
    assert [b["title"] for b in (await c.get(URL)).json()] == ["Life", "Two"]   # a refused import changed nothing


async def test_import_refuses_loops_big_viewports_and_oversized_files(db_client, monkeypatch):
    c, _ = db_client
    snap = (await c.get(E)).json()
    board = lambda **kw: {"title": "X", "kind": "free", "viewport": {}, "nodes": [], "edges": [], **kw}
    loop = board(nodes=[{"id": "a", "kind": "mind", "parent_id": "b"}, {"id": "b", "kind": "mind", "parent_id": "a"}])
    assert (await c.post(I, json={**snap, "boards": [loop]})).status_code == 422
    assert (await c.post(I, json={**snap, "boards": [board(viewport={"x": "9" * 2000})]})).status_code == 422
    assert (await c.post(I, json={**snap, "boards": [board(nodes=[{"id": f"n{i}", "kind": "mind"} for i in range(5001)])]})).status_code == 422
    monkeypatch.setattr(board_transfer, "MAX_TOTAL", 3)
    two = [board(nodes=[{"id": "a", "kind": "mind"}, {"id": "b", "kind": "mind"}]), board(title="Y", nodes=[{"id": "a", "kind": "mind"}, {"id": "b", "kind": "mind"}])]
    assert (await c.post(I, json={**snap, "boards": two})).status_code == 413


async def test_a_long_parent_chain_is_checked_in_one_pass(db_client):
    c, _ = db_client
    snap = (await c.get(E)).json()
    chain = [{"id": f"n{i}", "kind": "mind", "parent_id": f"n{i - 1}" if i else None} for i in range(5000)]
    res = await c.post(I, json={**snap, "boards": [{"title": "Deep", "kind": "free", "viewport": {}, "nodes": chain, "edges": []}]})
    assert res.status_code == 200


async def test_import_over_the_board_limit_is_413(db_client, monkeypatch):
    c, _ = db_client
    monkeypatch.setattr(board_transfer, "MAX_NODES", 2)
    snap = (await c.get(E)).json()
    big = {**snap, "boards": [{"title": "Big", "kind": "free", "viewport": {}, "edges": [],
                               "nodes": [{"id": f"n{i}", "kind": "mind", "text": "t"} for i in range(3)]}]}
    res = await c.post(I, json=big)
    assert res.status_code == 413 and "2" in res.json()["detail"]


async def test_boards_of_other_users_are_not_exported_or_touched(db_client):
    c, _ = db_client
    other = await other_client()
    try:
        theirs = (await other.post(URL, json={"title": "Theirs"})).json()["id"]
        await other.post(f"{URL}/{theirs}/ops", json={"ops": [up("x")]})
        await life_and_free_boards(c)
        snap = (await c.get(E)).json()
        assert "Theirs" not in [b["title"] for b in snap["boards"]]
        assert (await c.post(I, json=snap)).status_code == 200
        assert [n["id"] for n in (await other.get(f"{URL}/{theirs}")).json()["nodes"]] == ["x"]
    finally:
        await other.aclose()


# --- remap_task_keys, the pure part ----------------------------------------------------------------------------------

def _n(id, key=None, **kw):
    return BoardNode(board_id=1, id=id, kind="ref" if key else "mind", ref_key=key, text="", position=0, style={}, collapsed=kw.pop("collapsed", False),
                     hidden=kw.pop("hidden", False), **kw)


async def test_remap_rewrites_keys_parent_keys_and_edge_ends():
    nodes = [_n("a", "task:1"), _n("b", "task:2"), _n("t", parent_key="task:1"), _n("s", "stream:studio")]
    edges = [BoardEdge(board_id=1, id="e", from_id="a", to_id="task:2", label="", style={})]
    dropped = await board_transfer.remap_task_keys(None, nodes, edges, {1: 2, 2: 3})   # a chain: 1->2 while 2->3
    assert dropped == []
    assert [n.ref_key for n in nodes] == ["task:2", "task:3", None, "stream:studio"]
    assert nodes[2].parent_key == "task:2" and (edges[0].from_id, edges[0].to_id) == ("a", "task:3")


async def test_remap_collision_merges_into_the_existing_row():
    existing = _n("keep", "task:9", collapsed=False, hidden=False)
    moved = _n("moved", "task:4", collapsed=True, hidden=True)
    child = _n("kid", parent_id="moved")
    edges = [BoardEdge(board_id=1, id="e", from_id="moved", to_id="keep", label="", style={})]
    dropped = await board_transfer.remap_task_keys(None, [existing, moved, child], edges, {4: 9, 9: 9})
    assert [d.id for d in dropped] == ["moved"]
    assert (existing.ref_key, existing.collapsed, existing.hidden) == ("task:9", True, True)   # the remapped row's state wins
    assert child.parent_id == "keep" and edges[0].from_id == "keep"


async def test_notes_survive_export_and_import(db_client):
    c, _ = db_client
    b = (await c.post(URL, json={"title": "Notes"})).json()["id"]
    await c.post(f"{URL}/{b}/ops", json={"ops": [up("n", notes="why this matters")]})
    snap = (await c.get(E)).json()
    assert next(x for x in snap["boards"] if x["title"] == "Notes")["nodes"][0]["notes"] == "why this matters"
    assert (await c.post(I, json=snap)).status_code == 200
    got = await board_by_title(c, "Notes")
    assert got["nodes"][0]["notes"] == "why this matters"


async def test_unmapped_key_never_merges_with_a_task_that_took_its_number():
    unmapped, moved = _n("old", "task:7"), _n("moved", "task:3")
    dropped = await board_transfer.remap_task_keys(None, [unmapped, moved], [], {3: 7})
    assert dropped == []
    assert (unmapped.ref_key, moved.ref_key) == ("task:gone-7", "task:7")
    again = await board_transfer.remap_task_keys(None, [unmapped], [], {})   # a gone key is left alone by later imports
    assert again == [] and unmapped.ref_key == "task:gone-7"


async def test_existing_boards_get_gone_keys_when_nothing_matches(db_client):
    c, _ = db_client
    b = (await c.post(URL, json={"title": "Orphans"})).json()["id"]
    await c.post(f"{URL}/{b}/ops", json={"ops": [up("r", kind="ref", ref_key="task:999999"), up("t", parent_key="task:999999"),
                                                    {"op": "upsert_edge", "edge": {"id": "e", "from_id": "r", "to_id": "task:999999"}}]})
    snap = (await c.get(E)).json()
    del snap["boards"]
    assert (await c.post(I, json=snap)).status_code == 200
    got = (await c.get(f"{URL}/{b}")).json()
    assert {n["id"]: (n["ref_key"], n["parent_key"]) for n in got["nodes"]} == {"r": ("task:gone-999999", None), "t": (None, "task:gone-999999")}
    assert got["edges"][0]["to_id"] == "task:gone-999999"
