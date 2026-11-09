"""python -m app.cli plan-v3-migrate: seed products from tags, link habits to goals; dry run, apply, rerun, journal and revert."""
import json
from datetime import date

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.cli import main, run_plan_v3_migrate
from app.models.planner import EventOverlay, PlannerHabit, PlannerProduct, Quarter, QuarterStream, Task
from app.models.user import User
from tests.conftest import TestSession

TODAY = date(2026, 11, 9)


def _line(line_id, text):
    return {"id": line_id, "text": text, "done": False}


def _task(uid, stream, text, lane, position, **extra):
    return Task(user_id=uid, stream=stream, text=text, lane=lane, lane_position=position, done=lane == "done",
                status="done" if lane == "done" else "open", **{"products": [], "blocked_by": [], **extra})


@pytest_asyncio.fixture
async def account(auth_client):
    async with TestSession() as db:
        uid = (await db.execute(select(User.id))).scalar_one()
        db.add(Quarter(user_id=uid, label="2026-Q4", objective="Obj", objective_ar=""))
        for pos, (slug, goals) in enumerate((("studio", [_line("g1000000", "Ship DNS")]), ("fitness", [_line("f1000000", "Run")]))):
            db.add(QuarterStream(user_id=uid, quarter="2026-Q4", slug=slug, name=slug.title(), color="rose", icon="heart", slot="", weekly=True,
                                 has_pipeline=True, in_note=True, goal="x", goal_checklist=goals, status="committed", checkpoints=[], position=pos))
        db.add_all([
            _task(uid, "studio", "Wire", "now", 0, products=["home-lab", "DNS"]),
            _task(uid, "studio", "Plan", "next", 1, products=["dns", "2fa", "Two Words"]),
            _task(uid, "studio", "Plain task (no lane)", None, 0, products=["router"]),  # not a lane item: still counts (all rows with a stream)
            _task(uid, "fitness", "Run", "next", 0, products=["dns"]),
            _task(uid, "ghost", "Orphan", "next", 0, products=["lost"]),  # a stream no quarter defines
            EventOverlay(user_id=uid, event_key="e1", stream="studio", products=["Calendar"]),
        ])
        habit_a = PlannerHabit(user_id=uid, name="Walk", block="soul", stream="studio", started_on=TODAY)
        habit_b = PlannerHabit(user_id=uid, name="Read", block="soul", stream="studio", goal_ref="g1000000", started_on=TODAY)
        habit_c = PlannerHabit(user_id=uid, name="Loose", block="soul", started_on=TODAY)
        db.add_all([habit_a, habit_b, habit_c])
        await db.commit()
        return uid, {"a": habit_a.id, "b": habit_b.id, "c": habit_c.id}


async def _products(uid):
    async with TestSession() as db:
        return [(p.block, p.slug, p.name, p.position) for p in (await db.execute(
            select(PlannerProduct).where(PlannerProduct.user_id == uid).order_by(PlannerProduct.block, PlannerProduct.position))).scalars()]


async def _goal(habit_id):
    async with TestSession() as db:
        return (await db.get(PlannerHabit, habit_id)).goal_ref


def _run(uid, apply=False, journal=None, habit_goals=None, revert=None):
    return run_plan_v3_migrate(None if revert else uid, apply, journal, habit_goals, revert, session_factory=TestSession, today=TODAY)


def _summary(out):
    line = next(l for l in out.splitlines() if l.startswith("SUMMARY "))
    return {k: int(v) for k, v in (p.split("=") for p in line.split()[1:])}


def _goals_file(tmp_path, mapping):
    path = tmp_path / "hg.json"
    path.write_text(json.dumps(mapping))
    return path


@pytest.mark.asyncio
async def test_dry_run_prints_every_change_and_writes_nothing(account, capsys, tmp_path):
    uid, h = account
    goals = _goals_file(tmp_path, {str(h["a"]): "g1000000"})
    assert await _run(uid, habit_goals=goals) == 0
    out = capsys.readouterr().out
    assert "DRY RUN user" in out and "(dry run; pass --apply to write)" in out
    assert _summary(out) == {"products": 6, "habit_goals": 1}
    # distinct tags per block, by first appearance, with their names; 2fa cannot be a product; the undefined block is skipped
    assert 'block=studio product: slug=home-lab name="Home Lab" position=0' in out
    assert 'slug=dns name="Dns" position=1' in out and 'slug=two-words name="Two Words" position=2' in out
    assert 'slug=router name="Router" position=3' in out and 'slug=calendar name="Calendar" position=4' in out
    assert 'block=fitness product: slug=dns' in out
    assert "block=studio products after: home-lab, dns, two-words, router, calendar" in out
    assert 'skipped tag "2fa": not usable' in out and 'block=ghost skipped tag "lost": no quarter defines the block' in out
    assert f"id={h['a']} habit \"Walk\" block=studio goal_ref: None -> g1000000" in out
    assert await _products(uid) == [] and await _goal(h["a"]) is None


@pytest.mark.asyncio
async def test_apply_rerun_is_zero_and_never_touches_tasks_or_tags(account, capsys, tmp_path):
    uid, h = account
    tags = await _tags(uid)
    journal = tmp_path / "j.json"
    goals = _goals_file(tmp_path, {str(h["a"]): "g1000000", str(h["b"]): "g1000000"})
    assert await _run(uid, apply=True, journal=journal, habit_goals=goals) == 0
    out = capsys.readouterr().out
    assert _summary(out) == {"products": 6, "habit_goals": 1} and f"journal: {journal}" in out
    assert f"id={h['b']} habit goal_ref skipped: already 'g1000000'" in out  # only where NULL
    assert await _goal(h["a"]) == "g1000000"
    assert [p[:2] for p in await _products(uid)] == [("fitness", "dns"), ("studio", "home-lab"), ("studio", "dns"), ("studio", "two-words"),
                                                     ("studio", "router"), ("studio", "calendar")]
    assert await _tags(uid) == tags
    entries = json.loads(journal.read_text())
    assert len(entries["created"]) == 6 and entries["updates"] == [{"id": h["a"], "column": "goal_ref", "old": None, "new": "g1000000"}]
    assert all(set(c["snapshot"]) >= {"id", "user_id", "block", "slug", "name", "position", "created_at"} for c in entries["created"])
    # a second run changes nothing
    assert await _run(uid, apply=True, journal=tmp_path / "j2.json", habit_goals=goals) == 0
    out = capsys.readouterr().out
    assert "TOTAL 0 changes" in out and _summary(out) == {"products": 0, "habit_goals": 0}
    assert not (tmp_path / "j2.json").exists()


async def _tags(uid):
    async with TestSession() as db:
        return {t.id: list(t.products) for t in (await db.execute(select(Task).where(Task.user_id == uid))).scalars()}


@pytest.mark.asyncio
async def test_existing_products_are_skipped_and_positions_continue(account, capsys, tmp_path):
    uid, _ = account
    async with TestSession() as db:
        db.add(PlannerProduct(user_id=uid, block="studio", slug="dns", name="DNS (mine)", position=4))
        await db.commit()
    await _run(uid, apply=True, journal=tmp_path / "j.json")
    assert "slug=dns name=" not in capsys.readouterr().out.split("block=fitness")[0]
    studio = [p for p in await _products(uid) if p[0] == "studio"]
    assert ("studio", "dns", "DNS (mine)", 4) in studio  # untouched
    assert [p[3] for p in studio if p[1] != "dns"] == [5, 6, 7, 8]


@pytest.mark.asyncio
async def test_a_bad_habit_goal_mapping_refuses_before_any_write(account, capsys, tmp_path):
    uid, h = account
    for mapping, why in (({str(h["a"]): "nope0000"}, "not a goal of studio"), ({"99999": "g1000000"}, "does not exist"),
                         ({str(h["c"]): "g1000000"}, "not in a Plan block"), ({str(h["a"]): "f1000000"}, "not a goal of studio")):
        assert await _run(uid, apply=True, habit_goals=_goals_file(tmp_path, mapping)) == 1
        assert why in capsys.readouterr().err
    assert await _products(uid) == [] and await _goal(h["a"]) is None
    bad = tmp_path / "bad.json"
    bad.write_text("[1]")
    assert await _run(uid, habit_goals=bad) == 1


@pytest.mark.asyncio
async def test_a_habit_with_only_a_day_block_links_through_it_and_the_revert_restores_null(account, capsys, tmp_path):
    uid, h = account
    async with TestSession() as db:  # a Plan block slug that is also the habit's day block; no stream on the habit
        db.add(QuarterStream(user_id=uid, quarter="2026-Q4", slug="body", name="Body", color="amber", icon="heart", slot="", weekly=True,
                             has_pipeline=True, in_note=True, goal="Lift", goal_checklist=[_line("b1000000", "Lift")], status="committed",
                             checkpoints=[], position=2))
        body = PlannerHabit(user_id=uid, name="Gym", block="body", started_on=TODAY)
        one = PlannerHabit(user_id=uid, name="Focus", block="onething", started_on=TODAY)  # not a Plan block
        db.add_all([body, one])
        await db.commit()
        body_id, one_id = body.id, one.id
    # a habit that is not in a Plan block is refused, before any write
    assert await _run(uid, apply=True, habit_goals=_goals_file(tmp_path, {str(one_id): "g1000000"})) == 1
    assert "not in a Plan block" in capsys.readouterr().err and await _products(uid) == []
    # a goal of another block is refused too
    assert await _run(uid, habit_goals=_goals_file(tmp_path, {str(body_id): "g1000000"})) == 1
    capsys.readouterr()
    journal = tmp_path / "j.json"
    assert await _run(uid, apply=True, journal=journal, habit_goals=_goals_file(tmp_path, {str(body_id): "b1000000"})) == 0
    out = capsys.readouterr().out
    assert "block=body goal_ref: None -> b1000000, stream: None -> body" in out
    async with TestSession() as db:
        row = await db.get(PlannerHabit, body_id)
        assert (row.goal_ref, row.stream) == ("b1000000", "body")
    assert {"id": body_id, "column": "stream", "old": None, "new": "body"} in json.loads(journal.read_text())["updates"]
    assert await _run(uid, apply=True, revert=journal) == 0
    async with TestSession() as db:
        row = await db.get(PlannerHabit, body_id)
        assert (row.goal_ref, row.stream) == (None, None)


@pytest.mark.asyncio
async def test_revert_restores_and_skips_what_changed_since(account, capsys, tmp_path):
    uid, h = account
    journal = tmp_path / "j.json"
    await _run(uid, apply=True, journal=journal, habit_goals=_goals_file(tmp_path, {str(h["a"]): "g1000000"}))
    capsys.readouterr()
    async with TestSession() as db:  # the owner renamed one product and moved a habit's goal since
        p = (await db.execute(select(PlannerProduct).where(PlannerProduct.slug == "router"))).scalar_one()
        p.name = "My Router"
        await db.commit()
    assert await _run(uid, revert=journal) == 0  # dry run
    out = capsys.readouterr().out
    assert "DRY RUN revert" in out and "changed since (name)" in out and "TOTAL 6 changes (dry run" in out
    assert len(await _products(uid)) == 6
    assert await _run(uid, apply=True, revert=journal) == 0
    out = capsys.readouterr().out
    assert "TOTAL 6 changes" in out and [p[1] for p in await _products(uid)] == ["router"]
    assert await _goal(h["a"]) is None
    # reverting twice is harmless
    assert await _run(uid, apply=True, revert=journal) == 0
    assert "TOTAL 0 changes" in capsys.readouterr().out
    # a goal link changed since is left alone
    await _run(uid, apply=True, journal=tmp_path / "k.json", habit_goals=_goals_file(tmp_path, {str(h["a"]): "g1000000"}))
    async with TestSession() as db:
        (await db.get(PlannerHabit, h["a"])).goal_ref = "other000"
        await db.commit()
    capsys.readouterr()
    await _run(uid, apply=True, revert=tmp_path / "k.json")
    assert "goal_ref skipped" in capsys.readouterr().out and await _goal(h["a"]) == "other000"


@pytest.mark.asyncio
async def test_revert_keeps_a_product_a_goal_line_carries(account, capsys, tmp_path):
    uid, _ = account
    journal = tmp_path / "j.json"
    await _run(uid, apply=True, journal=journal)
    async with TestSession() as db:  # the owner put a seeded product on a goal line
        row = await db.get(QuarterStream, (await db.execute(select(QuarterStream.id).where(QuarterStream.slug == "studio"))).scalar_one())
        row.goal_checklist = [{**row.goal_checklist[0], "product": "router"}]
        await db.commit()
    capsys.readouterr()
    await _run(uid, apply=True, revert=journal)
    out = capsys.readouterr().out
    assert "a goal line of studio carries router now" in out
    assert ("studio", "router") in [(b, s) for b, s, _, _ in await _products(uid)]
    assert len(await _products(uid)) == 1


@pytest.mark.asyncio
async def test_a_failed_commit_keeps_the_journal_as_uncertain(account, capsys, tmp_path):
    uid, _ = account

    class Failing:
        def __call__(self):
            return self

        async def __aenter__(self):
            self.db = TestSession()
            session = await self.db.__aenter__()

            async def boom():
                raise RuntimeError("disk full")
            session.commit = boom
            return session

        async def __aexit__(self, *a):
            return await self.db.__aexit__(*a)

    journal = tmp_path / "j.json"
    assert await run_plan_v3_migrate(uid, True, journal, None, None, session_factory=Failing(), today=TODAY) == 1
    err = capsys.readouterr().err
    assert "commit failed: disk full" in err and not journal.exists() and (tmp_path / "j.json.uncertain").exists()
    assert await _products(uid) == []


def test_argument_errors(capsys):
    assert main(["plan-v3-migrate"]) == 1
    assert "give --user N" in capsys.readouterr().err
    assert main(["plan-v3-migrate", "--revert", "x.json", "--user", "1"]) == 1
