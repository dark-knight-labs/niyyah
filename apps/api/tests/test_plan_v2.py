"""Plan v2: goal and label endpoints, reorder, the checkpoint sync, the new-quarter carry, export round trip."""
from datetime import date, datetime

import pytest
from sqlalchemy import select

from app.api.v1 import vault
from app.models.planner import Quarter, QuarterStream, Task
from app.models.user import User
from app.services import plan_v2
from app.services.rules import MONTHS, quarter_for
from tests.conftest import TestSession

V = "/api/v1/vault"


def _ref(stream, line, **extra):
    return {"stream": stream, "line": line, "hash": "", **extra}


async def _items(client, stream="studio"):
    data = (await client.get(f"{V}/pipelines")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["items"]


async def _item(client, text, stream="studio"):
    return next(i for i in await _items(client, stream) if i["text"] == text)


async def _goal_id(client, stream="studio"):
    quarter = (await client.get(f"{V}/quarter")).json()
    return next(s for s in quarter["streams"] if s["stream"] == stream)["goal_checklist"][0]["id"]


def _month_of(today: date, offset: int = 0) -> str:
    index = today.year * 12 + today.month - 1 + offset
    return f"{index // 12}-{index % 12 + 1:02d}"


@pytest.mark.asyncio
async def test_pipelines_carry_the_new_fields(db_client):
    client, _ = db_client
    item = await _item(client, "Plan the DNS cutover")
    assert item["goal_ref"] is None and item["label_month"] is None and item["label_date"] is None
    # an item whose checkpoint was typed before the labels existed has no month label until the CLI runs
    assert (await _item(client, "Wire the router"))["label_month"] is None


@pytest.mark.asyncio
async def test_goal_set_validate_and_clear(db_client):
    client, _ = db_client
    item = await _item(client, "Plan the DNS cutover")
    goal = await _goal_id(client)
    assert (await client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref=goal))).status_code == 200
    assert (await _item(client, "Plan the DNS cutover"))["goal_ref"] == goal
    bad = await client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref="nope0000"))
    assert bad.status_code == 422 and "not a goal" in bad.json()["detail"]
    assert (await _item(client, "Plan the DNS cutover"))["goal_ref"] == goal  # the bad call changed nothing
    shop_goal = await _goal_id(client, "shop")
    assert (await client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref=shop_goal))).status_code == 422  # another block's goal
    assert (await client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref=None))).status_code == 200
    assert (await _item(client, "Plan the DNS cutover"))["goal_ref"] is None


@pytest.mark.asyncio
async def test_label_month_sets_checkpoint_in_the_current_quarter_only(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    this_month = _month_of(today)
    assert (await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], month=this_month))).status_code == 200
    got = await _item(client, "Plan the DNS cutover")
    assert got["label_month"] == this_month and got["label_date"] is None and got["checkpoint"] == MONTHS[today.month - 1]
    far = _month_of(today, 9)  # a quarter that is not this one
    assert (await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], month=far))).status_code == 200
    got = await _item(client, "Plan the DNS cutover")
    assert got["label_month"] == far and got["checkpoint"] is None
    assert (await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"]))).status_code == 200  # none = clear
    got = await _item(client, "Plan the DNS cutover")
    assert got["label_month"] is None and got["label_date"] is None and got["checkpoint"] is None


@pytest.mark.asyncio
async def test_label_date_replaces_the_month_and_exactly_one_is_allowed(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], month=_month_of(today)))
    day = today.isoformat()
    assert (await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], day=day))).status_code == 200
    got = await _item(client, "Plan the DNS cutover")
    assert got["label_date"] == day and got["label_month"] is None and got["checkpoint"] is None
    both = await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], day=day, month=_month_of(today)))
    assert both.status_code == 422
    for month in ("2026-13", "2026-1", "nov-2026", "2026-00"):
        assert (await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], month=month))).status_code == 422
    assert (await _item(client, "Plan the DNS cutover"))["label_date"] == day


@pytest.mark.asyncio
async def test_a_date_label_leaves_the_item_undated(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], day=today.isoformat()))
    async with TestSession() as db:
        row = (await db.execute(select(Task).where(Task.id == item["line"]))).scalar_one()
        assert row.scheduled_on is None and row.due_on is None and row.start_on is None and row.label_date == today


@pytest.mark.asyncio
async def test_old_checkpoint_write_keeps_label_month_in_step(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    mon = MONTHS[today.month - 1]
    assert (await client.put(f"{V}/pipeline/checkpoint", json=_ref("studio", item["line"], checkpoint=mon))).status_code == 200
    got = await _item(client, "Plan the DNS cutover")
    assert got["checkpoint"] == mon and got["label_month"] == _month_of(today)
    await client.put(f"{V}/pipeline/checkpoint", json=_ref("studio", item["line"], checkpoint=""))
    got = await _item(client, "Plan the DNS cutover")
    assert got["checkpoint"] is None and got["label_month"] is None


@pytest.mark.asyncio
async def test_a_month_typed_in_a_new_item_sets_the_label(db_client):
    client, today = db_client
    mon = MONTHS[today.month - 1]
    assert (await client.post(f"{V}/pipeline/studio/items", json={"texts": [f"Write the runbook #{mon}"], "lane": "next"})).status_code == 200
    got = await _item(client, "Write the runbook")
    assert got["checkpoint"] == mon and got["label_month"] == _month_of(today)


@pytest.mark.asyncio
async def test_reorder_swaps_neighbours_in_a_lane(db_client):
    client, _ = db_client
    await client.post(f"{V}/pipeline/studio/items", json={"texts": ["B item", "C item"], "lane": "next"})
    order = lambda items: [i["text"] for i in items if i["lane"] == "next"]  # noqa: E731
    assert order(await _items(client)) == ["Plan the DNS cutover", "B item", "C item"]
    c = await _item(client, "C item")
    assert (await client.put(f"{V}/pipeline/reorder", json=_ref("studio", c["line"], direction="up"))).status_code == 200
    assert order(await _items(client)) == ["Plan the DNS cutover", "C item", "B item"]
    first = await _item(client, "Plan the DNS cutover")
    await client.put(f"{V}/pipeline/reorder", json=_ref("studio", first["line"], direction="up"))  # already first: no change
    assert order(await _items(client)) == ["Plan the DNS cutover", "C item", "B item"]
    await client.put(f"{V}/pipeline/reorder", json=_ref("studio", first["line"], direction="down"))
    assert order(await _items(client)) == ["C item", "Plan the DNS cutover", "B item"]
    assert (await client.put(f"{V}/pipeline/reorder", json=_ref("studio", first["line"], direction="sideways"))).status_code == 422


@pytest.mark.asyncio
async def test_another_user_cannot_touch_my_items(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "testpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "testpass123"})).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    for path, body in (("goal", {"goal_ref": None}), ("label", {"month": _month_of(today)}), ("reorder", {"direction": "up"})):
        r = await client.put(f"{V}/pipeline/{path}", json=_ref("studio", item["line"], **body), headers=other)
        assert r.status_code == 422, path
    assert (await _item(client, "Plan the DNS cutover"))["label_month"] is None


@pytest.mark.asyncio
async def test_export_and_import_keep_the_new_fields(db_client):
    client, today = db_client
    item = await _item(client, "Plan the DNS cutover")
    goal = await _goal_id(client)
    await client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref=goal))
    await client.put(f"{V}/pipeline/label", json=_ref("studio", item["line"], month=_month_of(today)))
    other = await _item(client, "Replace the switch")
    await client.put(f"{V}/pipeline/label", json=_ref("studio", other["line"], day=today.isoformat()))
    snap = (await client.get("/api/v1/export")).json()
    rows = {r["text"]: r for r in snap["planning_rows"]}
    assert rows["Plan the DNS cutover"]["goal_ref"] == goal and rows["Plan the DNS cutover"]["label_month"] == _month_of(today)
    assert rows["Replace the switch"]["label_date"] == today.isoformat() and rows["Replace the switch"]["label_month"] is None
    assert (await client.post("/api/v1/import?replace=true", json=snap)).status_code == 200
    again = {i["text"]: i for i in await _items(client)}
    assert again["Plan the DNS cutover"]["goal_ref"] == goal and again["Plan the DNS cutover"]["label_month"] == _month_of(today)
    assert again["Replace the switch"]["label_date"] == today.isoformat()


# --- a new quarter carries last quarter's blocks ----------------------------------------------------------------------

async def _seed_q4(user_id: int):
    async with TestSession() as db:
        db.add(Quarter(user_id=user_id, label="2026-Q4", objective="Old", objective_ar=""))
        for pos, (slug, name, goal) in enumerate((("studio", "Studio", "Ship DNS"), ("fitness", "Fitness", "Run 5k"))):
            db.add(QuarterStream(
                user_id=user_id, quarter="2026-Q4", slug=slug, name=name, color="violet", icon="server", slot="OT", weekly=True,
                has_pipeline=True, in_note=True, goal=goal, goal_checklist=[{"id": f"g{pos}000000", "text": goal, "done": True}],
                status="committed", checkpoints=[{"month": "nov", "text": "x", "checklist": [{"id": "c0000001", "text": "x", "done": False}]}],
                position=pos))
        db.add(Task(user_id=user_id, stream="studio", lane="next", lane_position=0, text="Open item", done=False, status="open",
                    products=[], blocked_by=[], goal_ref="g0000000"))
        await db.commit()


@pytest.mark.asyncio
async def test_new_quarter_carries_blocks_with_empty_goals_and_is_idempotent(auth_client):
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
    await _seed_q4(user_id)
    new_year = date(2027, 1, 4)
    async with TestSession() as db:
        assert await plan_v2.carry_streams(db, user_id, new_year) == 2
        await db.commit()
    async with TestSession() as db:
        assert await plan_v2.carry_streams(db, user_id, new_year) == 0  # second call: nothing
        await db.commit()
        rows = (await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2027-Q1").order_by(QuarterStream.position))).scalars().all()
        assert [(r.slug, r.name, r.color, r.icon, r.slot, r.position, r.status) for r in rows] == [
            ("studio", "Studio", "violet", "server", "OT", 0, "committed"), ("fitness", "Fitness", "violet", "server", "OT", 1, "committed")]
        assert all(r.goal == "" and r.goal_checklist == [] and r.checkpoints == [] and r.has_pipeline and r.weekly for r in rows)
        assert (await db.execute(select(Quarter).where(Quarter.label == "2027-Q1"))).scalar_one().objective
        old = (await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2026-Q4"))).scalars().all()
        assert all(r.goal and r.goal_checklist and r.checkpoints for r in old)  # the old quarter is untouched


@pytest.mark.asyncio
async def test_plan_reads_on_the_first_day_of_a_new_quarter(auth_client, monkeypatch):
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
    await _seed_q4(user_id)
    monkeypatch.setattr(vault, "_local_now", lambda: datetime(2027, 1, 4, 9, 0))
    quarter = (await auth_client.get(f"{V}/quarter")).json()
    assert quarter["quarter"] == "2027-Q1" and [s["stream"] for s in quarter["streams"]] == ["studio", "fitness"]
    assert all(s["goal_checklist"] == [] and s["checkpoints"] == [] for s in quarter["streams"])
    pipelines = (await auth_client.get(f"{V}/pipelines")).json()
    studio = next(s for s in pipelines["streams"] if s["stream"] == "studio")
    assert [i["text"] for i in studio["items"]] == ["Open item"]  # items follow the slug into the carried block
    # the item is still nested under last quarter's goal, which the response names so the page can mark it ended
    assert studio["ended_goals"] == [{"id": "g0000000", "text": "Ship DNS", "quarter": "2026-Q4"}]
    assert (await auth_client.get(f"{V}/quarter")).json()["streams"] == quarter["streams"]  # a second read adds no duplicates
    async with TestSession() as db:
        assert len((await db.execute(select(QuarterStream).where(QuarterStream.quarter == "2027-Q1"))).scalars().all()) == 2
    # a goal of the ended quarter cannot be picked now, a new one can be added through the existing endpoint
    item = studio["items"][0]
    assert (await auth_client.put(f"{V}/pipeline/goal", json=_ref("studio", item["line"], goal_ref="g0000000"))).status_code == 422
    assert (await auth_client.put(f"{V}/quarter/stream", json={"stream": "studio", "goal_checklist": [{"text": "Q1 goal"}]})).status_code == 200


@pytest.mark.asyncio
async def test_carry_does_nothing_without_an_earlier_quarter(auth_client):
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        assert await plan_v2.carry_streams(db, user_id, date(2027, 1, 4)) == 0


def test_checkpoint_of_follows_the_quarter():
    assert plan_v2.checkpoint_of("2026-11", "2026-Q4") == "nov"
    assert plan_v2.checkpoint_of("2027-01", "2026-Q4") is None
    assert plan_v2.checkpoint_of(None, "2026-Q4") is None
    assert quarter_for(date(2026, 11, 9)) == "2026-Q4"
