import subprocess
from datetime import date
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services import vault_git
from app.services.vault_tasks import line_hash
from app.services.vault_parser import parse_daily_note
from app.services.vault_write import add_log_note, log_entries, new_daily_note, set_mode, set_vote

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


# --- tasks -----------------------------------------------------------------------------------------------------

from app.services.vault_tasks import find_tasks, line_hash, set_task_done, task_file  # noqa: E402

TASKS = """# Tasks
- [ ] Land Registry ⏳ 2026-10-05
- [x] Birth Certificate ⏳ 2026-10-05 ✅ 2026-10-05
- [ ] Other day 📅 2026-10-06
- [ ] ⭐ vote line ⏳ 2026-10-05
- [ ] no date
"""


def test_find_tasks_matches_day_and_skips_votes(tmp_path):
    (tmp_path / "Calendar").mkdir()
    (tmp_path / "Calendar" / "Tasks.md").write_text(TASKS, encoding="utf-8")
    (tmp_path / ".obsidian").mkdir()
    (tmp_path / ".obsidian" / "x.md").write_text("- [ ] hidden ⏳ 2026-10-05", encoding="utf-8")
    found = find_tasks(tmp_path, "2026-10-05")
    assert [(t.text, t.done, t.line) for t in found] == [("Land Registry", False, 2), ("Birth Certificate", True, 3)]


def test_set_task_done_ticks_and_unticks():
    line = TASKS.split("\n")[1]
    ticked = set_task_done(TASKS, 2, line_hash(line), True, "2026-10-05")
    assert ticked.split("\n")[1] == "- [x] Land Registry ⏳ 2026-10-05 ✅ 2026-10-05"
    again = set_task_done(ticked, 2, line_hash(ticked.split("\n")[1]), False, "2026-10-05")
    assert again == TASKS


def test_set_task_done_refuses_changed_line():
    with pytest.raises(ValueError, match="changed"):
        set_task_done(TASKS, 2, "deadbeef00", True, "2026-10-05")


def test_task_file_stays_inside_vault(tmp_path):
    (tmp_path / "a.md").write_text("x", encoding="utf-8")
    assert task_file(tmp_path, "a.md") == (tmp_path / "a.md").resolve()
    for bad in ("../a.md", "/etc/passwd", "missing.md"):
        with pytest.raises(ValueError):
            task_file(tmp_path, bad)


@pytest.mark.asyncio
async def test_endpoint_lists_and_ticks_a_task(auth_client: AsyncClient, vault):
    remote, _ = vault
    vault_git.commit_edits({"Calendar/Tasks.md": lambda _: TASKS}, "seed tasks")

    listed = await auth_client.get("/api/v1/vault/day/2026-10-05/tasks")
    assert listed.status_code == 200, listed.text
    task = next(t for t in listed.json() if t["text"] == "Land Registry")
    assert task["done"] is False

    r = await auth_client.put("/api/v1/vault/tasks", json={**{k: task[k] for k in ("path", "line", "hash")}, "done": True})
    assert r.status_code == 200, r.text
    assert "- [x] Land Registry ⏳ 2026-10-05 ✅" in _remote_file(remote, "Calendar/Tasks.md")

    stale = await auth_client.put("/api/v1/vault/tasks", json={**{k: task[k] for k in ("path", "line", "hash")}, "done": True})
    assert stale.status_code == 422  # the line changed since the page loaded


def test_add_task_goes_after_the_query_block():
    from app.services.vault_tasks import add_task
    note = "## Tasks\n\n```tasks\nnot done\n```\n\n## Log\n-\n"
    out = add_task(note, "Call bank", "2026-10-05")
    assert "```\n- [ ] Call bank ⏳ 2026-10-05\n\n## Log" in out
    assert "## Tasks\n- [ ] Call bank" in add_task("# x\n", "Call bank", "2026-10-05")
    with pytest.raises(ValueError):
        add_task(note, "  ", "2026-10-05")


# --- task text edit / remove -----------------------------------------------------------------------------------

def test_set_task_text_keeps_dates_and_done_mark():
    from app.services.vault_tasks import set_task_text
    done = "- [x] Birth Certificate 📅 2026-10-04 ⏳ 2026-10-05 ✅ 2026-10-05"
    out = set_task_text(f"# T\n{done}\n", 2, line_hash(done), "  Passport\n renewal ")
    assert out == "# T\n- [x] Passport renewal 📅 2026-10-04 ⏳ 2026-10-05 ✅ 2026-10-05\n"
    plain = set_task_text("- [ ] a\n", 1, line_hash("- [ ] a"), "b")
    assert plain == "- [ ] b\n"


def test_set_task_text_refuses_stale_and_bad_text():
    from app.services.vault_tasks import set_task_text
    line = TASKS.split("\n")[1]
    with pytest.raises(ValueError, match="changed"):
        set_task_text(TASKS, 2, "deadbeef00", "x")
    for bad in ("   ", "a" * 301):
        with pytest.raises(ValueError):
            set_task_text(TASKS, 2, line_hash(line), bad)


def test_remove_task_deletes_the_line():
    from app.services.vault_tasks import remove_task
    line = TASKS.split("\n")[1]
    out = remove_task(TASKS, 2, line_hash(line))
    assert out == TASKS.replace(line + "\n", "")
    with pytest.raises(ValueError, match="changed"):
        remove_task(TASKS, 2, "deadbeef00")


@pytest.mark.asyncio
async def test_endpoint_edits_and_removes_a_task(auth_client: AsyncClient, vault):
    remote, _ = vault
    vault_git.commit_edits({"Calendar/Tasks.md": lambda _: TASKS}, "seed tasks")
    task = next(t for t in (await auth_client.get("/api/v1/vault/day/2026-10-05/tasks")).json() if t["text"] == "Land Registry")
    ident = {k: task[k] for k in ("path", "line", "hash")}

    r = await auth_client.put("/api/v1/vault/tasks/text", json={**ident, "text": "Land Registry visit"})
    assert r.status_code == 200, r.text
    assert "- [ ] Land Registry visit ⏳ 2026-10-05" in _remote_file(remote, "Calendar/Tasks.md")
    assert (await auth_client.put("/api/v1/vault/tasks/text", json={**ident, "text": "again"})).status_code == 422  # stale

    task = next(t for t in (await auth_client.get("/api/v1/vault/day/2026-10-05/tasks")).json() if t["text"] == "Land Registry visit")
    ident = {k: task[k] for k in ("path", "line", "hash")}
    assert (await auth_client.post("/api/v1/vault/tasks/remove", json=ident)).status_code == 200
    assert "Land Registry" not in _remote_file(remote, "Calendar/Tasks.md")
    assert (await auth_client.post("/api/v1/vault/tasks/remove", json=ident)).status_code == 422


# --- log entries -----------------------------------------------------------------------------------------------

LOGGED = NOTE.replace("## Log\n-\n", "## Log\n- 14:05 · OT (06:00-16:03): Shipped\n* plain\n-\n")


def test_log_entries_skips_the_placeholder():
    assert log_entries(NOTE) == []
    got = log_entries(LOGGED)
    assert [(e["index"], e["text"]) for e in got] == [(0, "14:05 · OT (06:00-16:03): Shipped"), (1, "plain")]
    assert got[1]["hash"] == line_hash("* plain")


def test_edit_log_entry_replaces_text_and_keeps_bullet():
    from app.services.vault_write import edit_log_entry
    entry = log_entries(LOGGED)[1]
    out = edit_log_entry(LOGGED, 1, entry["hash"], " better\n text ")
    assert "\n* better text\n" in out and out.count("\n") == LOGGED.count("\n")
    with pytest.raises(ValueError, match="changed"):
        edit_log_entry(LOGGED, 1, "deadbeef00", "x")
    with pytest.raises(ValueError):
        edit_log_entry(LOGGED, 1, entry["hash"], "a" * 501)


def test_remove_log_entry_leaves_placeholder_when_emptied():
    from app.services.vault_write import remove_log_entry
    once = add_log_note(NOTE, "14:05", "OT", "06:00-16:03", "Only one")
    out = remove_log_entry(once, 0, log_entries(once)[0]["hash"])
    assert "## Log\n-\n\n## Captured" in out
    out = remove_log_entry(LOGGED, 0, log_entries(LOGGED)[0]["hash"])
    assert log_entries(out) == [{"index": 0, "hash": line_hash("* plain"), "text": "plain"}]
    with pytest.raises(ValueError, match="changed"):
        remove_log_entry(LOGGED, 5, "deadbeef00")


@pytest.mark.asyncio
async def test_endpoint_lists_edits_and_removes_log_entries(auth_client: AsyncClient, vault, monkeypatch):
    import datetime as dt
    remote, _ = vault
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: dt.datetime(2026, 9, 24, 9, 0))
    day = "2026-09-23"
    assert (await auth_client.get(f"/api/v1/vault/day/{day}/log")).json() == []
    await auth_client.post(f"/api/v1/vault/day/{day}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Deep session"})

    entries = (await auth_client.get(f"/api/v1/vault/day/{day}/log")).json()
    assert [e["text"] for e in entries] == [f"{entries[0]['text'][:5]} · OT (06:00-16:03): Deep session"]
    first = {k: entries[0][k] for k in ("index", "hash")}

    r = await auth_client.put(f"/api/v1/vault/day/{day}/log", json={**first, "text": "Edited"})
    assert r.status_code == 200, r.text
    assert "## Log\n- Edited\n" in _remote_file(remote, f"Calendar/Daily/{day}.md")
    assert (await auth_client.put(f"/api/v1/vault/day/{day}/log", json={**first, "text": "x"})).status_code == 422  # stale

    fresh = (await auth_client.get(f"/api/v1/vault/day/{day}/log")).json()[0]
    assert (await auth_client.post(f"/api/v1/vault/day/{day}/log/remove", json={"index": 0, "hash": fresh["hash"]})).status_code == 200
    assert "## Log\n-\n" in _remote_file(remote, f"Calendar/Daily/{day}.md")
    assert (await auth_client.get("/api/v1/vault/day/2020-01-01/log")).status_code == 422


# --- weekly objectives -----------------------------------------------------------------------------------------

def test_week_for_runs_saturday_to_friday():
    from app.services.vault_objectives import week_for
    for d in (date(2026, 10, 3), date(2026, 10, 6), date(2026, 10, 9)):
        assert week_for(d) == (date(2026, 10, 3), date(2026, 10, 9), "2026-W41")
    assert week_for(date(2026, 10, 2))[2] == "2026-W40"  # matches Calendar/Weekly/2026-W40.md
    assert week_for(date(2026, 12, 31))[2] == "2026-W53"  # Sat Dec 26 + 3 days = Tue Dec 29


def test_update_objective_renders_and_round_trips():
    from app.services.vault_objectives import parse_objectives, update_objective
    day = date(2026, 10, 6)
    empty = parse_objectives(None)
    assert [i["stream"] for i in empty] == ["soul", "body", "kahf", "alisha", "distribution", "fnf", "sleep"]
    assert not any(i["text"] or i["done"] for i in empty)

    out = update_objective(None, day, "soul", "Read daily", None)
    assert out.startswith("---\ntype: weekly-objectives\nweek: 41\nperiod: 2026-10-03/2026-10-09\n---\n# Objectives — W41\n\n- **Soul**: Read daily\n- **Body**:\n- **Kahf**:\n- **Alisha**:\n")
    out = update_objective(out, day, "body", None, True)
    out = update_objective(out, day, "soul", "", None)
    got = {i["stream"]: i for i in parse_objectives(out)}
    assert got["body"] == {"stream": "body", "text": "", "done": True, "checkpoint": None}
    assert got["soul"]["text"] == "" and "- **Body** ✓:\n" in out


def test_update_objective_rejects_bad_input():
    from app.services.vault_objectives import update_objective
    day = date(2026, 10, 6)
    for args in (("nope", "x", None), ("soul", None, None), ("soul", "a" * 201, None)):
        with pytest.raises(ValueError):
            update_objective(None, day, *args)


@pytest.mark.asyncio
async def test_endpoint_objectives_get_and_put(auth_client: AsyncClient, vault, monkeypatch):
    import datetime as dt
    remote, work = vault
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: dt.datetime(2026, 10, 6, 9, 0))
    r = await auth_client.get("/api/v1/vault/objectives")
    assert r.status_code == 200
    assert r.json()["week"] == "2026-W41" and r.json()["period"] == "2026-10-03/2026-10-09"
    assert [i["stream"] for i in r.json()["items"]] == ["soul", "body", "kahf", "alisha", "distribution", "fnf", "sleep"]
    assert not (work / "Calendar" / "Weekly" / "Objectives").exists()  # GET never creates the file

    r = await auth_client.put("/api/v1/vault/objectives", json={"stream": "kahf", "text": "Ship Niyyah", "done": True, "checkpoint": "nov"})
    assert r.status_code == 200, r.text
    assert {"stream": "kahf", "text": "Ship Niyyah", "done": True, "checkpoint": "nov"} in r.json()["items"]
    assert "- **Kahf** ✓: Ship Niyyah #nov" in _remote_file(remote, "Calendar/Weekly/Objectives/2026-W41.md")

    assert (await auth_client.put("/api/v1/vault/objectives", json={"stream": "kahf"})).status_code == 422
    assert (await auth_client.put("/api/v1/vault/objectives", json={"stream": "nope", "text": "x"})).status_code == 422
    assert (await auth_client.put("/api/v1/vault/objectives", json={"stream": "kahf", "text": "a" * 201})).status_code == 422


def test_set_vote_works_on_merged_ot_block():
    note = NOTE.replace("> [!body]+ Body", "> [!ot]+ OT\n> - [ ] ⭐ a\n> - [ ] ⭐⭐ b\n> - [ ] ⭐⭐⭐ c\n\n> [!body]+ Body")
    out = set_vote(note, "ot", 3)
    parsed = parse_daily_note(out, date(2026, 10, 7))
    assert parsed.blocks["ot"] == 3
    assert parsed.possible == 18


def test_legacy_ot_objective_reads_as_kahf():
    from app.services.vault_objectives import parse_objectives
    got = {i["stream"]: i for i in parse_objectives("- **OT**: AI Harness Research\n- **Soul** ✓: Fajr #oct\n")}
    assert got["kahf"]["text"] == "AI Harness Research" and got["alisha"]["text"] == ""
    assert got["soul"] == {"stream": "soul", "text": "Fajr", "done": True, "checkpoint": "oct"}


# --- planner: pipelines and quarter ----------------------------------------------------------------------------

TODAY = date(2026, 10, 6)


def test_add_items_builds_the_note_and_parses_back():
    from app.services.vault_pipeline import add_items, parse_pipeline
    out = add_items(None, "kahf", ["Ship the dashboard [Nov]", "  ", "Map each system #dec"], "backlog", TODAY)
    assert out.startswith("---\ntype: pipeline\nstream: kahf\n---\n# Kahf pipeline\n")
    assert "- [ ] Ship the dashboard #nov ➕ 2026-10-06" in out
    items = parse_pipeline(out, TODAY)
    assert [(i["text"], i["lane"], i["checkpoint"]) for i in items] == [("Ship the dashboard", "backlog", "nov"), ("Map each system", "backlog", "dec")]
    assert out.index("## Backlog") < out.index("- [ ] Ship") < out.index("## Done")


def test_move_done_and_reopen_stamp_dates_and_keep_tags():
    from app.services.vault_pipeline import add_items, move_item, parse_pipeline
    out = add_items(None, "kahf", ["A #nov", "B"], "next", TODAY)
    a = parse_pipeline(out, TODAY)[0]
    out = move_item(out, a["line"], a["hash"], "now", TODAY)
    assert [i["lane"] for i in parse_pipeline(out, TODAY)] == ["now", "next"]
    now = [i for i in parse_pipeline(out, TODAY) if i["lane"] == "now"][0]
    out = move_item(out, now["line"], now["hash"], "done", date(2026, 10, 8))
    done = [i for i in parse_pipeline(out, TODAY) if i["lane"] == "done"][0]
    assert done["done"] and done["done_on"] == "2026-10-08" and done["checkpoint"] == "nov" and done["added"] == "2026-10-06"
    out = move_item(out, done["line"], done["hash"], "next", TODAY)
    reopened = [i for i in parse_pipeline(out, TODAY) if i["text"] == "A"][0]
    assert not reopened["done"] and reopened["done_on"] is None and reopened["lane"] == "next"


def test_pipeline_edits_refuse_a_changed_line_and_flag_stale_items():
    from app.services.vault_pipeline import add_items, move_item, parse_pipeline, remove_item, set_checkpoint
    out = add_items(None, "kahf", ["Old idea", "Fresh #oct"], "backlog", date(2026, 9, 1))
    items = parse_pipeline(out, TODAY)
    assert [i["stale"] for i in items] == [True, False] and items[0]["age_days"] == 35
    with pytest.raises(ValueError):
        move_item(out, items[0]["line"], "deadbeef00", "now", TODAY)
    out = set_checkpoint(out, items[0]["line"], items[0]["hash"], "nov")
    assert parse_pipeline(out, TODAY)[0]["checkpoint"] == "nov" and not parse_pipeline(out, TODAY)[0]["stale"]
    second = parse_pipeline(out, TODAY)[1]
    assert "Fresh" not in remove_item(out, second["line"], second["hash"])


def test_add_items_rejects_bad_input():
    from app.services.vault_pipeline import add_items
    for texts, lane in (([], "now"), (["  "], "now"), (["x"], "done"), (["x"], "nope"), (["a" * 301], "now")):
        with pytest.raises(ValueError):
            add_items(None, "kahf", texts, lane, TODAY)
    with pytest.raises(ValueError):
        from app.services.vault_pipeline import pipeline_path
        pipeline_path("sleep")


QUARTER = """---
type: quarter
quarter: 2026-Q4
starts: 2026-10-01
ends: 2026-12-31
---
# Earn Jannah through service and knowledge.
> رضا الله

## kahf
- goal: 1,000 subscribers
- status: active
- oct: 500 subs
- nov: 750 subs
- dec: 1,000 subs

## finance
- goal: Loan balance zero
- status: committed
- oct: under 70K
"""


def test_parse_quarter():
    from app.services.vault_quarter import parse_quarter, quarter_for
    q = parse_quarter(QUARTER)
    assert q["quarter"] == "2026-Q4" and q["objective"] == "Earn Jannah through service and knowledge." and q["objective_ar"] == "رضا الله"
    assert [s["stream"] for s in q["streams"]] == ["kahf", "finance"]
    assert q["streams"][0]["checkpoints"][1] == {"month": "nov", "text": "750 subs"} and q["streams"][0]["status"] == "active"
    assert quarter_for(date(2026, 10, 6)) == "2026-Q4" and quarter_for(date(2027, 1, 1)) == "2027-Q1"


@pytest.mark.asyncio
async def test_endpoints_quarter_and_pipelines(auth_client: AsyncClient, vault, monkeypatch):
    import datetime as dt
    remote, work = vault
    monkeypatch.setattr("app.api.v1.vault._local_now", lambda: dt.datetime(2026, 10, 6, 9, 0))
    assert (await auth_client.get("/api/v1/vault/quarter")).status_code == 404
    vault_git.commit_edits({"Calendar/Quarterly/2026-Q4.md": lambda c: QUARTER}, "seed quarter")
    q = (await auth_client.get("/api/v1/vault/quarter")).json()
    assert q["week_of_quarter"] == 1 and q["weeks_in_quarter"] == 14 and q["current_month"] == "oct"
    assert q["streams"][0]["stream"] == "kahf"

    r = await auth_client.get("/api/v1/vault/pipelines")
    assert r.status_code == 200 and r.json()["now_limit"] == 3
    assert [s["stream"] for s in r.json()["streams"]][:3] == ["soul", "body", "kahf"]
    assert not (work / "Efforts").exists()  # GET never creates files

    r = await auth_client.post("/api/v1/vault/pipeline/kahf/items", json={"texts": ["Ship dashboard [Nov]", "Template"], "lane": "next"})
    assert r.status_code == 200, r.text
    assert "- [ ] Ship dashboard #nov ➕ 2026-10-06" in _remote_file(remote, "Efforts/Pipeline/kahf.md")
    kahf = [s for s in (await auth_client.get("/api/v1/vault/pipelines")).json()["streams"] if s["stream"] == "kahf"][0]
    first = kahf["items"][0]
    ref = {"stream": "kahf", "line": first["line"], "hash": first["hash"]}
    assert (await auth_client.put("/api/v1/vault/pipeline/move", json={**ref, "lane": "now"})).status_code == 200
    assert (await auth_client.put("/api/v1/vault/pipeline/move", json={**ref, "lane": "done"})).status_code == 422  # line moved: stale ref
    assert (await auth_client.put("/api/v1/vault/pipeline/move", json={**ref, "lane": "nope"})).status_code == 422
    assert (await auth_client.post("/api/v1/vault/pipeline/nope/items", json={"texts": ["x"]})).status_code == 422
