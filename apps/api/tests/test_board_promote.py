from sqlalchemy import func, select

from app.models.planner import Task
from tests.conftest import TestSession
from tests.test_boards import other_client

URL = "/api/v1/boards"
V = "/api/v1/vault"


async def board_with_thought(c, text="Buy a label printer", **extra):
    b = (await c.post(URL, json={"title": "B"})).json()["id"]
    node = {"id": "t1", "kind": "mind", "text": text, "x": 10, "y": 20, **extra}
    assert (await c.post(f"{URL}/{b}/ops", json={"ops": [{"op": "upsert_node", "node": node}]})).status_code == 200
    return b


def promote(c, b, node="t1", **body):
    return c.post(f"{URL}/{b}/nodes/{node}/promote", json={"stream": "studio", "lane": "next", "checkpoint": None, **body})


async def task_rows(text):
    async with TestSession() as db:
        return (await db.execute(select(Task).where(Task.text == text))).scalars().all()


async def test_promote_creates_one_task_and_turns_the_node_into_a_ref(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    res = await promote(c, b, lane="now", checkpoint="dec")
    assert res.status_code == 200, res.text
    body = res.json()
    rows = await task_rows("Buy a label printer")
    assert len(rows) == 1
    row = rows[0]
    assert (row.stream, row.lane, row.checkpoint) == ("studio", "now", "dec")
    assert body["task_id"] == row.id
    assert body["node"]["kind"] == "ref" and body["node"]["ref_key"] == f"task:{row.id}" and body["node"]["text"] == "Buy a label printer"
    assert body["node"]["id"] == "t1" and body["node"]["x"] == 10
    stored = (await c.get(f"{URL}/{b}")).json()
    assert stored["nodes"][0]["ref_key"] == f"task:{row.id}" and stored["revision"] == body["revision"] == 2
    pipes = (await c.get(f"{V}/pipelines")).json()
    items = next(s for s in pipes["streams"] if s["stream"] == "studio")["items"]
    mine = next(i for i in items if i["line"] == row.id)
    assert (mine["lane"], mine["checkpoint"], mine["text"]) == ("now", "dec", "Buy a label printer")


async def test_promote_returns_the_cleaned_text(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="  Fit the rack #jan [product:: Router]  ")
    body = (await promote(c, b)).json()
    assert body["node"]["text"] == "Fit the rack"
    row = (await task_rows("Fit the rack"))[0]
    assert (row.checkpoint, row.products) == ("jan", ["Router"])   # a #month in the text still counts when no checkpoint is given


async def test_explicit_checkpoint_wins_over_the_text(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="Fit the rack #jan")
    assert (await promote(c, b, checkpoint="mar")).status_code == 200
    assert (await task_rows("Fit the rack"))[0].checkpoint == "mar"


async def test_promote_twice_is_422(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    assert (await promote(c, b)).status_code == 200
    assert (await promote(c, b)).status_code == 422
    assert len(await task_rows("Buy a label printer")) == 1


async def test_unknown_stream_is_422_and_creates_nothing(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    assert (await promote(c, b, stream="nope")).status_code == 422
    assert await task_rows("Buy a label printer") == []
    assert (await c.get(f"{URL}/{b}")).json()["nodes"][0]["kind"] == "mind"


async def test_bad_lane_checkpoint_empty_text_and_non_mind_nodes_are_422(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    assert (await promote(c, b, lane="done")).status_code == 422
    assert (await promote(c, b, checkpoint="smarch")).status_code == 422
    assert await task_rows("Buy a label printer") == []
    await c.post(f"{URL}/{b}/ops", json={"ops": [{"op": "upsert_node", "node": {"id": "blank", "kind": "mind", "text": "  "}},
                                                   {"op": "upsert_node", "node": {"id": "st", "kind": "sticky", "text": "a sticky"}}]})
    assert (await promote(c, b, node="blank")).status_code == 422
    assert (await promote(c, b, node="st")).status_code == 422
    assert (await promote(c, b, node="missing")).status_code == 404


async def test_other_users_board_is_404(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    other = await other_client()
    try:
        assert (await promote(other, b)).status_code == 404
    finally:
        await other.aclose()
    assert await task_rows("Buy a label printer") == []


async def test_promote_with_a_product_makes_it_the_first_tag(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="Fix the DNS")
    res = await promote(c, b, product="infra")
    assert res.status_code == 200, res.text
    assert (await task_rows("Fix the DNS"))[0].products == ["infra"]


async def test_promote_product_goes_before_text_tags(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="fix #router")
    assert (await promote(c, b, product="infra")).status_code == 200
    assert (await task_rows("fix"))[0].products == ["infra", "router"]


async def test_promote_product_dedupes_case_insensitively_keeping_the_first_spelling(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="#Infra x")
    assert (await promote(c, b, product="infra")).status_code == 200
    assert (await task_rows("x"))[0].products == ["infra"]


async def test_promote_product_strips_a_leading_hash(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="Fix the DNS")
    assert (await promote(c, b, product="#infra")).status_code == 200
    assert (await task_rows("Fix the DNS"))[0].products == ["infra"]


async def test_promote_without_a_product_keeps_the_text_tags(db_client):
    c, _ = db_client
    b = await board_with_thought(c, text="fix #router")
    assert (await promote(c, b)).status_code == 200
    assert (await task_rows("fix"))[0].products == ["router"]


async def test_promote_product_must_look_like_a_tag(db_client):
    c, _ = db_client
    b = await board_with_thought(c)
    for bad in ("", "  ", "has space", "1abc", "-x", "a" * 41, "caf\u00e9", "a,b", "x]"):
        assert (await promote(c, b, product=bad)).status_code == 422, bad
    assert await task_rows("Buy a label printer") == []
    assert (await promote(c, b, product="a" * 40)).status_code == 200
