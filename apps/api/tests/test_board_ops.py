import pytest

from app.services import boards as boards_service

URL = "/api/v1/boards"


def node(id, **kw):
    return {"id": id, "kind": "mind", "text": id, **kw}


def up(id, base=None, **kw):
    return {"op": "upsert_node", "node": node(id, **kw), "base_updated_at": base}


def edge(id, a, b):
    return {"op": "upsert_edge", "edge": {"id": id, "from_id": a, "to_id": b}}


async def new_board(c, title="B"):
    return (await c.post(URL, json={"title": title})).json()["id"]


async def ops(c, board, *batch):
    return await c.post(f"{URL}/{board}/ops", json={"ops": list(batch)})


async def view(c, board):
    return (await c.get(f"{URL}/{board}")).json()


def ids(v):
    return sorted(n["id"] for n in v["nodes"])


async def test_happy_batch(auth_client):
    b = await new_board(auth_client)
    res = await ops(auth_client, b, up("root", x=0, y=0), up("a", parent_id="root", position=0), up("b", parent_id="root", position=1), edge("e1", "a", "b"))
    assert res.status_code == 200
    body = res.json()
    assert (body["revision"], body["bad_ops"], body["stale_ops"], sorted(body["updated"])) == (1, [], [], ["a", "b", "e1", "root"])
    v = await view(auth_client, b)
    assert ids(v) == ["a", "b", "root"] and [e["id"] for e in v["edges"]] == ["e1"] and v["revision"] == 1
    assert all(n["updated_at"] for n in v["nodes"])
    assert (await auth_client.get(URL)).json()[1]["counts"] == {"nodes": 3, "edges": 1}


async def test_retrying_a_batch_is_a_noop_on_state(auth_client):
    b = await new_board(auth_client)
    batch = [up("root"), up("a", parent_id="root"), edge("e1", "root", "a"), {"op": "delete_node", "id": "ghost"}]
    await ops(auth_client, b, *batch)
    first = await view(auth_client, b)
    res = await ops(auth_client, b, *batch)
    assert res.status_code == 200
    again = await view(auth_client, b)
    strip = lambda v: ([{k: x for k, x in n.items() if k != "updated_at"} for n in v["nodes"]], v["edges"])
    assert strip(again) == strip(first)


async def test_last_write_wins_per_row(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("n", text="one", x=1))
    await ops(auth_client, b, up("n", text="two", x=2))
    v = await view(auth_client, b)
    assert [(n["text"], n["x"]) for n in v["nodes"]] == [("two", 2)]  # no 409, the later write replaces the row
    assert v["revision"] == 2


async def test_two_tabs_editing_different_rows_keep_both(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("a", text="a0"), up("b", text="b0"))
    await ops(auth_client, b, up("a", text="a1"))   # tab 1
    await ops(auth_client, b, up("b", text="b1"))   # tab 2, no base revision to clash on
    assert {n["id"]: n["text"] for n in (await view(auth_client, b))["nodes"]} == {"a": "a1", "b": "b1"}


async def test_stale_upsert_is_skipped_and_reported(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("n", text="v1"))
    seen = (await view(auth_client, b))["nodes"][0]["updated_at"]
    await ops(auth_client, b, up("n", text="v2 from another tab", base=seen))   # base == stored: applies
    stale = await ops(auth_client, b, up("n", text="offline edit", base=seen))   # stored is now newer than the base
    assert stale.status_code == 200 and stale.json()["stale_ops"] == ["n"] and stale.json()["bad_ops"] == []
    assert (await view(auth_client, b))["nodes"][0]["text"] == "v2 from another tab"


async def test_stale_delete_is_skipped_and_reported(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("n", text="v1"))
    seen = (await view(auth_client, b))["nodes"][0]["updated_at"]
    await ops(auth_client, b, up("n", text="v2", base=seen))
    res = await ops(auth_client, b, {"op": "delete_node", "id": "n", "base_updated_at": seen})
    assert res.json()["stale_ops"] == ["n"] and ids(await view(auth_client, b)) == ["n"]
    fresh = (await view(auth_client, b))["nodes"][0]["updated_at"]
    assert (await ops(auth_client, b, {"op": "delete_node", "id": "n", "base_updated_at": fresh})).json()["stale_ops"] == []
    assert ids(await view(auth_client, b)) == []


async def test_dangling_parent_is_422_and_rolls_back_the_whole_batch(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("keep"))
    res = await ops(auth_client, b, up("fine"), up("orphan", parent_id="gone"))   # the parent was deleted in another tab
    assert res.status_code == 422
    assert res.json()["bad_ops"] == ["orphan"] and res.json()["detail"]
    v = await view(auth_client, b)
    assert ids(v) == ["keep"] and v["revision"] == 1


async def test_parent_created_later_in_the_same_batch_is_fine(auth_client):
    b = await new_board(auth_client)
    assert (await ops(auth_client, b, up("child", parent_id="root"), up("root"))).status_code == 200


async def test_parent_cycle_is_422(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("a"), up("b", parent_id="a"), up("c", parent_id="b"))
    res = await ops(auth_client, b, up("a", parent_id="c"))
    assert res.status_code == 422 and res.json()["bad_ops"] == ["a"]
    assert (await ops(auth_client, b, up("self", parent_id="self"))).status_code == 422
    assert [n["parent_id"] for n in (await view(auth_client, b))["nodes"] if n["id"] == "a"] == [None]


async def test_validation_error_is_422_with_bad_ops_and_changes_nothing(auth_client):
    b = await new_board(auth_client)
    for bad in (up("x", kind="blob"), up("x", kind="ref", ref_key="nonsense"), up("x", kind="ref"), up("x", ref_key="task:1"), up("x", text="t" * 4001)):
        res = await ops(auth_client, b, up("ok"), bad)
        assert res.status_code == 422 and res.json()["bad_ops"] == ["x"], bad
    assert ids(await view(auth_client, b)) == []
    res = await ops(auth_client, b, {"op": "frobnicate", "id": "z"})
    assert res.status_code == 422 and res.json()["bad_ops"] == ["z"]


async def test_ref_key_is_unique_per_board(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("r1", kind="ref", ref_key="task:5"))
    res = await ops(auth_client, b, up("r2", kind="ref", ref_key="task:5"))
    assert res.status_code == 422 and "r2" in res.json()["bad_ops"]
    other = await new_board(auth_client, "Other")
    assert (await ops(auth_client, other, up("r1", kind="ref", ref_key="task:5"))).status_code == 200  # same key, same id: another board


async def test_same_node_id_on_two_boards_is_independent(auth_client):
    a, b = await new_board(auth_client, "A"), await new_board(auth_client, "B")
    await ops(auth_client, a, up("n", text="in a"))
    await ops(auth_client, b, up("n", text="in b"))
    assert (await view(auth_client, a))["nodes"][0]["text"] == "in a"
    assert (await view(auth_client, b))["nodes"][0]["text"] == "in b"


async def test_delete_node_removes_subtree_and_touching_edges(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("root"), up("a", parent_id="root"), up("a1", parent_id="a"), up("a2", parent_id="a1"), up("b", parent_id="root"),
              up("ref", kind="ref", ref_key="task:9", parent_id="a"),
              edge("e1", "a2", "b"), edge("e2", "b", "root"), edge("e3", "task:9", "b"))
    res = await ops(auth_client, b, {"op": "delete_node", "id": "a"})
    assert res.status_code == 200
    v = await view(auth_client, b)
    assert ids(v) == ["b", "root"] and [e["id"] for e in v["edges"]] == ["e2"]


async def test_delete_edge_and_delete_missing_are_idempotent(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("a"), up("b"), edge("e1", "a", "b"))
    for _ in range(2):
        assert (await ops(auth_client, b, {"op": "delete_edge", "id": "e1"}, {"op": "delete_node", "id": "nope"})).status_code == 200
    assert (await view(auth_client, b))["edges"] == []


async def test_501_ops_is_413(auth_client):
    b = await new_board(auth_client)
    assert (await ops(auth_client, b, *[up(f"n{i}") for i in range(500)])).status_code == 200
    res = await ops(auth_client, b, *[up(f"m{i}") for i in range(501)])
    assert res.status_code == 413
    assert len((await view(auth_client, b))["nodes"]) == 500


async def test_node_and_edge_count_limits_are_413(auth_client, monkeypatch):
    monkeypatch.setattr(boards_service, "MAX_NODES", 3)
    monkeypatch.setattr(boards_service, "MAX_EDGES", 2)
    b = await new_board(auth_client)
    assert (await ops(auth_client, b, up("a"), up("b"), up("c"))).status_code == 200
    assert (await ops(auth_client, b, up("a", text="edit"))).status_code == 200   # an overwrite is not growth
    res = await ops(auth_client, b, up("d"))
    assert res.status_code == 413 and "3" in res.json()["detail"]
    assert ids(await view(auth_client, b)) == ["a", "b", "c"]
    assert (await ops(auth_client, b, edge("e1", "a", "b"), edge("e2", "b", "c"))).status_code == 200
    assert (await ops(auth_client, b, edge("e3", "a", "c"))).status_code == 413


async def test_ops_on_missing_board_404(auth_client):
    assert (await ops(auth_client, 99999, up("a"))).status_code == 404


# --- contract with the web client ------------------------------------------------------------------------------------

async def test_response_lists_updated_at_of_every_written_row(auth_client):
    b = await new_board(auth_client)
    res = (await ops(auth_client, b, up("a"), up("b"), edge("e1", "a", "b"), {"op": "delete_node", "id": "ghost"})).json()
    v = await view(auth_client, b)
    assert set(res["updated"]) == {"a", "b", "e1"}
    assert res["updated"]["a"] == next(n for n in v["nodes"] if n["id"] == "a")["updated_at"]
    assert res["updated"]["e1"] == v["edges"][0]["updated_at"]
    # the client sends it back as the next base: not stale
    again = (await ops(auth_client, b, up("a", base=res["updated"]["a"], text="changed"),
                       {"op": "upsert_edge", "edge": {"id": "e1", "from_id": "b", "to_id": "a"}, "base_updated_at": res["updated"]["e1"]})).json()
    assert again["stale_ops"] == [] and set(again["updated"]) == {"a", "e1"}
    assert again["updated"]["a"] > res["updated"]["a"]
    assert (await view(auth_client, b))["nodes"][0]["text"] == "changed"


async def test_deleted_and_stale_rows_are_not_in_updated(auth_client):
    b = await new_board(auth_client)
    first = (await ops(auth_client, b, up("n"), up("gone"))).json()
    await ops(auth_client, b, up("n", text="newer"))
    res = (await ops(auth_client, b, {"op": "delete_node", "id": "gone"}, up("n", text="old", base=first["updated"]["n"]))).json()
    assert res["stale_ops"] == ["n"] and res["updated"] == {}


async def test_null_base_means_no_staleness_check(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("n", text="v1"))
    assert (await ops(auth_client, b, up("n", text="blind write", base=None))).json()["stale_ops"] == []
    assert (await view(auth_client, b))["nodes"][0]["text"] == "blind write"


async def test_stale_edge_ops_are_skipped(auth_client):
    b = await new_board(auth_client)
    first = (await ops(auth_client, b, up("a"), up("b"), edge("e1", "a", "b"))).json()
    await ops(auth_client, b, {"op": "upsert_edge", "edge": {"id": "e1", "from_id": "a", "to_id": "b", "label": "new"}})
    res = (await ops(auth_client, b, {"op": "upsert_edge", "edge": {"id": "e1", "from_id": "b", "to_id": "a", "label": "old"}, "base_updated_at": first["updated"]["e1"]},
                     {"op": "delete_edge", "id": "e1", "base_updated_at": first["updated"]["e1"]})).json()
    assert res["stale_ops"] == ["e1", "e1"] and res["updated"] == {}
    assert [(e["label"], e["from_id"]) for e in (await view(auth_client, b))["edges"]] == [("new", "a")]


async def test_revision_bumps_once_per_batch_whatever_its_size(auth_client):
    b = await new_board(auth_client)
    assert (await ops(auth_client, b, *[up(f"n{i}") for i in range(25)])).json()["revision"] == 1
    assert (await ops(auth_client, b, up("n0", text="x"), {"op": "delete_node", "id": "n1"}, edge("e", "n0", "n2"))).json()["revision"] == 2
    assert (await view(auth_client, b))["revision"] == 2


async def test_notes_are_stored_and_limited(auth_client):
    b = await new_board(auth_client)
    await ops(auth_client, b, up("a", notes="line one\nline two"), up("plain"))
    nodes = {n["id"]: n for n in (await view(auth_client, b))["nodes"]}
    assert nodes["a"]["notes"] == "line one\nline two" and nodes["plain"]["notes"] == ""
    assert (await ops(auth_client, b, up("a", notes="n" * 10001))).status_code == 422
    assert (await view(auth_client, b))["nodes"][0]["notes"] == "line one\nline two"


async def test_style_is_opaque_but_size_limited(auth_client):
    b = await new_board(auth_client)
    style = {"color": "violet", "side": "L", "anything": {"nested": [1, 2]}}
    await ops(auth_client, b, up("a", style=style))
    assert (await view(auth_client, b))["nodes"][0]["style"] == style
    res = await ops(auth_client, b, up("a", style={"blob": "x" * 2100}))
    assert res.status_code == 422 and res.json()["bad_ops"] == ["a"]
