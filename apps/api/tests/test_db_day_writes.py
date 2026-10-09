import pytest


@pytest.mark.asyncio
async def test_fixture_gives_an_imported_user_in_db_mode(db_client):
    client, today = db_client
    day = (await client.get("/api/v1/vault/today")).json()
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}


V = "/api/v1/vault"


@pytest.mark.asyncio
async def test_vote_updates_the_day_totals(db_client):
    client, today = db_client
    res = await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    assert res.status_code == 200 and res.json()["commit"] == "db"
    assert res.json()["day"]["blocks"]["body"] == 3 and res.json()["day"]["total"] == 5


@pytest.mark.asyncio
async def test_vote_rejects_bad_input_with_the_vault_messages(db_client):
    client, today = db_client
    bad = await client.put(f"{V}/day/{today}/vote", json={"block": "nope", "stars": 1})
    assert bad.status_code == 422 and "unknown block" in bad.json()["detail"]
    legacy = await client.put(f"{V}/day/{today}/vote", json={"block": "ops", "stars": 1})
    assert legacy.status_code == 422 and "unknown block" in legacy.json()["detail"]  # not one of this user's blocks
    assert (await client.put(f"{V}/day/{today}/vote", json={"block": "soul", "stars": 4})).status_code == 422


@pytest.mark.asyncio
async def test_mode_change_recomputes_possible(db_client):
    client, today = db_client
    res = await client.put(f"{V}/day/{today}/mode", json={"mode": "yellow"})
    assert res.json()["day"]["mode"] == "yellow" and res.json()["day"]["possible"] == 12
    assert (await client.put(f"{V}/day/{today}/mode", json={"mode": "party"})).status_code == 422


@pytest.mark.asyncio
async def test_a_missing_day_is_created_from_the_current_blocks(db_client):
    from datetime import timedelta
    client, today = db_client
    day = today - timedelta(days=4)
    res = await client.put(f"{V}/day/{day}/vote", json={"block": "body", "stars": 2})
    assert res.status_code == 200
    assert res.json()["day"]["blocks"] == {"soul": 0, "body": 2, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0} and res.json()["day"]["mode"] == "full"


@pytest.mark.asyncio
async def test_note_is_appended_to_the_log_and_the_summary(db_client):
    client, today = db_client
    res = await client.post(f"{V}/day/{today}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Shipped it"})
    assert res.status_code == 200
    log = (await client.get(f"{V}/day/{today}/log")).json()
    assert [e["index"] for e in log] == [0, 1, 2] and log[2]["text"].endswith("OT (06:00-16:03): Shipped it")
    assert res.json()["day"]["log"].splitlines()[-1] == f"- {log[2]['text']}"
    empty = await client.post(f"{V}/day/{today}/notes", json={"section": "OT", "span": "x", "text": "   "})
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_task_lifecycle(db_client):
    client, today = db_client
    tasks = (await client.get(f"{V}/day/{today}/tasks")).json()
    first = tasks[0]
    done = await client.put(f"{V}/tasks", json={"path": first["path"], "line": first["line"], "hash": "", "done": True})
    assert done.status_code == 200
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["done"] is True
    await client.put(f"{V}/tasks/text", json={"path": first["path"], "line": first["line"], "hash": "", "text": "  Pay   the invoice "})
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["text"] == "Pay the invoice"
    await client.post(f"{V}/day/{today}/tasks", json={"text": "Call the bank"})
    assert [t["text"] for t in (await client.get(f"{V}/day/{today}/tasks")).json()] == ["Call the bank", "Pay the invoice", "Renew domain"]  # file path order, as in the vault
    gone = await client.post(f"{V}/tasks/remove", json={"path": first["path"], "line": first["line"], "hash": ""})
    assert gone.status_code == 200
    again = await client.post(f"{V}/tasks/remove", json={"path": first["path"], "line": first["line"], "hash": ""})
    assert again.status_code == 422
    assert (await client.post(f"{V}/day/{today}/tasks", json={"text": " "})).status_code == 422


@pytest.mark.asyncio
async def test_log_edit_and_remove_check_the_hash(db_client):
    client, today = db_client
    log = (await client.get(f"{V}/day/{today}/log")).json()
    stale = await client.put(f"{V}/day/{today}/log", json={"index": 0, "hash": "0000000000", "text": "x"})
    assert stale.status_code == 422
    ok = await client.put(f"{V}/day/{today}/log", json={"index": 0, "hash": log[0]["hash"], "text": "Rewritten"})
    assert ok.status_code == 200
    after = (await client.get(f"{V}/day/{today}/log")).json()
    assert after[0]["text"] == "Rewritten"
    await client.post(f"{V}/day/{today}/log/remove", json={"index": 0, "hash": after[0]["hash"]})
    final = (await client.get(f"{V}/day/{today}/log")).json()
    assert [(e["index"], e["text"]) for e in final] == [(0, "Second entry")]


@pytest.mark.asyncio
async def test_writes_only_touch_the_callers_rows(db_client):
    client, today = db_client
    await client.post(f"{V}/auth/register".replace("/vault", ""), json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    mine = (await client.get(f"{V}/day/{today}/tasks")).json()[0]
    res = await client.put(f"{V}/tasks", json={"path": "", "line": mine["line"], "hash": "", "done": True}, headers=other)
    assert res.status_code == 422  # not found for them
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["done"] is False


@pytest.mark.asyncio
async def test_a_block_added_later_joins_the_day_on_its_first_vote(db_client):
    client, today = db_client
    blocks = (await client.get(f"{V}/config/blocks")).json()["blocks"]
    blocks.append({"key": "reading", "label": "Reading", "ring_name": "READ", "color": "lime", "counts_for_stars": True, "archived": False})
    assert (await client.put(f"{V}/config/blocks", json={"blocks": blocks})).status_code == 200
    res = await client.put(f"{V}/day/{today}/vote", json={"block": "reading", "stars": 2})
    day = res.json()["day"]
    assert res.status_code == 200 and day["blocks"]["reading"] == 2 and day["total"] == 5 and day["possible"] == 21
