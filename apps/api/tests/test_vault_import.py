from datetime import date

import pytest
from sqlalchemy import func, select

from app.models.planner import Goal, LogEntry, NotebookEntry, PipelineItem, QuarterStream, PlannerScheduleBlock, Task, WeekObjective
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_import import import_vault
from tests.conftest import TestSession
from tests.vault_fixture import build_vault

TODAY = date(2026, 10, 7)


async def _count(db, model, user_id):
    return (await db.execute(select(func.count()).select_from(model).where(model.user_id == user_id))).scalar_one()


@pytest.mark.asyncio
async def test_import_copies_every_kind_of_note(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        report = await import_vault(db, 1, tmp_path, TODAY)
        assert report.errors == []
        assert report.counts == {
            "days": 2, "log_entries": 4, "tasks": 3, "goals": 2, "quarters": 1, "quarter_streams": 3,
            "objectives": 2, "pipeline_items": 4, "notebook_entries": 2, "schedule_blocks": 3, "calendar_feeds": 0,
        }
        tasks = (await db.execute(select(Task).where(Task.user_id == 1).order_by(Task.position))).scalars().all()
        assert [(t.text, t.done) for t in tasks] == [("Pay invoice", False), ("Renew domain", True), ("Future thing", False)]
        assert tasks[1].scheduled_on == TODAY and tasks[1].done_on == TODAY
        item = (await db.execute(select(PipelineItem).where(PipelineItem.lane == "now"))).scalar_one()
        assert item.product == "Router" and item.blocked_by and item.description == "Check the SFP module first."
        day = (await db.execute(select(VaultDay).where(VaultDay.user_id == 1, VaultDay.date == TODAY))).scalar_one()
        assert day.mode == "full" and day.user_id == 1
        assert await _count(db, Goal, 1) == 2
        assert await _count(db, WeekObjective, 1) == 2


@pytest.mark.asyncio
async def test_import_twice_does_not_duplicate(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        first = await import_vault(db, 1, tmp_path, TODAY)
        second = await import_vault(db, 1, tmp_path, TODAY)
        assert first.counts == second.counts
        for model in (Task, LogEntry, PipelineItem, NotebookEntry, QuarterStream, PlannerScheduleBlock, VaultDay):
            assert await _count(db, model, 1) == first.counts[{
                Task: "tasks", LogEntry: "log_entries", PipelineItem: "pipeline_items", NotebookEntry: "notebook_entries",
                QuarterStream: "quarter_streams", PlannerScheduleBlock: "schedule_blocks", VaultDay: "days"}[model]]
        votes = (await db.execute(select(func.count()).select_from(VaultBlockVote))).scalar_one()
        assert votes == 4  # two days, two voted blocks each; the first import's votes were removed


@pytest.mark.asyncio
async def test_import_leaves_other_users_and_legacy_rows_alone(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        db.add_all([Task(user_id=2, text="Mine", position=0), VaultDay(user_id=None, date=TODAY, mode="full", possible=21, total=0)])
        await db.commit()
        await import_vault(db, 1, tmp_path, TODAY)
        assert await _count(db, Task, 2) == 1
        legacy = (await db.execute(select(func.count()).select_from(VaultDay).where(VaultDay.user_id.is_(None)))).scalar_one()
        assert legacy == 1
