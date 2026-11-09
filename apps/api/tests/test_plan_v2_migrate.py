"""python -m app.cli plan-v2-migrate: dry run, apply, matching, overrides, journal and revert, idempotency."""
import json
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.cli import main, run_plan_v2_migrate
from app.models.board import Board, BoardNode
from app.models.planner import PlannerItem, Quarter, QuarterStream, Task
from app.models.user import User
from tests.conftest import TestSession

TODAY = date(2026, 11, 9)


def _line(line_id, text, done=False):
    return {"id": line_id, "text": text, "done": done}


def _task(user_id, stream, text, lane, position, **extra):
    return Task(user_id=user_id, stream=stream, text=text, lane=lane, lane_position=position, done=lane == "done",
                status="done" if lane == "done" else "open", products=[], blocked_by=[], **extra)


@pytest_asyncio.fixture
async def account(auth_client):
    """One user, quarter 2026-Q4 with two blocks and a handful of items. Returns the user id and the items' ids by name."""
    async with TestSession() as db:
        uid = (await db.execute(select(User.id))).scalar_one()
        db.add(Quarter(user_id=uid, label="2026-Q4", objective="Obj", objective_ar=""))
        db.add(QuarterStream(
            user_id=uid, quarter="2026-Q4", slug="studio", name="Studio", color="violet", icon="server", slot="", weekly=True,
            has_pipeline=True, in_note=True, goal="Ship DNS", goal_checklist=[_line("g1000000", "Ship DNS")], status="committed", position=0,
            checkpoints=[
                {"month": "oct", "text": "Router live", "checklist": [_line("o1", "Router live", True)]},
                {"month": "nov", "text": "x", "checklist": [_line("n1", "Ship the DNS cutover plan"), _line("n2", "Write docs"),
                                                            _line("b1", "Backup check")]},
                {"month": "dec", "text": "x", "checklist": [_line("b1", "Backup check"), _line("d1", "Review year")]}]))
        db.add(QuarterStream(
            user_id=uid, quarter="2026-Q4", slug="fitness", name="Fitness", color="rose", icon="heart", slot="", weekly=True,
            has_pipeline=True, in_note=True, goal="Run · Lift", position=1,
            goal_checklist=[_line("f0000001", "Run"), _line("f0000002", "Lift")], status="committed",
            checkpoints=[{"month": "nov", "text": "5k race", "checklist": [_line("f1", "5k race")]}]))
        rows = {
            "router": _task(uid, "studio", "Wire the router", "now", 0, checkpoint="oct"),
            "dns": _task(uid, "studio", "Ship the DNS cutover plan now", "next", 1),
            "misc": _task(uid, "studio", "Misc", "backlog", 2, checkpoint="jan"),
            "drift": _task(uid, "studio", "Drifted", "next", 3, checkpoint="oct", label_month="2026-11"),
            "run": _task(uid, "fitness", "Run more", "next", 0),
        }
        db.add_all(rows.values())
        await db.commit()
        return uid, {k: r.id for k, r in rows.items()}


async def _rows(uid):
    async with TestSession() as db:
        return list((await db.execute(select(Task).where(Task.user_id == uid, Task.lane.is_not(None)).order_by(Task.id))).scalars().all())


async def _by_text(uid, text):
    return next(r for r in await _rows(uid) if r.text == text)


async def _checkpoints(uid):
    async with TestSession() as db:
        return [(r.slug, r.goal, r.goal_checklist, r.checkpoints) for r in (await db.execute(
            select(QuarterStream).where(QuarterStream.user_id == uid).order_by(QuarterStream.slug))).scalars().all()]


def _run(uid, capsys, apply=False, journal=None, overrides=None, revert=None, all_users=False):
    return run_plan_v2_migrate(None if (all_users or revert) else uid, all_users, apply, journal, overrides, revert,
                               session_factory=TestSession, today=TODAY)


def _summary(out: str) -> dict:
    line = next(l for l in out.splitlines() if l.startswith("SUMMARY "))
    return {k: int(v) for k, v in (p.split("=") for p in line.split()[1:])}


@pytest.mark.asyncio
async def test_dry_run_is_the_default_and_writes_nothing(account, capsys):
    uid, _ = account
    before = [(r.id, r.label_month, r.goal_ref) for r in await _rows(uid)]
    assert await _run(uid, capsys) == 0
    out = capsys.readouterr().out
    assert "DRY RUN user" in out and "TOTAL 12 changes (dry run; pass --apply to write)" in out
    assert _summary(out) == {"label_month": 2, "created": 6, "created_next": 5, "created_done": 1, "matched": 1, "ambiguous": 1,
                             "goal_ref": 9, "overridden": 0}
    assert [(r.id, r.label_month, r.goal_ref) for r in await _rows(uid)] == before
    # every change is one line with id, stream, what and before -> after
    assert "label_month: None -> 2026-10 (from checkpoint oct)" in out
    assert "id=new stream=studio create: lane=done text=\"Router live\" label_month=2026-10 origin=cpl:2026-Q4:oct:o1" in out
    assert "ambiguous: checkpoint jan fits no single stored quarter" in out
    assert "drift: label_month 2026-11 but checkpoint oct" in out
    # matched lines show both texts and both months
    assert 'matched: line "Ship the DNS cutover plan" [2026-11] done=False ~ item "Ship the DNS cutover plan now" [label_month=2026-11' in out


@pytest.mark.asyncio
async def test_apply_labels_creates_nests_and_never_touches_checkpoints(account, capsys, tmp_path):
    uid, ids = account
    kept = await _checkpoints(uid)
    journal = tmp_path / "j.json"
    assert await _run(uid, capsys, apply=True, journal=journal) == 0
    out = capsys.readouterr().out
    assert _summary(out)["created"] == 6 and f"journal: {journal}" in out
    rows = {r.id: r for r in await _rows(uid)}
    assert rows[ids["router"]].label_month == "2026-10"  # step a
    assert rows[ids["dns"]].label_month == "2026-11"  # matched, label set because it had none
    assert rows[ids["misc"]].label_month is None  # ambiguous, left alone
    assert rows[ids["drift"]].label_month == "2026-11"  # drift is reported, never changed
    created = [r for r in rows.values() if r.origin]
    assert sorted(r.origin for r in created) == sorted([
        "cpl:2026-Q4:oct:o1", "cpl:2026-Q4:nov:n2", "cpl:2026-Q4:nov:b1", "cpl:2026-Q4:dec:b1", "cpl:2026-Q4:dec:d1", "cpl:2026-Q4:nov:f1"])
    by_origin = {r.origin: r for r in created}
    done = by_origin["cpl:2026-Q4:oct:o1"]
    assert (done.lane, done.done, done.status, done.label_month, done.done_on, done.stream) == ("done", True, "done", "2026-10", date(2026, 10, 31), "studio")
    nov, dec = by_origin["cpl:2026-Q4:nov:b1"], by_origin["cpl:2026-Q4:dec:b1"]
    assert (nov.text, nov.label_month, nov.lane) == ("Backup check", "2026-11", "next")
    assert (dec.text, dec.label_month, dec.lane) == ("Backup check", "2026-12", "next")  # same text, two months: two tasks
    # appended at the end of the stream's order
    assert min(r.lane_position for r in created if r.stream == "studio") == 4
    # step c: one current goal -> every studio item nested (existing and created); two goals -> nothing
    assert {r.goal_ref for r in rows.values() if r.stream == "studio"} == {"g1000000"}
    assert rows[ids["run"]].goal_ref is None and by_origin["cpl:2026-Q4:nov:f1"].goal_ref is None
    assert await _checkpoints(uid) == kept
    # the journal lists every change
    data = json.loads(journal.read_text())
    assert data["user"] == uid and len(data["created"]) == 6
    assert {(u["column"], u["old"]) for u in data["updates"]} == {("label_month", None), ("goal_ref", None)}
    assert len(data["updates"]) == 2 + 4  # two labels, four existing studio items nested
    # shadow tree hook ran in the same transaction (tasks are items of the tree when a tree exists): no crash, rows committed
    async with TestSession() as db:
        assert (await db.execute(select(PlannerItem).where(PlannerItem.user_id == uid))).scalars().all() is not None


@pytest.mark.asyncio
async def test_second_run_prints_zero_changes(account, capsys, tmp_path):
    uid, _ = account
    await _run(uid, capsys, apply=True, journal=tmp_path / "j.json")
    capsys.readouterr()
    assert await _run(uid, capsys, apply=True, journal=tmp_path / "j2.json") == 0
    out = capsys.readouterr().out
    assert "TOTAL 0 changes" in out and not (tmp_path / "j2.json").exists()
    s = _summary(out)
    assert (s["label_month"], s["created"], s["goal_ref"]) == (0, 0, 0)
    assert len(await _rows(uid)) == 5 + 6


@pytest.mark.asyncio
async def test_a_line_only_matches_items_that_existed_before_the_run(account, capsys):
    uid, _ = account
    async with TestSession() as db:  # an existing "Backup check" now catches both monthly lines instead of creating two tasks
        db.add(_task(uid, "studio", "Backup check", "next", 9))
        await db.commit()
    await _run(uid, capsys)
    out = capsys.readouterr().out
    assert _summary(out)["matched"] == 3 and _summary(out)["created"] == 4
    assert out.count('matched: line "Backup check"') == 2


@pytest.mark.asyncio
async def test_overrides_match_and_skip(account, capsys, tmp_path):
    uid, ids = account
    path = tmp_path / "o.json"
    path.write_text(json.dumps({"match": {"n2": ids["misc"]}, "skip": ["d1"]}))
    assert await _run(uid, capsys, apply=True, journal=tmp_path / "j.json", overrides=path) == 0
    out = capsys.readouterr().out
    assert "matched (override): line \"Write docs\"" in out and "skipped (override): \"Review year\"" in out
    s = _summary(out)
    assert (s["created"], s["matched"], s["overridden"]) == (4, 2, 2)
    assert (await _by_text(uid, "Misc")).label_month == "2026-11"  # an override match sets the label like a text match
    assert not any(r.text in ("Write docs", "Review year") for r in await _rows(uid))
    assert json.loads((tmp_path / "j.json").read_text())["overrides"] == {"match": {"n2": ids["misc"]}, "skip": ["d1"], "create": []}


@pytest.mark.asyncio
@pytest.mark.parametrize("overrides, why", [
    ({"match": {"n2": 99999}}, "does not exist"),
    ({"match": {"n2": "fitness-run"}}, "item ids (numbers)"),
    ({"match": {"zzz": 1}}, "no checkpoint line has the id"),
    ({"match": {"n2": "OTHER BLOCK"}}, "is in 'fitness'"),
    ({"skip": ["n2"], "match": {"n2": 1}}, "both match and skip"),
    ({"surprise": 1}, "overrides must look like"),
])
async def test_a_bad_override_aborts_before_any_write(account, capsys, tmp_path, overrides, why):
    uid, ids = account
    if overrides.get("match", {}).get("n2") == "OTHER BLOCK":
        overrides = {"match": {"n2": ids["run"]}}  # an item of another block
    path = tmp_path / "o.json"
    path.write_text(json.dumps(overrides))
    before = [(r.id, r.label_month, r.goal_ref) for r in await _rows(uid)]
    assert await _run(uid, capsys, apply=True, journal=tmp_path / "j.json", overrides=path) == 1
    assert why in capsys.readouterr().err
    assert [(r.id, r.label_month, r.goal_ref) for r in await _rows(uid)] == before and not (tmp_path / "j.json").exists()


@pytest.mark.asyncio
async def test_revert_restores_what_it_can_and_skips_what_changed_since(account, capsys, tmp_path):
    uid, ids = account
    journal = tmp_path / "j.json"
    await _run(uid, capsys, apply=True, journal=journal)
    capsys.readouterr()
    async with TestSession() as db:  # the owner edits two things after the run
        router = await db.get(Task, ids["router"])
        router.label_month = "2026-09"
        edited = (await db.execute(select(Task).where(Task.text == "Write docs"))).scalar_one()
        edited.text = "Write the docs"
        await db.commit()
    # dry run first: reports, writes nothing
    before = [(r.id, r.text, r.label_month, r.goal_ref) for r in await _rows(uid)]
    assert await _run(uid, capsys, revert=journal) == 0
    out = capsys.readouterr().out
    assert "DRY RUN revert" in out and "dry run" in out
    assert [(r.id, r.text, r.label_month, r.goal_ref) for r in await _rows(uid)] == before
    assert await _run(uid, capsys, apply=True, revert=journal) == 0
    out = capsys.readouterr().out
    assert f"id={ids['router']} label_month skipped: it is '2026-09' now, not '2026-10'" in out
    assert 'delete skipped: changed since (text) in "Write the docs"' in out
    rows = {r.id: r for r in await _rows(uid)}
    assert rows[ids["router"]].label_month == "2026-09"  # the owner's value stays
    assert rows[ids["router"]].goal_ref is None  # the untouched column is restored
    assert rows[ids["dns"]].label_month is None and rows[ids["dns"]].goal_ref is None
    left = [r for r in rows.values() if r.origin]
    assert [r.text for r in left] == ["Write the docs"]  # only the edited created item survives
    assert await _run(uid, capsys, apply=True, revert=journal) == 0  # a second revert changes nothing more
    assert "TOTAL 0 changes" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_default_journal_name_and_all_users(account, capsys, tmp_path, monkeypatch):
    uid, _ = account
    monkeypatch.chdir(tmp_path)
    assert await _run(uid, capsys, apply=True) == 0
    names = [p.name for p in tmp_path.iterdir()]
    assert len(names) == 1 and names[0].startswith(f"plan-v2-migrate-{uid}-") and names[0].endswith("Z.json")
    capsys.readouterr()
    assert await _run(uid, capsys, all_users=True) == 0
    assert "TOTAL 0 changes" in capsys.readouterr().out
    assert await run_plan_v2_migrate(None, False, False, None, None, None, session_factory=TestSession) == 1  # needs --user or --all
    assert "give --user N or --all" in capsys.readouterr().err


def test_the_command_is_registered(capsys):
    with pytest.raises(SystemExit):
        main(["plan-v2-migrate", "--help"])
    assert "--overrides" in capsys.readouterr().out


async def _apply_with_journal(uid, capsys, tmp_path, name="j.json", **kw):
    path = tmp_path / name
    await _run(uid, capsys, apply=True, journal=path, **kw)
    capsys.readouterr()
    return path


@pytest.mark.asyncio
async def test_revert_skips_a_created_task_changed_in_any_column_or_referenced(account, capsys, tmp_path):
    uid, _ = account
    journal = await _apply_with_journal(uid, capsys, tmp_path)
    async with TestSession() as db:
        docs = (await db.execute(select(Task).where(Task.text == "Write docs"))).scalar_one()
        docs.description = "notes the owner wrote"  # only the description changed
        parent = (await db.execute(select(Task).where(Task.text == "Review year"))).scalar_one()
        db.add(_task(uid, "studio", "Piece of it", "next", 20, parent_id=parent.id))  # a child refers to it
        await db.commit()
    assert await _run(uid, capsys, apply=True, revert=journal) == 0
    out = capsys.readouterr().out
    assert "delete skipped: changed since (description)" in out and "have it as their parent" in out
    left = sorted(r.text for r in await _rows(uid) if r.origin)
    assert left == ["Review year", "Write docs"]  # everything else the run created is gone


@pytest.mark.asyncio
async def test_a_done_line_is_dated_at_the_end_of_its_month_capped_at_today(account, capsys, tmp_path):
    uid, _ = account
    async with TestSession() as db:
        q = (await db.execute(select(QuarterStream).where(QuarterStream.slug == "fitness"))).scalar_one()
        q.checkpoints = [{"month": "dec", "text": "x", "checklist": [_line("d9", "Early finish", True)]},
                         {"month": "oct", "text": "x", "checklist": [_line("o9", "Old finish", True)]}]
        await db.commit()
    await _run(uid, capsys, apply=True, journal=tmp_path / "j.json")
    rows = {r.text: r for r in await _rows(uid)}
    assert rows["Old finish"].done_on == date(2026, 10, 31) and rows["Early finish"].done_on == TODAY  # Dec is in the future: today
    assert rows["Old finish"].status == "done" and rows["Old finish"].done


@pytest.mark.asyncio
async def test_a_tie_between_items_is_ambiguous_and_overrides_decide(account, capsys, tmp_path):
    uid, ids = account
    async with TestSession() as db:
        db.add_all([_task(uid, "studio", "Write docs for DNS", "next", 30), _task(uid, "studio", "Write docs for mail", "next", 31)])
        await db.commit()
    await _run(uid, capsys)
    out = capsys.readouterr().out
    assert "ambiguous-match" in out and "Write docs" in out and _summary(out)["ambiguous"] == 2  # the jan checkpoint item, and the tie
    assert not any("Write docs" in l and "create:" in l for l in out.splitlines())  # nothing created for the tied line
    path = tmp_path / "o.json"
    path.write_text(json.dumps({"create": ["n2"]}))
    await _run(uid, capsys, overrides=path)
    out = capsys.readouterr().out
    assert 'create: lane=next text="Write docs"' in out and _summary(out)["overridden"] == 1 and _summary(out)["ambiguous"] == 1
    path.write_text(json.dumps({"create": ["n2"], "skip": ["n2"]}))
    assert await _run(uid, capsys, overrides=path) == 1
    assert "both skip and create" in capsys.readouterr().err
    path.write_text(json.dumps({"create": ["zzz"]}))
    assert await _run(uid, capsys, overrides=path) == 1
    path.write_text("[1]")
    assert await _run(uid, capsys, overrides=path) == 1
    assert "overrides must look like" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_create_override_forces_a_task_and_matched_lines_show_done_state(account, capsys, tmp_path):
    uid, _ = account
    async with TestSession() as db:
        db.add(_task(uid, "studio", "Router live", "next", 40))  # an open item; the oct line "Router live" is done
        await db.commit()
    await _run(uid, capsys)
    out = capsys.readouterr().out
    assert "done=True ~ item \"Router live\"" in out and "WARNING: a done line matched an open item" in out
    path = tmp_path / "o.json"
    path.write_text(json.dumps({"create": ["o1"]}))
    await _run(uid, capsys, overrides=path)
    assert 'create: lane=done text="Router live"' in capsys.readouterr().out


@pytest.mark.asyncio
async def test_a_failed_commit_keeps_the_journal_as_uncertain(account, capsys, tmp_path, monkeypatch):
    uid, _ = account

    class Boom(TestSession.class_):
        async def commit(self):
            raise RuntimeError("connection lost")

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from tests.conftest import engine
    factory = async_sessionmaker(engine, class_=Boom, expire_on_commit=False)
    path = tmp_path / "j.json"
    assert await run_plan_v2_migrate(uid, False, True, path, None, None, session_factory=factory, today=TODAY) == 1
    assert not path.exists() and (tmp_path / "j.json.uncertain").exists()
    assert "connection lost" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_reordering_a_migrated_task_does_not_block_its_revert(account, capsys, tmp_path):
    uid, _ = account
    journal = await _apply_with_journal(uid, capsys, tmp_path)
    async with TestSession() as db:
        t = (await db.execute(select(Task).where(Task.text == "Write docs"))).scalar_one()
        t.lane_position = 99
        t.position = 7
        await db.commit()
    await _run(uid, capsys, apply=True, revert=journal)
    assert "Write docs" in capsys.readouterr().out
    assert not [r for r in await _rows(uid) if r.origin]


@pytest.mark.asyncio
async def test_revert_keeps_a_task_a_board_node_holds(account, capsys, tmp_path):
    uid, _ = account
    journal = await _apply_with_journal(uid, capsys, tmp_path)
    async with TestSession() as db:
        t = (await db.execute(select(Task).where(Task.text == "Write docs"))).scalar_one()
        board = Board(user_id=uid, title="Scratch")
        db.add(board)
        await db.flush()
        db.add(BoardNode(board_id=board.id, id="n-1", kind="ref", ref_key=f"task:{t.id}"))
        await db.commit()
    await _run(uid, capsys, apply=True, revert=journal)
    assert "a board node holds it" in capsys.readouterr().out
    assert [r.text for r in await _rows(uid) if r.origin] == ["Write docs"]


@pytest.mark.asyncio
async def test_a_failure_before_the_commit_deletes_the_partial_journal(account, capsys, tmp_path, monkeypatch):
    uid, _ = account
    import app.cli as cli

    def broken(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(cli.json, "dump", broken)
    path = tmp_path / "j.json"
    assert await _run(uid, capsys, apply=True, journal=path) == 1
    err = capsys.readouterr().err
    assert "failed before the commit, nothing written: disk full" in err
    assert not path.exists() and not (tmp_path / "j.json.uncertain").exists()
    assert not [r for r in await _rows(uid) if r.origin]  # rolled back


@pytest.mark.asyncio
async def test_a_rename_error_does_not_mask_the_commit_error(account, capsys, tmp_path, monkeypatch):
    uid, _ = account
    from pathlib import Path as P

    class Boom(TestSession.class_):
        async def commit(self):
            raise RuntimeError("connection lost")

    from sqlalchemy.ext.asyncio import async_sessionmaker
    from tests.conftest import engine

    def no_rename(self, target):
        raise PermissionError("read-only")

    monkeypatch.setattr(P, "rename", no_rename)
    factory = async_sessionmaker(engine, class_=Boom, expire_on_commit=False)
    assert await run_plan_v2_migrate(uid, False, True, tmp_path / "j.json", None, None, session_factory=factory, today=TODAY) == 1
    err = capsys.readouterr().err
    assert "could not rename the journal" in err and "commit failed: connection lost" in err
