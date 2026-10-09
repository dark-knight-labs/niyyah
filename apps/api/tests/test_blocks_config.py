import pytest

V = "/api/v1/vault/config/blocks"


def _blocks(res):
    return res.json()["blocks"]


@pytest.mark.asyncio
async def test_db_mode_needs_a_login(client, monkeypatch):
    assert (await client.get(V)).status_code == 401


@pytest.mark.asyncio
async def test_replace_creates_renames_reorders_and_archives(db_client):
    client, _ = db_client
    current = _blocks(await client.get(V))
    assert [b["key"] for b in current if not b["archived"]][:2] == ["soul", "body"]
    new = [dict(b) for b in current]
    new[0]["label"] = "Spirit"
    new = [new[1], new[0], *new[2:]]  # body first
    new.append({"key": "reading", "label": "Reading", "ring_name": "read", "color": "lime", "counts_for_stars": False, "archived": False})
    res = await client.put(V, json={"blocks": [b for b in new if b["key"] != "distribution"]})  # omitting a key archives it
    assert res.status_code == 200
    out = {b["key"]: b for b in _blocks(res)}
    assert out["soul"]["label"] == "Spirit" and out["reading"]["ring_name"] == "READ"
    assert out["distribution"]["archived"] is True
    assert [b["key"] for b in _blocks(res)][:2] == ["body", "soul"]


@pytest.mark.asyncio
async def test_replace_rejects_bad_input(db_client):
    client, _ = db_client
    ok = {"key": "soul", "label": "Soul", "ring_name": "SOUL", "color": "emerald", "counts_for_stars": True, "archived": False}
    for bad, text in [
        ({**ok, "key": "Bad Key"}, "key"), ({**ok, "label": " "}, "name"), ({**ok, "ring_name": "TOOLONGNAME"}, "ring"),
        ({**ok, "color": "plaid"}, "colour"),
    ]:
        res = await client.put(V, json={"blocks": [bad]})
        assert res.status_code == 422, (bad, res.text)
    dup = await client.put(V, json={"blocks": [ok, ok]})
    assert dup.status_code == 422 and "twice" in dup.json()["detail"]
    none_active = await client.put(V, json={"blocks": [{**ok, "archived": True}]})
    assert none_active.status_code == 422 and "at least one" in none_active.json()["detail"]


@pytest.mark.asyncio
async def test_a_block_still_on_the_schedule_cannot_be_archived(db_client):
    client, _ = db_client
    current = _blocks(await client.get(V))
    on_schedule = next(b for b in current if b["key"] == "ot")  # the fixture schedule uses ot
    changed = [{**b, "archived": True} if b["key"] == "ot" else b for b in current]
    res = await client.put(V, json={"blocks": changed})
    assert res.status_code == 422 and "schedule" in res.json()["detail"] and on_schedule["label"] in res.json()["detail"]
