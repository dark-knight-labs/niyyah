import pytest

V = "/api/v1/vault"


async def _blocks(client):
    return [b["key"] for b in (await client.get(f"{V}/config/blocks")).json()["blocks"]]


async def _habit(client, **extra):
    block = (await _blocks(client))[0]
    res = await client.post(f"{V}/habits", json={"name": "  Walk   20 min ", "block": block, **extra})
    assert res.status_code == 200, res.text
    return res.json()["habits"][-1]


@pytest.mark.asyncio
async def test_add_cleans_and_lists(auth_client):
    h = await _habit(auth_client, anchor="After Asr", per_week=3, minimum="5 min")
    assert (h["name"], h["anchor"], h["per_week"], h["minimum"], h["stage"]) == ("Walk 20 min", "After Asr", 3, "5 min", "installing")
    assert h["today"] is None and h["gate_run"] == 0 and h["tripwire"] is None and len(h["weeks"]) == 12
    assert (await auth_client.post(f"{V}/habits", json={"name": "x", "block": "nope"})).status_code == 422
    assert (await auth_client.post(f"{V}/habits", json={"name": " ", "block": "soul"})).status_code == 422
    assert (await auth_client.post(f"{V}/habits", json={"name": "x", "block": "soul", "per_week": 9})).status_code == 422


@pytest.mark.asyncio
async def test_check_sets_levels_and_clears(auth_client):
    from app.api.v1.vault import _local_now
    today = _local_now().date().isoformat()
    h = await _habit(auth_client)
    for level in ("done", "min"):
        data = (await auth_client.put(f"{V}/habits/{h['id']}/check", json={"day": today, "level": level})).json()
        assert data["habits"][0]["today"] == level and data["habits"][0]["streak"] == 1
    data = (await auth_client.put(f"{V}/habits/{h['id']}/check", json={"day": today, "level": None})).json()
    assert data["habits"][0]["today"] is None
    assert (await auth_client.put(f"{V}/habits/{h['id']}/check", json={"day": today, "level": "great"})).status_code == 422
    assert (await auth_client.put(f"{V}/habits/{h['id']}/check", json={"day": "2020-01-01", "level": "done"})).status_code == 422
    assert (await auth_client.put(f"{V}/habits/999/check", json={"day": today, "level": "done"})).status_code == 422


@pytest.mark.asyncio
async def test_demote_needs_tripwire_below_gate_and_a_met_gate(auth_client):
    h = await _habit(auth_client)
    url = f"{V}/habits/{h['id']}"
    res = await auth_client.put(url, json={"stage": "rails"})
    assert res.status_code == 422 and "tripwire" in res.json()["detail"]
    res = await auth_client.put(url, json={"stage": "rails", "trip_pct": 80, "trip_weeks": 2})
    assert res.status_code == 422 and "below the gate" in res.json()["detail"]
    res = await auth_client.put(url, json={"stage": "rails", "trip_pct": 60, "trip_weeks": 2})
    assert res.status_code == 422 and "gate is not met" in res.json()["detail"]
    res = await auth_client.put(url, json={"stage": "rails", "trip_pct": 60, "trip_weeks": 2, "force": True})
    assert res.status_code == 200 and res.json()["habits"][0]["stage"] == "rails"
    assert res.json()["habits"][0]["tripwire"] == "quiet"  # a young habit has too few finished weeks to fire


@pytest.mark.asyncio
async def test_gate_run_counts_weeks_and_tripwire_fires(db_client):
    from datetime import timedelta
    from app.api.v1.vault import _local_now
    from app.models.planner import PlannerHabit, PlannerHabitCheck
    from app.models.user import User
    from sqlalchemy import select
    from tests.conftest import TestSession

    client, _ = db_client
    h = await _habit(client, per_week=2)
    today = _local_now().date()
    monday = today - timedelta(days=today.weekday())
    async with TestSession() as db:
        user = (await db.execute(select(User))).scalars().first()
        # The three finished weeks before this one: two checks each (met), then one week with none.
        for w in (1, 2, 3):
            for d in (0, 1):
                db.add(PlannerHabitCheck(user_id=user.id, habit_id=h["id"], day=monday - timedelta(weeks=w) + timedelta(days=d), level="done"))
        await db.commit()
    got = (await client.get(f"{V}/habits")).json()["habits"][0]
    assert got["gate_run"] == 3 and got["gate_met"] is False
    async with TestSession() as db:
        row = (await db.execute(select(PlannerHabit))).scalars().first()
        row.stage, row.trip_pct, row.trip_weeks = "rails", 50, 2
        row.started_on = monday - timedelta(weeks=5)
        await db.commit()
    assert (await client.get(f"{V}/habits")).json()["habits"][0]["tripwire"] == "quiet"
    async with TestSession() as db:
        await db.execute(PlannerHabitCheck.__table__.delete())
        await db.commit()
    assert (await client.get(f"{V}/habits")).json()["habits"][0]["tripwire"] == "fired"


@pytest.mark.asyncio
async def test_delete_and_export_import_round_trip(auth_client):
    from app.api.v1.vault import _local_now
    today = _local_now().date().isoformat()
    h = await _habit(auth_client, per_week=5)
    await auth_client.put(f"{V}/habits/{h['id']}/check", json={"day": today, "level": "min"})
    snap = (await auth_client.get("/api/v1/export")).json()
    assert snap["habits"][0]["name"] == "Walk 20 min" and snap["habits"][0]["checks"] == {today: "min"}
    res = await auth_client.post("/api/v1/import?replace=true", json=snap)
    assert res.status_code == 200, res.text
    again = (await auth_client.get(f"{V}/habits")).json()["habits"]
    assert len(again) == 1 and again[0]["today"] == "min" and again[0]["per_week"] == 5
    assert (await auth_client.delete(f"{V}/habits/{again[0]['id']}")).json()["habits"] == []
    snap.pop("habits")  # an export from before habits still imports
    assert (await auth_client.post("/api/v1/import?replace=true", json=snap)).status_code == 200
