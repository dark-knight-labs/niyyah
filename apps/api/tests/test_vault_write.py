import subprocess
from datetime import date
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services import vault_git
from app.services.vault_parser import parse_daily_note
from app.services.vault_write import add_log_note, new_daily_note, set_mode, set_vote

NOTE = """---
id: 20260923-daily
title: Wednesday, September 23 2026
type: daily
mode: full
stars: 0
possible: 21
---
# Wednesday, 23rd September, 2026

## Votes

> [!soul]+ Soul
> - [ ] ⭐ Bare Minimum
> - [x] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

> [!body]+ Body
> - [ ] ⭐ Bare Minimum
> - [ ] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

## Focus
- Most important thing today:

## Log
-

## Captured (triage later → Knowledge/Projects)
*

## Reflection
- Win:
- Friction:
- Tomorrow:
"""


def test_set_mode_rewrites_only_the_mode_line():
    out = set_mode(NOTE, "yellow")
    assert "mode: yellow" in out and "mode: full" not in out
    assert out.replace("mode: yellow", "mode: full") == NOTE


def test_set_mode_rejects_unknown_mode():
    with pytest.raises(ValueError):
        set_mode(NOTE, "party")


@pytest.mark.parametrize("stars", [0, 1, 2, 3])
def test_set_vote_ticks_exactly_that_level(stars):
    out = set_vote(NOTE, "body", stars)
    parsed = parse_daily_note(out, date(2026, 9, 23))
    assert parsed.blocks.get("body", 0) == stars
    assert parsed.blocks["soul"] == 2  # other blocks untouched


def test_set_vote_rejects_bad_input():
    for block, stars in [("nope", 1), ("body", 4), ("ops", 1)]:
        with pytest.raises(ValueError):
            set_vote(NOTE, block, stars)


def test_add_log_note_replaces_the_placeholder_and_appends():
    once = add_log_note(NOTE, "14:05", "OT", "06:00-16:03", "Shipped the thing")
    assert "## Log\n- 14:05 · OT (06:00-16:03): Shipped the thing\n\n## Captured" in once
    twice = add_log_note(once, "15:10", "Body", "17:42-18:57", "Legs day")
    log = twice.split("## Log")[1].split("## Captured")[0].strip().split("\n")
    assert log == ["- 14:05 · OT (06:00-16:03): Shipped the thing", "- 15:10 · Body (17:42-18:57): Legs day"]


def test_add_log_note_rejects_empty_and_huge_text():
    with pytest.raises(ValueError):
        add_log_note(NOTE, "14:05", "OT", "x", "   ")
    with pytest.raises(ValueError):
        add_log_note(NOTE, "14:05", "OT", "x", "a" * 501)


def test_new_daily_note_keeps_layout_but_no_content():
    ticked = set_vote(NOTE, "body", 3) + "\nbackfilled: true\n"
    fresh = new_daily_note(ticked, date(2026, 9, 23), date(2026, 10, 6))
    assert "id: 20261006-daily" in fresh and "title: Tuesday, October 6 2026" in fresh
    assert "# Tuesday, 6th October, 2026" in fresh
    assert "[x]" not in fresh and "backfilled" not in fresh
    assert set(parse_daily_note(fresh, date(2026, 10, 6)).blocks.values()) == {0}  # no votes carried over
    assert "## Votes" in fresh and "> [!soul]+ Soul" in fresh


# --- the git path, against a real throwaway remote --------------------------------------------------------

def _git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


@pytest.fixture
def vault(tmp_path, monkeypatch):
    remote, seed, work = tmp_path / "remote.git", tmp_path / "seed", tmp_path / "work"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    subprocess.run(["git", "clone", "-q", str(remote), str(seed)], check=True, capture_output=True)
    (seed / "Calendar" / "Daily").mkdir(parents=True)
    (seed / "Calendar" / "Daily" / "2026-09-23.md").write_text(NOTE, encoding="utf-8")
    _git(seed, "add", "-A"); _git(seed, "commit", "-q", "-m", "seed"); _git(seed, "push", "-q", "origin", "HEAD:main")
    subprocess.run(["git", "clone", "-q", str(remote), str(work)], check=True, capture_output=True)
    monkeypatch.setattr(settings, "vault_workdir", str(work))
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    return remote, work


def _remote_file(remote, rel):
    return subprocess.run(["git", "--git-dir", str(remote), "show", f"main:{rel}"], check=True, capture_output=True, text=True).stdout


def test_commit_edits_pushes_to_the_remote(vault):
    remote, _ = vault
    sha = vault_git.commit_edits({"Calendar/Daily/2026-09-23.md": lambda c: set_mode(c, "yellow")}, "test edit")
    assert "mode: yellow" in _remote_file(remote, "Calendar/Daily/2026-09-23.md")
    assert sha == subprocess.run(["git", "--git-dir", str(remote), "rev-parse", "--short", "main"], capture_output=True, text=True).stdout.strip()


def test_commit_edits_survives_someone_else_pushing_first(vault, tmp_path):
    remote, _ = vault
    other = tmp_path / "other"
    subprocess.run(["git", "clone", "-q", str(remote), str(other)], check=True, capture_output=True)
    (other / "Calendar" / "Daily" / "2026-09-23.md").write_text(NOTE.replace("- Win:", "- Win: from Obsidian"), encoding="utf-8")
    _git(other, "commit", "-qam", "obsidian edit"); _git(other, "push", "-q", "origin", "HEAD:main")
    vault_git.commit_edits({"Calendar/Daily/2026-09-23.md": lambda c: set_mode(c, "minimal")}, "niyyah edit")
    final = _remote_file(remote, "Calendar/Daily/2026-09-23.md")
    assert "mode: minimal" in final and "Win: from Obsidian" in final  # both edits kept, no conflict


@pytest.mark.asyncio
async def test_endpoint_edits_vote_and_creates_a_missing_day(auth_client: AsyncClient, vault, monkeypatch):
    remote, _ = vault
    today = date.today().isoformat()
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: __import__("datetime").datetime.now())

    r = await auth_client.put(f"/api/v1/vault/day/{today}/vote", json={"block": "body", "stars": 3})
    assert r.status_code == 200, r.text
    assert r.json()["day"]["blocks"]["body"] == 3
    assert f"Calendar/Daily/{today}.md" in subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"], capture_output=True, text=True).stdout

    r = await auth_client.post(f"/api/v1/vault/day/{today}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Deep session"})
    assert r.status_code == 200
    assert "OT (06:00-16:03): Deep session" in _remote_file(remote, f"Calendar/Daily/{today}.md")


@pytest.mark.asyncio
async def test_endpoint_refuses_non_owners_and_old_days_and_bad_input(auth_client: AsyncClient, vault, monkeypatch):
    today = date.today().isoformat()
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: __import__("datetime").datetime.now())
    assert (await auth_client.get("/api/v1/vault/edit-access")).json() == {"allowed": True}
    assert (await auth_client.put("/api/v1/vault/day/2020-01-01/mode", json={"mode": "full"})).status_code == 422
    assert (await auth_client.put(f"/api/v1/vault/day/{today}/mode", json={"mode": "party"})).status_code == 422
    assert (await auth_client.put(f"/api/v1/vault/day/{today}/vote", json={"block": "body", "stars": 9})).status_code == 422
    monkeypatch.setattr(settings, "vault_write_emails", "")
    assert (await auth_client.get("/api/v1/vault/edit-access")).json() == {"allowed": False}
    assert (await auth_client.put(f"/api/v1/vault/day/{today}/mode", json={"mode": "full"})).status_code == 403
