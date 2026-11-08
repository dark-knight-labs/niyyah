"""The shadow item tree: rebuild, projection, comparison, the session hook and the CLI. All fixtures are synthetic."""
import datetime as dt
import time

import pytest
from sqlalchemy import delete, func, select, text

from app import cli
from app.models.planner import PlannerArea, PlannerItem, Quarter, QuarterStream
from app.schemas.snapshot import Snapshot
from app.services import item_rules, planner_import, planner_work, tree_shadow
from tests.conftest import TestSession, engine
from tests.sample_snapshot import sample_snapshot
from tests.tree_fixture import line, seed_planning

Q4 = "2026-Q4"


async def check(user_id: int = 1) -> list[str]:
    async with TestSession() as db:
        return await tree_shadow.compare(db, user_id)


async def items(user_id: int = 1) -> dict[str, PlannerItem]:
    async with TestSession() as db:
        return {i.legacy_ref: i for i in (await db.execute(select(PlannerItem).where(PlannerItem.user_id == user_id))).scalars()}


async def run(fn):
    async with TestSession() as db:
        out = await fn(db)
        await db.commit()
        return out


@pytest.fixture
async def seeded(auth_client):
    async with TestSession() as db:
        db.add_all(seed_planning(1))
        await db.commit()


# ---- rebuild -------------------------------------------------------------------------------------------------------------

async def test_the_hook_builds_the_tree_when_legacy_rows_are_written(seeded):
    assert await check() == []
    tree = await items()
    assert tree[f"q:{Q4}"].subtitle and tree["q:2026-Q3"].subtitle is None  # Arabic line only where there is one
    assert tree[f"qs:{Q4}:alpha"].commitment == "active" and tree[f"qs:{Q4}:alpha"].parent_id is None
    assert tree[f"qs:{Q4}:alpha:m:oct"].period == "2026-10" and tree[f"qs:{Q4}:alpha:m:oct"].parent_id == tree[f"qs:{Q4}:alpha"].id
    assert tree[f"qs:{Q4}:gamma:m:jan"].period == "2026-01"  # a month outside its quarter keeps its own YYYY-MM
    assert tree[f"qs:{Q4}:alpha:g:g1a2b3c4"].status == "done" and tree[f"qs:{Q4}:alpha:g:g5d6e7f8"].status == "open"
    assert f"qs:{Q4}:extra" not in tree  # not defined by the note: no goal
    assert not [r for r in tree if r.startswith(f"qs:{Q4}:beta:")]  # zero checkpoints, no goal lines


async def test_areas_come_from_the_latest_quarter_that_defines_the_slug(seeded):
    async with TestSession() as db:
        areas = {a.slug: a for a in (await db.execute(select(PlannerArea))).scalars()}
    assert areas["alpha"].name == "Alpha" and areas["alpha"].slot == "Mon 09:00-11:00"  # not the 2026-Q3 display fields
    assert areas["delta"].archived and not areas["alpha"].archived and not areas["extra"].in_note
    assert set(areas) == {"alpha", "beta", "gamma", "delta", "extra"}


async def test_rebuild_is_idempotent_and_keeps_ids(seeded):
    before = {k: v.id for k, v in (await items()).items()}
    stats = await run(lambda db: tree_shadow.rebuild(db, 1))
    assert stats == {"inserted": 0, "updated": 0, "deleted": 0}
    assert {k: v.id for k, v in (await items()).items()} == before


async def test_rebuild_from_nothing_and_after_drift(seeded):
    before = set(await items())
    await run(lambda db: db.execute(delete(PlannerItem)))
    assert await check()  # missing items are reported
    await run(lambda db: tree_shadow.rebuild(db, 1))
    assert await check() == [] and set(await items()) == before
    await run(lambda db: db.execute(text("update planner_items set title = 'drifted' where legacy_ref = 'q:2026-Q4'")))
    diffs = await check()
    assert diffs and any("objective" in d for d in diffs)
    await run(lambda db: tree_shadow.rebuild(db, 1))
    assert await check() == []


async def test_rebuild_ignores_other_users_and_non_shadow_items(seeded, client):
    await client.post("/api/v1/auth/register", json={"email": "two@niyyah.app", "password": "testpass123"})
    async with TestSession() as db:
        db.add(PlannerItem(user_id=1, title="hand made", period="2026-W46", horizon="now", legacy_ref=None, position=0))
        await db.commit()
    await run(lambda db: tree_shadow.rebuild(db, 2))
    assert await check(2) == []
    await run(lambda db: tree_shadow.rebuild(db, 1))
    assert "hand made" in [i.title for i in (await items()).values()]  # no legacy_ref: never touched or deleted


async def test_duplicate_line_ids_and_months_get_a_dup_suffix(auth_client):
    dup = [line("same0001", "First"), line("same0001", "Second")]
    async with TestSession() as db:
        db.add_all([Quarter(user_id=1, label=Q4, objective="x", objective_ar=""),
                    QuarterStream(user_id=1, quarter=Q4, slug="alpha", name="Alpha", color="violet", icon="server", position=0, goal="a", goal_checklist=dup,
                                  checkpoints=[{"month": "oct", "text": "a", "checklist": dup}, {"month": "oct", "text": "b", "checklist": []}])])
        await db.commit()
    tree = await items()
    assert f"qs:{Q4}:alpha:g:same0001" in tree and f"qs:{Q4}:alpha:g:same0001:dup1" in tree
    assert f"qs:{Q4}:alpha:m:oct" in tree and f"qs:{Q4}:alpha:m:oct:dup1" in tree
    assert await check() == []  # the id read back is the one legacy has


async def test_a_checkpoint_the_tree_cannot_hold_is_reported(auth_client):
    async with TestSession() as db:
        db.add_all([Quarter(user_id=1, label=Q4, objective="x", objective_ar=""),
                    QuarterStream(user_id=1, quarter=Q4, slug="alpha", name="Alpha", color="violet", icon="server", position=0,
                                  checkpoints=[{"month": "smarch", "text": "?", "checklist": []}])])
        await db.commit()
    assert any("checkpoints" in d for d in await check())


# ---- one test per writer: the hook keeps the tree equal ----------------------------------------------------------------

async def test_writer_ensure_quarter(seeded):
    await run(lambda db: planner_work.ensure_quarter(db, 1, "2027-Q1"))
    assert await check() == []
    assert (await items())["q:2027-Q1"].title == "Set this quarter's Super Objective"


async def test_writer_set_super_objective(seeded):
    await run(lambda db: planner_work.set_super_objective(db, 1, Q4, "A new objective", "هدف"))
    assert await check() == []
    assert (await items())[f"q:{Q4}"].title == "A new objective"
    await run(lambda db: planner_work.set_super_objective(db, 1, Q4, "A new objective", ""))
    assert await check() == [] and (await items())[f"q:{Q4}"].subtitle is None


async def test_writer_update_stream(seeded):
    before = (await items())[f"qs:{Q4}:alpha"].id
    await run(lambda db: planner_work.update_stream(
        db, 1, Q4, "alpha", {"status": "paused", "name": "Alpha two", "nov": "Plain november"},
        [line("g1a2b3c4", "Draft the outline", False), line("n1", "A new goal line")], {"oct": [line("c1000001", "Outline", False)]}))
    assert await check() == []
    tree = await items()
    assert tree[f"qs:{Q4}:alpha"].id == before and tree[f"qs:{Q4}:alpha"].commitment == "paused"  # stable id
    async with TestSession() as db:
        ids = [i["id"] for i in (await db.execute(select(QuarterStream.goal_checklist).where(QuarterStream.quarter == Q4, QuarterStream.slug == "alpha"))).scalar_one()]
    goal_lines = {r for r in tree if r.startswith(f"qs:{Q4}:alpha:g:")}
    assert goal_lines == {f"qs:{Q4}:alpha:g:{i}" for i in ids} and len(ids) == 2  # the removed line is an orphan, deleted
    assert f"qs:{Q4}:alpha:g:g5d6e7f8" not in tree
    async with TestSession() as db:
        assert (await db.execute(select(PlannerArea.name).where(PlannerArea.slug == "alpha"))).scalar_one() == "Alpha two"


async def test_writer_add_stream(seeded):
    await run(lambda db: planner_work.add_stream(db, 1, Q4, "epsilon", {"name": "Epsilon", "goal": "Learn one thing", "oct": "Start"}))
    assert await check() == []
    assert (await items())[f"qs:{Q4}:epsilon"].title == "Learn one thing"
    async with TestSession() as db:
        assert (await db.execute(select(func.count()).select_from(PlannerArea).where(PlannerArea.slug == "epsilon"))).scalar_one() == 1


async def test_writer_toggle_stream_item(seeded):
    await run(lambda db: planner_work.toggle_stream_item(db, 1, Q4, "alpha", "goal", "g5d6e7f8", True))
    await run(lambda db: planner_work.toggle_stream_item(db, 1, Q4, "alpha", "oct", "c1000001", False))
    assert await check() == []
    tree = await items()
    assert tree[f"qs:{Q4}:alpha:g:g5d6e7f8"].status == "done" and tree[f"qs:{Q4}:alpha:m:oct:c1000001"].status == "open"


async def test_writer_import_quarters_and_streams(auth_client):
    today = dt.date(2026, 11, 10)
    snap = Snapshot.model_validate(sample_snapshot(today))
    await run(lambda db: planner_import.import_snapshot(db, 1, snap))
    assert await check() == []
    assert any(r.startswith("qs:") for r in await items())
    empty = Snapshot.model_validate({**sample_snapshot(today), "quarters": []})  # a replace with no quarters empties the tree too
    await run(lambda db: planner_import.import_snapshot(db, 1, empty))
    assert await check() == [] and not [r for r in await items() if r.startswith(("q:", "qs:"))]


async def test_deleting_legacy_rows_removes_the_goals(seeded):
    async with TestSession() as db:
        row = (await db.execute(select(QuarterStream).where(QuarterStream.slug == "delta", QuarterStream.quarter == Q4))).scalar_one()
        await db.delete(row)
        await db.commit()
    assert await check() == [] and f"qs:{Q4}:delta" not in await items()


# ---- the hook never breaks a legacy write ------------------------------------------------------------------------------

async def test_a_failing_shadow_does_not_break_the_legacy_write(seeded):
    async with engine.begin() as conn:
        await conn.run_sync(PlannerItem.__table__.drop)  # the image runs before the migration did
    await run(lambda db: planner_work.set_super_objective(db, 1, Q4, "Still saved", None))
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.objective).where(Quarter.label == Q4))).scalar_one() == "Still saved"


async def test_kill_switch_stops_the_hook_but_not_the_cli(seeded, monkeypatch):
    monkeypatch.setenv("NIYYAH_TREE_SHADOW", "off")
    await run(lambda db: planner_work.set_super_objective(db, 1, Q4, "Changed while off", None))
    assert await check()  # stale, by design
    assert await cli.run_tree_rebuild(1, session_factory=TestSession) == 0
    assert await check() == []


# ---- CLI -------------------------------------------------------------------------------------------------------------

async def test_cli_tree_check_exits_1_on_a_difference_and_never_writes(seeded, capsys):
    await run(lambda db: db.execute(text("update planner_items set title = 'drifted' where legacy_ref = 'q:2026-Q4'")))
    before = {k: (v.id, v.title) for k, v in (await items()).items()}
    assert await cli.run_tree_check(None, session_factory=TestSession) == 1
    out = capsys.readouterr().out
    assert "differences" in out and "objective" in out
    assert {k: (v.id, v.title) for k, v in (await items()).items()} == before  # read-only
    assert await cli.run_tree_rebuild(None, session_factory=TestSession) == 0
    assert "updated 1" in capsys.readouterr().out
    assert await cli.run_tree_check(1, session_factory=TestSession) == 0
    assert "equal" in capsys.readouterr().out


def test_cli_arguments():
    with pytest.raises(SystemExit):
        cli.main(["tree-check"])  # --user or --all is required
    with pytest.raises(SystemExit):
        cli.main(["tree-rebuild", "--user", "1", "--all"])


# ---- timing (assumption A5: a rebuild is cheap) ------------------------------------------------------------------------

async def test_rebuild_timing_for_eight_streams(auth_client):
    rows = [Quarter(user_id=1, label=Q4, objective="Objective", objective_ar="")]
    for n in range(8):
        lines = [line(f"l{n}{k:05d}", f"Line {k}", k % 2 == 0) for k in range(3)]
        rows.append(QuarterStream(user_id=1, quarter=Q4, slug=f"area{n}", name=f"Area {n}", color="teal", icon="book", position=n, goal="g",
                                  goal_checklist=lines, checkpoints=[{"month": m, "text": "t", "checklist": lines} for m in ("oct", "nov", "dec")]))
    async with TestSession() as db:
        db.add_all(rows)
        await db.commit()
    async with TestSession() as db:
        t0 = time.perf_counter()
        await tree_shadow.rebuild(db, 1)  # no change: the common case on every later write
        warm = time.perf_counter() - t0
        await db.execute(delete(PlannerItem))
        await db.execute(delete(PlannerArea))
        t0 = time.perf_counter()
        stats = await tree_shadow.rebuild(db, 1)  # from nothing
        cold = time.perf_counter() - t0
        await db.commit()
    print(f"\nTREE-REBUILD-TIMING 8 streams, {stats['inserted']} rows inserted: from empty {cold * 1000:.1f} ms, unchanged {warm * 1000:.1f} ms (sqlite)")
    assert await check() == [] and cold < 2 and warm < 1


# ---- kind rules ------------------------------------------------------------------------------------------------------

def test_kind_rules():
    k = item_rules.kind_of
    assert k("2026-Q4", None, False) == item_rules.GOAL
    assert k("2026-10", None, True, item_rules.GOAL) == item_rules.CHECKPOINT
    assert k("2026-01", None, True, item_rules.GOAL) == item_rules.CHECKPOINT  # a month outside the quarter is still a checkpoint
    assert k(None, None, True, item_rules.GOAL) == item_rules.LINE and k(None, None, True, item_rules.CHECKPOINT) == item_rules.LINE
    assert k("2026-W46", "now", False) == item_rules.WORK and k(None, "someday", False) == item_rules.WORK
    assert k("2026-Q4", "now", False) == item_rules.GOAL  # a goal never counts as work
    assert k("2026-Q4", "now", True) == item_rules.OTHER
    assert item_rules.is_super_objective(item_rules.GOAL, None) and not item_rules.is_super_objective(item_rules.GOAL, "alpha")
    assert item_rules.is_week_focus(item_rules.WORK, "2026-W46", "now") and not item_rules.is_week_focus(item_rules.WORK, "2026-W46", "next")
    assert item_rules.month_period("2026-Q4", "oct") == "2026-10" and item_rules.month_period("2026-Q4", "xyz") is None
    assert item_rules.month_key("2026-10") == "oct"


# ---- review fixes: races, flush order, hand-made areas ----------------------------------------------------------------

async def test_a_unique_conflict_is_logged_and_retried_at_the_next_flush(seeded, monkeypatch, caplog):
    real = tree_shadow._tree_rows
    monkeypatch.setattr(tree_shadow, "_tree_rows", lambda conn, uid: [])  # this rebuild believes the tree is empty: its INSERT hits the existing rows
    async with TestSession() as db:
        await planner_work.set_super_objective(db, 1, Q4, "Written during a race", None)
        await db.flush()  # the legacy write survives; the shadow conflict is a warning, not an error
        assert 1 in db.sync_session.info[tree_shadow._TOUCHED]
        assert any("unique conflict" in r.message for r in caplog.records if r.levelname == "WARNING")
        monkeypatch.setattr(tree_shadow, "_tree_rows", real)
        await db.commit()  # the retry
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.objective).where(Quarter.label == Q4))).scalar_one() == "Written during a race"
    assert await check() == []


async def test_other_errors_are_dropped_without_a_retry(seeded, monkeypatch):
    def boom(conn, uid):
        raise RuntimeError("boom")
    monkeypatch.setattr(tree_shadow, "rebuild_sync", boom)
    async with TestSession() as db:
        await planner_work.set_super_objective(db, 1, Q4, "Still saved", None)
        await db.flush()
        assert not db.sync_session.info.get(tree_shadow._TOUCHED)
        await db.commit()


async def test_a_connection_error_cannot_fail_the_legacy_flush(seeded, monkeypatch):
    import sys

    from sqlalchemy.orm import Session
    real = Session.connection

    def flaky(self, *a, **kw):
        if sys._getframe(1).f_code.co_name == "_safe_rebuild":  # only the hook's own request fails
            raise RuntimeError("no connection")
        return real(self, *a, **kw)
    monkeypatch.setattr(Session, "connection", flaky)
    await run(lambda db: planner_work.set_super_objective(db, 1, Q4, "Saved anyway", None))
    monkeypatch.undo()
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.objective).where(Quarter.label == Q4))).scalar_one() == "Saved anyway"


async def test_commit_rebuilds_from_flushed_state(seeded, monkeypatch):
    seen = []
    real = tree_shadow.rebuild_sync

    async def go():
        async with TestSession() as db:
            def spy(conn, uid):
                seen.append(conn.execute(select(func.count()).select_from(Quarter).where(Quarter.label == '2027-Q2')).scalar())  # visible to the rebuild?
                return real(conn, uid)
            monkeypatch.setattr(tree_shadow, "rebuild_sync", spy)
            db.add(Quarter(user_id=1, label="2027-Q2", objective="Pending", objective_ar=""))
            tree_shadow.touch(db, 1)
            await db.commit()
    await go()
    assert seen and all(n == 1 for n in seen)  # every rebuild saw the pending quarter
    monkeypatch.setattr(tree_shadow, "rebuild_sync", real)
    assert await check() == [] and "q:2027-Q2" in await items()


async def test_a_hand_made_area_survives_a_rebuild(seeded):
    async with TestSession() as db:
        db.add(PlannerArea(user_id=1, slug="mine", name="Mine", color="teal", icon="book", position=9))
        await db.commit()
    await run(lambda db: db.execute(delete(QuarterStream).where(QuarterStream.slug == "delta")))
    await run(lambda db: tree_shadow.rebuild(db, 1))
    async with TestSession() as db:
        areas = {a.slug: a for a in (await db.execute(select(PlannerArea))).scalars()}
    assert "mine" in areas and areas["mine"].legacy_ref is None
    assert "delta" not in areas and areas["alpha"].legacy_ref == "area:alpha"  # a shadow-owned area is still removed with its stream
