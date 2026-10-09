import copy

import pytest

from tests.sample_snapshot import sample_snapshot

I = "/api/v1/import?replace=true"
E = "/api/v1/export"


def _strip(snap):
    """What legitimately differs between two accounts holding the same data: ids and the account itself."""
    snap = copy.deepcopy(snap)
    snap.pop("user", None)
    for key in ("pipeline_items", "tasks"):
        for item in snap[key]:
            item.pop("id", None)
    return snap


async def _login(client, email):
    await client.post("/api/v1/auth/register", json={"email": email, "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": email, "password": "otherpass123"})).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_an_export_imports_into_another_account_unchanged(db_client):
    client, _ = db_client
    exported = (await client.get(E)).json()
    other = await _login(client, "other@niyyah.app")
    res = await client.post(I, json=exported, headers=other)
    assert res.status_code == 200 and res.json()["imported"]["days"] == 2
    again = (await client.get(E, headers=other)).json()
    assert _strip(again) == _strip(exported)


@pytest.mark.asyncio
async def test_importing_replaces_everything_the_account_had(db_client):
    client, today = db_client
    small = {"version": 1, "goals": [{"title": "Only", "value": "one"}]}
    assert (await client.post(I, json=small)).status_code == 200
    assert [g["title"] for g in (await client.get("/api/v1/vault/goals")).json()["items"]] == ["Only"]
    assert (await client.get("/api/v1/vault/today")).status_code == 404
    assert (await client.get("/api/v1/vault/config/blocks")).json()["blocks"] == []


@pytest.mark.asyncio
async def test_importing_never_touches_another_account(db_client):
    client, today = db_client
    other = await _login(client, "other@niyyah.app")
    assert (await client.post(I, json={"version": 1}, headers=other)).status_code == 200
    assert len((await client.get("/api/v1/vault/week")).json()["days"]) == 2  # the first account still has its days


@pytest.mark.asyncio
async def test_import_needs_replace_and_a_login_not_a_token(db_client):
    client, today = db_client
    assert (await client.post("/api/v1/import", json={"version": 1})).status_code == 422
    raw = (await client.post("/api/v1/tokens", json={"name": "t"})).json()["token"]
    assert (await client.post(I, json={"version": 1}, headers={"Authorization": f"Bearer {raw}"})).status_code == 401


@pytest.mark.asyncio
async def test_bad_payloads_are_refused_and_nothing_is_lost(db_client):
    client, today = db_client
    good = sample_snapshot(today)
    for bad in [{**good, "version": 2}, {**good, "days": good["days"] + [good["days"][0]]},
                {**good, "goals": [{"title": "x" * 201, "value": "v"}]}, {**good, "quarters": [{"label": "Q4", "streams": []}]},
                {**good, "pipeline_items": [{**good["pipeline_items"][0], "lane": "someday"}]},
                {**good, "feeds": [{"name": "f", "url": "http://insecure.example/x.ics"}]},
                {**good, "schedule": {"meta": {}, "days": {"funday": []}}}]:
        assert (await client.post(I, json=bad)).status_code == 422
    assert len((await client.get("/api/v1/vault/week")).json()["days"]) == 2


@pytest.mark.asyncio
async def test_votes_on_blocks_the_snapshot_does_not_list_get_a_plain_block(client):
    token = (await client.post("/api/v1/auth/register", json={"email": "a@niyyah.app", "password": "password123"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    day = {"date": "2026-10-01", "mode": "full", "possible": 3, "total": 2, "votes": {"mystery-block": 2}, "log": []}
    assert (await client.post(I, json={"version": 1, "days": [day]}, headers=h)).status_code == 200
    blocks = (await client.get("/api/v1/vault/config/blocks", headers=h)).json()["blocks"]
    assert [(b["key"], b["label"], b["counts_for_stars"]) for b in blocks] == [("mystery-block", "Mystery Block", True)]
