from datetime import date

import pytest

from app.services.vault_notebook import (
    add_entry, notebook_path, parse_notebook, remove_entry, set_blocker, set_entry,
)

TODAY = date(2026, 10, 7)


def test_path_rejects_a_bad_stream():
    assert notebook_path("kahf") == "Efforts/Streams/kahf.md"
    with pytest.raises(ValueError):
        notebook_path("../etc")


def test_add_builds_the_note_and_parses_back_newest_first():
    out = add_entry(None, "kahf", "Kahf", "idea", "Passkeys", "cheaper than SSO", TODAY)
    out = add_entry(out, "kahf", "Kahf", "meeting", "Sync", "agreed scope\n- [ ] send spec", date(2026, 10, 8))
    assert out.startswith("---\ntype: stream-notes\nstream: kahf\n---\n# Kahf notebook\n")
    entries = parse_notebook(out)
    assert [(e["kind"], e["title"], e["date"]) for e in entries] == [("meeting", "Sync", "2026-10-08"), ("idea", "Passkeys", "2026-10-07")]
    assert entries[0]["body"] == "agreed scope\n- [ ] send spec"
    assert entries[1]["open"] is None


def test_blocker_starts_open_and_toggles():
    out = add_entry(None, "kahf", "Kahf", "blocker", "Waiting on legal", "owner: legal", TODAY)
    e = parse_notebook(out)[0]
    assert e["open"] is True
    out = set_blocker(out, e["line"], e["hash"], False)
    assert parse_notebook(out)[0]["open"] is False
    e = parse_notebook(out)[0]
    out = set_blocker(out, e["line"], e["hash"], True)
    assert parse_notebook(out)[0]["open"] is True


def test_link_entry_exposes_its_url():
    out = add_entry(None, "kahf", "Kahf", "link", "WebAuthn guide", "https://webauthn.guide good recovery section", TODAY)
    assert parse_notebook(out)[0]["url"] == "https://webauthn.guide"
    out = add_entry(out, "kahf", "Kahf", "idea", "x", "see https://a.b", TODAY)
    assert parse_notebook(out)[0]["url"] is None


def test_blank_title_falls_back_to_the_first_body_line_then_the_kind():
    out = add_entry(None, "kahf", "Kahf", "idea", "", "first line\nsecond", TODAY)
    out = add_entry(out, "kahf", "Kahf", "idea", "", "", TODAY)
    assert [e["title"] for e in parse_notebook(out)] == ["Idea", "first line"]


def test_body_headings_are_demoted_so_they_cannot_split_the_entry():
    out = add_entry(None, "kahf", "Kahf", "brainstorm", "Shape", "# top\n## sub\nplain", TODAY)
    entries = parse_notebook(out)
    assert len(entries) == 1 and entries[0]["body"] == "### top\n### sub\nplain"


def test_edit_replaces_title_and_body_and_refuses_a_stale_entry():
    out = add_entry(None, "kahf", "Kahf", "idea", "Old", "old body", TODAY)
    out = add_entry(out, "kahf", "Kahf", "idea", "Other", "keep", TODAY)
    target = [e for e in parse_notebook(out) if e["title"] == "Old"][0]
    edited = set_entry(out, target["line"], target["hash"], "New", "new body\nmore")
    got = {e["title"]: e for e in parse_notebook(edited)}
    assert got["New"]["body"] == "new body\nmore" and got["New"]["date"] == "2026-10-07" and got["Other"]["body"] == "keep"
    with pytest.raises(ValueError):
        set_entry(edited, target["line"], target["hash"], "Again", "x")  # hash is stale now


def test_remove_drops_only_that_entry():
    out = add_entry(None, "kahf", "Kahf", "idea", "A", "a", TODAY)
    out = add_entry(out, "kahf", "Kahf", "idea", "B", "b", TODAY)
    a = [e for e in parse_notebook(out) if e["title"] == "A"][0]
    out = remove_entry(out, a["line"], a["hash"])
    assert [e["title"] for e in parse_notebook(out)] == ["B"]


def test_limits_and_unknown_kind():
    with pytest.raises(ValueError):
        add_entry(None, "kahf", "Kahf", "gossip", "x", "y", TODAY)
    with pytest.raises(ValueError):
        add_entry(None, "kahf", "Kahf", "idea", "x" * 201, "y", TODAY)
    with pytest.raises(ValueError):
        add_entry(None, "kahf", "Kahf", "idea", "x", "y" * 8001, TODAY)


# --- endpoints ---------------------------------------------------------------------------------------------------

import datetime as dt  # noqa: E402

from httpx import AsyncClient  # noqa: E402

from app.services import vault_git  # noqa: E402
from tests.test_vault_write import QUARTER, _remote_file, vault  # noqa: E402, F401


@pytest.mark.asyncio
async def test_endpoints_notebook(auth_client: AsyncClient, vault, monkeypatch):
    remote, _ = vault
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: dt.datetime(2026, 10, 7, 9, 0))
    vault_git.commit_edits({"Calendar/Quarterly/2026-Q4.md": lambda c: QUARTER}, "seed quarter")
    base = "/api/v1/vault"

    r = await auth_client.post(f"{base}/notebook/kahf/entries", json={"kind": "blocker", "title": "Waiting on legal", "body": "owner: legal"})
    assert r.status_code == 200, r.text
    assert "[kind:: blocker] [date:: 2026-10-07] [status:: open]" in _remote_file(remote, "Efforts/Streams/kahf.md")
    await auth_client.post(f"{base}/notebook/kahf/entries", json={"kind": "idea", "title": "Passkeys", "body": ""})

    data = (await auth_client.get(f"{base}/notebooks")).json()
    kahf = [s for s in data["streams"] if s["stream"] == "kahf"][0]
    assert [e["title"] for e in kahf["entries"]] == ["Passkeys", "Waiting on legal"] and kahf["path"] == "Efforts/Streams/kahf.md"
    blocker = kahf["entries"][1]
    ref = {"stream": "kahf", "line": blocker["line"], "hash": blocker["hash"]}

    assert (await auth_client.put(f"{base}/notebook/blocker", json={**ref, "open": False})).status_code == 200
    assert "[status:: cleared]" in _remote_file(remote, "Efforts/Streams/kahf.md")
    assert (await auth_client.put(f"{base}/notebook/blocker", json={**ref, "open": True})).status_code == 422  # stale ref
    kahf = [s for s in (await auth_client.get(f"{base}/notebooks")).json()["streams"] if s["stream"] == "kahf"][0]
    idea = kahf["entries"][0]
    ref = {"stream": "kahf", "line": idea["line"], "hash": idea["hash"]}
    assert (await auth_client.put(f"{base}/notebook/blocker", json={**ref, "open": False})).status_code == 422  # not a blocker
    assert (await auth_client.put(f"{base}/notebook/entry", json={**ref, "title": "Passkeys first", "body": "ship before SSO"})).status_code == 200
    kahf = [s for s in (await auth_client.get(f"{base}/notebooks")).json()["streams"] if s["stream"] == "kahf"][0]
    idea = kahf["entries"][0]
    assert idea["title"] == "Passkeys first" and idea["body"] == "ship before SSO"
    ref = {"stream": "kahf", "line": idea["line"], "hash": idea["hash"]}
    assert (await auth_client.post(f"{base}/notebook/remove", json=ref)).status_code == 200
    assert [e["title"] for e in [s for s in (await auth_client.get(f"{base}/notebooks")).json()["streams"] if s["stream"] == "kahf"][0]["entries"]] == ["Waiting on legal"]

    assert (await auth_client.post(f"{base}/notebook/kahf/entries", json={"kind": "gossip", "title": "x", "body": "y"})).status_code == 422
    assert (await auth_client.post(f"{base}/notebook/nope/entries", json={"kind": "idea", "title": "x", "body": "y"})).status_code == 422


# --- pipeline items blocked by a notebook blocker ---------------------------------------------------------------

def test_blocked_by_is_kept_out_of_the_description_and_survives_describing():
    from app.services.vault_pipeline import add_items, parse_pipeline, set_blocked_by, set_description
    out = add_items(None, "kahf", ["SSO login"], "next", TODAY)
    i = parse_pipeline(out, TODAY)[0]
    out = set_description(out, i["line"], i["hash"], "needs the DPA")
    i = parse_pipeline(out, TODAY)[0]
    out = set_blocked_by(out, i["line"], i["hash"], ["Waiting on legal", " Waiting  on legal ", "Cloudflare token"])
    i = parse_pipeline(out, TODAY)[0]
    assert i["blocked_by"] == ["Waiting on legal", "Cloudflare token"] and i["description"] == "needs the DPA"
    assert "  blocked-by:: Waiting on legal\n  blocked-by:: Cloudflare token\n  needs the DPA" in out
    out = set_description(out, i["line"], i["hash"], "")  # clearing the description keeps the links
    i = parse_pipeline(out, TODAY)[0]
    assert i["blocked_by"] == ["Waiting on legal", "Cloudflare token"] and i["description"] == ""
    out = set_blocked_by(out, i["line"], i["hash"], [])
    i = parse_pipeline(out, TODAY)[0]
    assert i["blocked_by"] == [] and "blocked-by" not in out
    with pytest.raises(ValueError):
        set_blocked_by(out, i["line"], "deadbeef00", ["x"])
