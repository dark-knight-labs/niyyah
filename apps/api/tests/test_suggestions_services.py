"""The services the suggestion lines call, checked against the routes that used to hold their logic inline.

Each coupling moved into a service (`pipeline_remove`, `week_objective_set`, the `week` of PUT /objectives, `unschedule`,
a flush-only compass update) must leave the same rows as before. The twins of move and focus are in test_suggestions_registry.py."""
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models.compass import Compass
from app.services import compass as compass_service
from app.services import planner_work
from app.services.rules import quarter_for, week_for
from tests.conftest import TestSession
from tests.suggestions_support import V, dump, second_account, task_ids, user_ids


@pytest.fixture
async def twins(db_client):
    client, today = db_client
    hb, b = await second_account(client, today)
    a = (await user_ids())[0]
    return client, today, a, b, hb


async def test_pipeline_remove_leaves_what_the_route_leaves(twins):
    client, today, a, b, hb = twins
    start = await dump(a)
    async with TestSession() as db:
        await planner_work.pipeline_remove(db, a, "studio", (await task_ids(a))["Wire the router"], today)
        await db.commit()
    res = await client.post(f"{V}/pipeline/remove", json={"stream": "studio", "line": (await task_ids(b))["Wire the router"]}, headers=hb)
    assert res.status_code == 200
    assert await dump(a) == await dump(b) != start


async def test_week_objective_set_for_this_week_is_what_the_route_does(twins):
    client, today, a, b, hb = twins
    async with TestSession() as db:
        await planner_work.week_objective_set(db, a, today, "studio", "Wire it again", True, None)
        await db.commit()
    res = await client.put(f"{V}/objectives", json={"stream": "studio", "text": "Wire it again", "done": True}, headers=hb)
    assert res.status_code == 200
    assert await dump(a) == await dump(b)


@pytest.mark.parametrize("weeks", [-5, -4, 0, 1, 13, 14])
async def test_the_week_window_of_put_objectives(db_client, weeks):
    """Within 4 weeks back and 13 ahead; the week's own quarter must have the stream (the sample account only has this quarter)."""
    client, today = db_client
    day = today + timedelta(days=7 * weeks)
    week = week_for(day)[2]
    res = await client.put(f"{V}/objectives", json={"stream": "studio", "week": week, "text": "Plan ahead"})
    if not -4 <= weeks <= 13:
        assert res.status_code == 422 and "within" in res.json()["detail"]
    elif quarter_for(planner_work.week_anchor(week)) != quarter_for(today) and weeks != 0:
        assert res.status_code == 422 and "unknown stream" in res.json()["detail"]
    else:
        assert res.status_code == 200, res.text
        assert res.json()["week"] == week
        assert next(i for i in res.json()["items"] if i["stream"] == "studio")["text"] == "Plan ahead"


@pytest.mark.parametrize("week", ["2026-W99", "2026-W00"])
async def test_a_week_that_does_not_exist_is_422(db_client, week):
    client, _ = db_client
    res = await client.put(f"{V}/objectives", json={"stream": "studio", "week": week, "text": "x"})
    assert res.status_code == 422


async def test_another_week_is_text_only_and_does_not_touch_the_pipeline(db_client):
    client, today = db_client
    before = await client.get(f"{V}/pipelines")
    week = week_for(today + timedelta(days=14))[2]
    assert (await client.put(f"{V}/objectives", json={"stream": "studio", "week": week, "text": "Two weeks on"})).status_code == 200
    assert (await client.get(f"{V}/pipelines")).json() == before.json()
    assert (await client.put(f"{V}/objectives", json={"stream": "nope", "week": week, "text": "x"})).status_code == 422


async def test_unschedule_clears_the_day_and_the_time(db_client):
    client, today = db_client
    made = (await client.post(f"{V}/items", json={"text": "Dentist", "day": today.isoformat(), "start_min": 600, "end_min": 660})).json()
    got = (await client.patch(f"{V}/items/{made['id']}", json={"unschedule": True})).json()
    assert got["scheduled_on"] is None and got["start_min"] is None and got["end_min"] is None
    assert (await client.patch(f"{V}/items/{made['id']}", json={"unschedule": False, "text": "Dentist 2"})).status_code == 200


async def test_unschedule_cannot_go_with_a_day_or_a_time(db_client):
    client, today = db_client
    made = (await client.post(f"{V}/items", json={"text": "Dentist", "day": today.isoformat()})).json()
    assert (await client.patch(f"{V}/items/{made['id']}", json={"unschedule": True, "day": today.isoformat()})).status_code == 422
    res = await client.patch(f"{V}/items/{made['id']}", json={"unschedule": True, "start_min": 600, "end_min": 660})
    assert res.status_code == 422 and "scheduled day" in res.json()["detail"]
    assert (await client.get(f"{V}/items", params={"from": today.isoformat(), "to": today.isoformat()})).json()["items"][0]["day"] == today.isoformat()


async def test_the_compass_update_only_flushes(auth_client):
    uid = (await user_ids())[0]
    async with TestSession() as db:
        await compass_service.update(db, uid, {"mission": "not committed"})
        async with TestSession() as other:
            assert (await other.execute(select(Compass))).scalars().all() == []
        await db.rollback()
    async with TestSession() as db:
        assert (await db.execute(select(Compass))).scalars().all() == []
        await compass_service.save(db, uid, {"mission": "committed"})
    async with TestSession() as db:
        assert (await db.execute(select(Compass.mission))).scalar_one() == "committed"
