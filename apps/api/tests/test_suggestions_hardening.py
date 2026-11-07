"""Review fixes: a bundle is rehearsed when it is made, a failed apply re-checks the bundle, the pending cap is race-free,
undo keeps a quarter that has streams now."""
import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import delete, select, update

from app.models.planner import Quarter, QuarterStream
from app.models.suggestion import SuggestionBundle
from app.services import suggestions
from app.services.suggestions import service
from app.services.rules import quarter_for, week_for
from tests.conftest import ON_POSTGRES, TestSession
from tests.suggestions_support import apply, dump, make, read, task_ids, undo, user_ids

S = "/api/v1/suggestions"


@pytest.fixture(autouse=True)
def no_registered_checks():
    suggestions.set_checks([])
    yield
    suggestions.set_checks([])


@pytest.fixture
async def ctx(db_client):
    client, today = db_client
    return client, today, (await user_ids())[0]


def line(entity, op, target=None, **payload):
    return {"entity": entity, "op": op, "target": target or {}, "payload": payload}


def mission(text="x"):
    return line("compass", "update", mission=text)


# --- S1: what apply would refuse is refused when the bundle is made ----------------------------------------------------

async def _refused(http, lines, why):
    res = await http.post(S, json={"title": "t", "lines": lines})
    assert res.status_code == 422, res.text
    assert why in res.json()["detail"], res.json()
    return res.json()["detail"]


async def test_a_week_outside_the_window_is_refused_when_made(ctx):
    http, today, _ = ctx
    for weeks in (-5, 14):
        week = week_for(today + timedelta(days=7 * weeks))[2]
        detail = await _refused(http, [mission(), line("week_objective", "update", {"week": week, "stream": "studio"}, text="t")], "within")
        assert detail.startswith("line 2:")


async def test_a_checkpoint_on_an_item_outside_a_pipeline_is_refused_when_made(ctx):
    http, today, uid = ctx
    lines = [line("item", "create", day=today.isoformat(), text="A dated one"),  # no lane: nothing to hang a checkpoint on
             {**line("item", "update", checkpoint="jan"), "target": {"ref": "d1"}}]
    lines[0]["ref"] = "d1"
    await _refused(http, lines, "line 2")
    assert (await http.get(S)).json()["items"] == []


async def test_an_item_made_for_a_day_out_of_range_or_an_unknown_stream_is_refused_when_made(ctx):
    http, today, _ = ctx
    await _refused(http, [line("item", "create", text="t", day=(today + timedelta(days=500)).isoformat())], "out of range")
    await _refused(http, [line("item", "create", text="t", lane="next", stream="no-such-stream")], "no-such-stream")


async def test_a_checkpoint_for_a_month_outside_the_quarter_is_refused_when_made(ctx):
    http, today, _ = ctx
    other = "jan" if quarter_for(today)[-1] != "1" else "dec"
    await _refused(http, [line("checkpoint", "update", {"stream": "studio", "month": other}, checklist=[{"text": "a"}])], "not a month of this quarter")


async def test_a_checkpoint_for_a_stream_the_note_does_not_define_is_refused_when_made(ctx):
    http, today, uid = ctx
    month = ["jan", "apr", "jul", "oct"][int(quarter_for(today)[-1]) - 1]
    async with TestSession() as db:
        await db.execute(update(QuarterStream).where(QuarterStream.user_id == uid, QuarterStream.slug == "shop").values(in_note=False))
        await db.commit()
    await _refused(http, [line("checkpoint", "update", {"stream": "shop", "month": month}, checklist=[{"text": "a"}])], "its target was not found")


async def test_a_refused_bundle_leaves_nothing_behind(ctx):
    """The rehearsal writes inside a SAVEPOINT: refused or not, no row of the plan changes and no bundle is stored."""
    http, today, uid = ctx
    before = await dump(uid, keep_ids=True)
    week = week_for(today + timedelta(days=7 * 20))[2]
    await _refused(http, [mission("Would stick"), line("item", "create", text="Ghost", lane="now", stream="studio"),
                          line("week_objective", "update", {"week": week, "stream": "studio"}, text="t")], "line 3")
    assert await dump(uid, keep_ids=True) == before
    good = await http.post(S, json={"title": "t", "lines": [mission("Fine"), line("item", "create", text="Ghost", lane="now", stream="studio")]})
    assert good.status_code == 201
    assert await dump(uid, keep_ids=True) == before  # a good bundle is rehearsed too, and rolled back
    assert "Ghost" not in await task_ids(uid)


async def test_the_rehearsal_sees_what_earlier_lines_make(ctx):
    """A piece for an item an earlier line creates is fine; the same piece for an item that is not there is not."""
    http, today, uid = ctx
    ok = [{**line("item", "create", text="Parent", lane="next", stream="studio"), "ref": "p"},
          line("item", "create", text="Child", lane="next", stream="studio", parent_ref="p")]
    assert (await http.post(S, json={"title": "t", "lines": ok})).status_code == 201


async def test_a_stale_line_is_not_an_error_when_made(ctx):
    """A base the author saw that no longer matches only makes the line stale at apply; the rehearsal skips it as apply does."""
    http, today, uid = ctx
    res = await http.post(S, json={"title": "t", "lines": [{**mission("new"), "base": {"mission": "something else"}}]})
    assert res.status_code == 201
    bundle, lines = await read(uid, res.json()["id"])
    assert lines[0].base == {"mission": "something else"} and lines[0].status == "pending"


# --- N1: the failed-line mark re-takes the bundle lock ----------------------------------------------------------------

async def test_a_failed_apply_does_not_mark_a_line_of_a_bundle_decided_meanwhile(ctx, monkeypatch):
    http, today, uid = ctx
    bid = await make(uid, [line("item", "create", text="Nowhere", lane="next", stream="studio")], today=today)
    from app.services import planner_items

    async def refusing(*args, **kwargs):
        raise ValueError("unknown stream 'gone'")

    monkeypatch.setattr(planner_items, "create_item", refusing)
    real, calls = service._bundle, []

    async def bundle(db, user_id, bundle_id, lock=False):
        calls.append(lock)
        if len(calls) == 2:  # the lookup that follows the rollback: someone rejects the bundle just before it
            async with TestSession() as other:
                await other.execute(update(SuggestionBundle).where(SuggestionBundle.id == bundle_id).values(status="rejected"))
                await other.commit()
        return await real(db, user_id, bundle_id, lock)

    monkeypatch.setattr(service, "_bundle", bundle)
    with pytest.raises(suggestions.ApplyFailed, match="gone"):
        await apply(uid, bid, today)
    assert calls == [True, True]  # taken again, with the lock
    monkeypatch.undo()
    got, lines = await read(uid, bid)
    assert got.status == "rejected" and lines[0].status == "pending" and lines[0].error is None


async def test_a_failed_apply_still_marks_the_line_of_a_pending_bundle(ctx, monkeypatch):
    http, today, uid = ctx
    bid = await make(uid, [line("item", "create", text="Nowhere", lane="next", stream="studio")], today=today)
    from app.services import planner_items

    async def refusing(*args, **kwargs):
        raise ValueError("unknown stream 'gone'")

    monkeypatch.setattr(planner_items, "create_item", refusing)
    with pytest.raises(suggestions.ApplyFailed):
        await apply(uid, bid, today)
    monkeypatch.undo()
    got, lines = await read(uid, bid)
    assert got.status == "pending" and lines[0].status == "failed" and "gone" in lines[0].error


# --- N3: the pending cap holds for creates at the same time -------------------------------------------------------------

@pytest.mark.skipif(not ON_POSTGRES, reason="sqlite has no row locks")
async def test_two_creates_at_once_cannot_both_take_the_last_place(ctx):
    http, today, uid = ctx
    for n in range(service.MAX_PENDING - 1):
        await make(uid, [mission(f"m{n}")], today=today)
    first, second = TestSession(), TestSession()
    async with first, second:
        await suggestions.create(first, uid, "demo", "A", "", [mission("a")], today=today)  # holds the user's row until it commits
        racer = asyncio.create_task(suggestions.create(second, uid, "demo", "B", "", [mission("b")], today=today))
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(asyncio.shield(racer), 0.7)  # queued behind the first, not counting 29 beside it
        await first.commit()
        with pytest.raises(suggestions.SuggestionError, match="30"):
            await racer
        await second.rollback()
    async with TestSession() as db:
        assert await service.pending_count(db, uid) == service.MAX_PENDING


# --- N4: undo keeps a quarter row that streams use now ----------------------------------------------------------------

async def test_undo_does_not_delete_a_quarter_the_apply_made_once_streams_exist_for_it(ctx):
    http, today, uid = ctx
    label = quarter_for(today)
    async with TestSession() as db:  # an account that has no row for this quarter yet: apply creates it
        await db.execute(delete(QuarterStream).where(QuarterStream.user_id == uid))
        await db.execute(delete(Quarter).where(Quarter.user_id == uid))
        await db.commit()
    bid = await make(uid, [line("quarter_objective", "update", {"quarter": label}, text="Ship it")], today=today)
    await apply(uid, bid, today)
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.id).where(Quarter.user_id == uid, Quarter.label == label))).first()
        db.add(QuarterStream(user_id=uid, quarter=label, slug="late", name="Late", color="violet", icon="server", position=0))
        await db.commit()
    bundle, lines = await undo(uid, bid)
    assert bundle.status == "applied" and lines[0].status == "applied" and "streams now" in lines[0].error
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.objective).where(Quarter.user_id == uid, Quarter.label == label))).scalar_one() == "Ship it"


async def test_undo_still_deletes_a_quarter_the_apply_made_when_nothing_uses_it(ctx):
    http, today, uid = ctx
    label = quarter_for(today)
    async with TestSession() as db:
        await db.execute(delete(QuarterStream).where(QuarterStream.user_id == uid))
        await db.execute(delete(Quarter).where(Quarter.user_id == uid))
        await db.commit()
    bid = await make(uid, [line("quarter_objective", "update", {"quarter": label}, text="Ship it")], today=today)
    await apply(uid, bid, today)
    bundle, _ = await undo(uid, bid)
    assert bundle.status == "undone"
    async with TestSession() as db:
        assert (await db.execute(select(Quarter.id).where(Quarter.user_id == uid, Quarter.label == label))).first() is None
