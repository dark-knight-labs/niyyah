import pytest

from tests.sample_snapshot import sample_snapshot

V = "/api/v1/vault"
STREAM = f"{V}/quarter/stream"


async def _quarter(client):
    return (await client.get(f"{V}/quarter")).json()


def _stream(q, slug="studio"):
    return next(s for s in q["streams"] if s["stream"] == slug)


async def _month(client):
    return (await _quarter(client))["current_month"]


@pytest.mark.asyncio
async def test_goal_lines_replace_and_the_summary_follows(db_client):
    client, _ = db_client
    res = await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": " Waist at  34 "}, {"text": "Cardio 3x a week", "done": True}]})
    assert res.status_code == 200
    s = _stream(res.json())
    assert [(i["text"], i["done"]) for i in s["goal_checklist"]] == [("Waist at 34", False), ("Cardio 3x a week", True)]
    assert all(len(i["id"]) >= 4 for i in s["goal_checklist"]) and s["goal"] == "Waist at 34 · Cardio 3x a week"


@pytest.mark.asyncio
async def test_each_month_holds_its_own_lines(db_client):
    client, _ = db_client
    month = await _month(client)
    res = await client.put(STREAM, json={"stream": "studio", "month_checklists": {month: [{"text": '36"'}, {"text": "Walk 8k steps"}]}})
    cp = next(c for c in _stream(res.json())["checkpoints"] if c["month"] == month)
    assert [i["text"] for i in cp["checklist"]] == ['36"', "Walk 8k steps"] and cp["text"] == '36" · Walk 8k steps'


@pytest.mark.asyncio
async def test_ticking_a_line_changes_only_its_flag(db_client):
    client, _ = db_client
    first = _stream((await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": "One"}, {"text": "Two"}]})).json())
    target = first["goal_checklist"][1]["id"]
    res = await client.put(f"{STREAM}/item", json={"stream": "studio", "scope": "goal", "id": target, "done": True})
    s = _stream(res.json())
    assert [(i["text"], i["done"]) for i in s["goal_checklist"]] == [("One", False), ("Two", True)] and s["goal"] == "One · Two"
    month = await _month(client)
    mid = _stream((await client.put(STREAM, json={"stream": "studio", "month_checklists": {month: [{"text": "A"}]}})).json())
    line = next(c for c in mid["checkpoints"] if c["month"] == month)["checklist"][0]["id"]
    res = await client.put(f"{STREAM}/item", json={"stream": "studio", "scope": month, "id": line, "done": True})
    assert next(c for c in _stream(res.json())["checkpoints"] if c["month"] == month)["checklist"][0]["done"] is True


@pytest.mark.asyncio
async def test_a_tick_on_something_that_is_gone_is_refused(db_client):
    client, _ = db_client
    month = await _month(client)
    for body in [{"stream": "studio", "scope": "goal", "id": "nope1234", "done": True},
                 {"stream": "ghost", "scope": "goal", "id": "nope1234", "done": True},
                 {"stream": "studio", "scope": "not-a-scope", "id": "nope1234", "done": True},
                 {"stream": "studio", "scope": month, "id": "nope1234", "done": True}]:
        assert (await client.put(f"{STREAM}/item", json=body)).status_code == 422, body


@pytest.mark.asyncio
async def test_plain_text_goals_become_one_line_and_can_be_ticked(db_client):
    client, _ = db_client
    s = _stream(await _quarter(client))  # the sample goal was written before checklists
    assert [i["text"] for i in s["goal_checklist"]] == ["Ship DNS"] and s["goal_checklist"][0]["done"] is False
    res = await client.put(f"{STREAM}/item", json={"stream": "studio", "scope": "goal", "id": s["goal_checklist"][0]["id"], "done": True})
    assert _stream(res.json())["goal_checklist"][0]["done"] is True
    plain = await client.put(STREAM, json={"stream": "studio", "goal": "A new plain goal"})
    assert [i["text"] for i in _stream(plain.json())["goal_checklist"]] == ["A new plain goal"]


@pytest.mark.asyncio
async def test_lines_are_validated(db_client):
    client, _ = db_client
    too_many = [{"text": f"line {n}"} for n in range(16)]
    assert (await client.put(STREAM, json={"stream": "studio", "goal_checklist": too_many})).status_code == 422
    assert (await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": "x" * 401}]})).status_code == 422
    kept = await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": "   "}, {"text": "real"}, {"id": "same1234", "text": "a"}, {"id": "same1234", "text": "b"}]})
    lines = _stream(kept.json())["goal_checklist"]
    assert [i["text"] for i in lines] == ["real", "a", "b"] and len({i["id"] for i in lines}) == 3  # blanks dropped, ids stay unique
    month = await _month(client)
    other = {"stream": "studio", "month_checklists": {"jan" if month != "jan" else "feb": [{"text": "x"}]}}
    assert (await client.put(STREAM, json=other)).status_code == 422  # a month outside this quarter


@pytest.mark.asyncio
async def test_ids_survive_an_edit_so_ticks_stay_attached(db_client):
    client, _ = db_client
    first = _stream((await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": "One"}]})).json())["goal_checklist"][0]
    again = _stream((await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"id": first["id"], "text": "One, reworded", "done": True}]})).json())
    assert again["goal_checklist"] == [{"id": first["id"], "text": "One, reworded", "done": True}]


@pytest.mark.asyncio
async def test_one_users_streams_are_not_reachable_by_another(db_client):
    client, _ = db_client
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    mine = _stream(await _quarter(client))["goal_checklist"][0]["id"]
    res = await client.put(f"{STREAM}/item", json={"stream": "studio", "scope": "goal", "id": mine, "done": True}, headers=other)
    assert res.status_code == 422
    assert _stream(await _quarter(client))["goal_checklist"][0]["done"] is False


@pytest.mark.asyncio
async def test_goal_cards_take_their_progress_from_their_lines(db_client):
    client, _ = db_client
    cards = [{"title": "Ship it", "value": "Launch", "caption": "", "progress": 5, "checklist": [{"text": "Page", "done": True}, {"text": "Domain"}]},
             {"title": "Read", "value": "12 books", "caption": "", "progress": 40}]
    res = await client.put(f"{V}/config/goals", json={"items": cards})
    ship, read = res.json()["items"]
    assert ship["progress"] == 50 and [(i["text"], i["done"]) for i in ship["checklist"]] == [("Page", True), ("Domain", False)]
    assert read["progress"] == 40 and read["checklist"] == []  # no lines: the typed number stays
    domain = ship["checklist"][1]["id"]
    ticked = (await client.put(f"{V}/goals/item", json={"id": domain, "done": True})).json()["items"][0]
    assert ticked["progress"] == 100
    assert (await client.put(f"{V}/goals/item", json={"id": "nope1234", "done": True})).status_code == 422


@pytest.mark.asyncio
async def test_the_export_carries_the_lines_and_an_import_restores_them(db_client):
    client, _ = db_client
    await client.put(STREAM, json={"stream": "studio", "goal_checklist": [{"text": "One", "done": True}, {"text": "Two"}]})
    await client.put(f"{V}/config/goals", json={"items": [{"title": "G", "value": "v", "checklist": [{"text": "x", "done": True}]}]})
    snap = (await client.get("/api/v1/export")).json()
    studio = next(s for q in snap["quarters"] for s in q["streams"] if s["slug"] == "studio")
    assert [i["text"] for i in studio["goal_checklist"]] == ["One", "Two"] and studio["goal"] == "One · Two"
    assert snap["goals"][0]["checklist"][0]["done"] is True and snap["goals"][0]["progress"] == 100
    await client.post("/api/v1/auth/register", json={"email": "o2@niyyah.app", "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": "o2@niyyah.app", "password": "otherpass123"})).json()["access_token"]
    other = {"Authorization": f"Bearer {token}"}
    assert (await client.post("/api/v1/import?replace=true", json=snap, headers=other)).status_code == 200
    again = (await client.get("/api/v1/export", headers=other)).json()
    back = next(s for q in again["quarters"] for s in q["streams"] if s["slug"] == "studio")
    assert back["goal_checklist"] == studio["goal_checklist"] and again["goals"][0]["checklist"] == snap["goals"][0]["checklist"]


@pytest.mark.asyncio
async def test_an_older_snapshot_with_only_text_imports_as_single_lines(db_client):
    client, today = db_client
    legacy = sample_snapshot(today)  # goals and checkpoints as plain text, no lines
    assert (await client.post("/api/v1/import?replace=true", json=legacy)).status_code == 200
    s = _stream(await _quarter(client))
    assert [i["text"] for i in s["goal_checklist"]] == ["Ship DNS"]
    assert all(len(c["checklist"]) == 1 for c in s["checkpoints"])
