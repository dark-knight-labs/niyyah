import pytest

V = "/api/v1/vault"


async def _pipeline(client, stream="studio"):
    data = (await client.get(f"{V}/pipelines")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["items"], data["week"]


def _ref(stream, item, **extra):
    return {"stream": stream, "line": item["line"], "hash": "", **extra}


@pytest.mark.asyncio
async def test_add_items_appends_to_a_lane(db_client):
    client, today = db_client
    res = await client.post(f"{V}/pipeline/studio/items",
                            json={"texts": ["Buy cables [product:: Router] #nov", "  "], "lane": "next", "descriptions": ["Cat6\nshielded", ""]})
    assert res.status_code == 200 and res.json()["commit"] == "db"
    items, _ = await _pipeline(client)
    new = items[-1]
    assert (new["text"], new["lane"], new["product"], new["checkpoint"], new["description"]) == \
        ("Buy cables", "next", "Router", "nov", "Cat6\nshielded")
    assert new["added"] == today.isoformat() and new["age_days"] == 0
    assert (await client.post(f"{V}/pipeline/studio/items", json={"texts": [" "], "lane": "next"})).status_code == 422
    assert (await client.post(f"{V}/pipeline/studio/items", json={"texts": ["x"], "lane": "done"})).status_code == 422
    assert (await client.post(f"{V}/pipeline/nope/items", json={"texts": ["x"], "lane": "next"})).status_code == 422


@pytest.mark.asyncio
async def test_move_stamps_done_and_reopens(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/move", json=_ref("studio", plan, lane="done"))
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    assert plan["lane"] == "done" and plan["done"] is True and plan["done_on"] == today.isoformat()
    await client.put(f"{V}/pipeline/move", json=_ref("studio", plan, lane="now"))
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    assert plan["lane"] == "now" and plan["done"] is False and plan["done_on"] is None
    assert (await client.put(f"{V}/pipeline/move", json=_ref("studio", plan, lane="sideways"))).status_code == 422


@pytest.mark.asyncio
async def test_text_keeps_product_dates_and_checkpoint(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    router = next(i for i in items if i["product"] == "Router")
    await client.put(f"{V}/pipeline/text", json=_ref("studio", router, text="Wire the new router"))
    items, _ = await _pipeline(client)
    router = next(i for i in items if i["product"] == "Router")
    assert router["text"] == "Wire the new router" and router["checkpoint"] is not None and router["focus"] is not None


@pytest.mark.asyncio
async def test_checkpoint_description_blockers_and_remove(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    item = next(i for i in items if i["lane"] == "backlog")
    await client.put(f"{V}/pipeline/checkpoint", json=_ref("studio", item, checkpoint="nov"))
    await client.put(f"{V}/pipeline/description", json=_ref("studio", item, description="Line one\n\nLine three  "))
    await client.put(f"{V}/pipeline/blocked-by", json=_ref("studio", item, ids=["abcd1234", "abcd1234"]))
    items, _ = await _pipeline(client)
    item = next(i for i in items if i["lane"] == "backlog")
    assert item["checkpoint"] == "nov" and item["description"] == "Line one\n\nLine three" and item["blocked_by"] == ["abcd1234"]
    assert (await client.put(f"{V}/pipeline/blocked-by", json=_ref("studio", item, ids=["BAD ID"]))).status_code == 422
    await client.post(f"{V}/pipeline/remove", json=_ref("studio", item))
    items, _ = await _pipeline(client)
    assert all(i["lane"] != "backlog" for i in items)
    assert (await client.post(f"{V}/pipeline/remove", json=_ref("studio", item))).status_code == 422


@pytest.mark.asyncio
async def test_focus_moves_the_marker_and_goes_to_now(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/focus", json=_ref("studio", plan))
    items, _ = await _pipeline(client)
    focused = [i for i in items if i["focus"] == week]
    assert [i["text"] for i in focused] == ["Plan the DNS cutover"] and focused[0]["lane"] == "now"


@pytest.mark.asyncio
async def test_another_users_item_is_not_reachable(db_client):
    client, today = db_client
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    items, _ = await _pipeline(client)
    res = await client.post(f"{V}/pipeline/remove", json=_ref("studio", items[0]), headers=other)
    assert res.status_code == 422
    assert len((await _pipeline(client))[0]) == len(items)


async def _objectives(client):
    return {i["stream"]: i for i in (await client.get(f"{V}/objectives")).json()["items"]}


@pytest.mark.asyncio
async def test_objective_text_done_and_checkpoint(db_client):
    client, today = db_client
    res = await client.put(f"{V}/objectives", json={"stream": "shop", "text": "  Launch   the store ", "checkpoint": "nov"})
    assert res.status_code == 200
    shop = (await _objectives(client))["shop"]
    assert (shop["text"], shop["done"], shop["checkpoint"]) == ("Launch the store", True, "nov")
    await client.put(f"{V}/objectives", json={"stream": "shop", "done": False})
    assert (await _objectives(client))["shop"]["done"] is False
    assert (await client.put(f"{V}/objectives", json={"stream": "nope", "text": "x"})).status_code == 422
    assert (await client.put(f"{V}/objectives", json={"stream": "shop", "text": "x" * 201})).status_code == 422


@pytest.mark.asyncio
async def test_an_objective_without_text_loses_its_checkpoint(db_client):
    client, today = db_client
    await client.put(f"{V}/objectives", json={"stream": "studio", "text": "", "checkpoint": "nov"})
    studio = (await _objectives(client))["studio"]
    assert (studio["text"], studio["checkpoint"]) == ("", None)


@pytest.mark.asyncio
async def test_objective_text_creates_and_links_the_small_domino(db_client):
    client, today = db_client
    await client.put(f"{V}/objectives", json={"stream": "studio", "text": "Cut over DNS"})
    items, week = await _pipeline(client)
    linked = [i for i in items if i["focus"] == week]
    assert [i["text"] for i in linked] == ["Cut over DNS"] and linked[0]["lane"] == "now"
    await client.put(f"{V}/objectives", json={"stream": "studio", "done": True})
    items, week = await _pipeline(client)
    assert next(i for i in items if i["focus"] == week)["lane"] == "done"


@pytest.mark.asyncio
async def test_finishing_the_small_domino_ticks_the_objective(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    domino = next(i for i in items if i["focus"] == week)
    await client.put(f"{V}/pipeline/move", json=_ref("studio", domino, lane="done"))
    assert (await _objectives(client))["studio"]["done"] is True
    items, week = await _pipeline(client)
    domino = next(i for i in items if i["focus"] == week)
    await client.post(f"{V}/pipeline/remove", json=_ref("studio", domino))
    assert (await _objectives(client))["studio"]["text"] == ""


@pytest.mark.asyncio
async def test_focus_writes_the_objective_line(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/focus", json=_ref("studio", plan))
    assert (await _objectives(client))["studio"]["text"] == "Plan the DNS cutover"


@pytest.mark.asyncio
async def test_super_objective_and_streams(db_client):
    client, today = db_client
    res = await client.put(f"{V}/quarter", json={"text": "  New   objective ", "arabic": ""})
    assert res.status_code == 200 and res.json()["objective"] == "New objective" and res.json()["objective_ar"] == ""
    changed = await client.put(f"{V}/quarter/stream", json={"stream": "studio", "name": "Studio Hosting", "color": "teal", "weekly": False,
                                                              "checkpoints": {"nov": "DNS live", "oct": "Router done"}})
    studio = next(s for s in changed.json()["streams"] if s["stream"] == "studio")
    assert (studio["name"], studio["color"], studio["weekly"]) == ("Studio Hosting", "teal", False)
    assert [(c["month"], c["text"]) for c in studio["checkpoints"]] == [("oct", "Router done"), ("nov", "DNS live")]
    assert (await client.put(f"{V}/quarter/stream", json={"stream": "studio", "color": "plaid"})).status_code == 422
    assert (await client.put(f"{V}/quarter/stream", json={"stream": "sleep", "name": "x"})).status_code == 422
    added = await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Errands", "goal": "Clear the list"})
    assert added.status_code == 200
    names = [s["stream"] for s in added.json()["streams"]]
    assert names[-1] == "errands" and added.json()["streams"][-1]["status"] == "committed"
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Again"})).status_code == 422
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "Bad Id", "name": "x"})).status_code == 422
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "noname"})).status_code == 422


async def _notebook(client, stream="studio"):
    data = (await client.get(f"{V}/notebooks")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["entries"]


@pytest.mark.asyncio
async def test_notebook_entries_come_newest_first(db_client):
    client, today = db_client
    res = await client.post(f"{V}/notebook/studio/entries", json={"kind": "blocker", "title": "", "body": "# Need approval\nfrom legal"})
    assert res.status_code == 200
    entries = await _notebook(client)
    first = entries[0]
    assert first["kind"] == "blocker" and first["open"] is True and first["date"] == today.isoformat()
    assert first["title"] == "### Need approval" and first["body"] == "### Need approval\nfrom legal" and len(first["id"]) == 8
    assert len(entries) == 3
    assert (await client.post(f"{V}/notebook/studio/entries", json={"kind": "poem", "title": "x", "body": ""})).status_code == 422
    assert (await client.post(f"{V}/notebook/nope/entries", json={"kind": "idea", "title": "x", "body": ""})).status_code == 422


@pytest.mark.asyncio
async def test_notebook_edit_blocker_and_remove(db_client):
    client, today = db_client
    entries = await _notebook(client)
    idea = next(e for e in entries if e["kind"] == "idea")
    blocker = next(e for e in entries if e["kind"] == "blocker")
    await client.put(f"{V}/notebook/entry", json=_ref("studio", idea, title="Passkeys v2", body="cheaper than SSO\nsee https://example.com/x"))
    await client.put(f"{V}/notebook/blocker", json=_ref("studio", blocker, open=False))
    entries = await _notebook(client)
    idea = next(e for e in entries if e["kind"] == "idea")
    blocker = next(e for e in entries if e["kind"] == "blocker")
    assert idea["title"] == "Passkeys v2" and idea["url"] == "https://example.com/x" and blocker["open"] is False
    assert (await client.put(f"{V}/notebook/blocker", json=_ref("studio", idea, open=False))).status_code == 422
    await client.post(f"{V}/notebook/remove", json=_ref("studio", idea))
    assert all(e["kind"] != "idea" for e in await _notebook(client))
    assert (await client.post(f"{V}/notebook/remove", json=_ref("studio", idea))).status_code == 422
