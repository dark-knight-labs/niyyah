from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.planner import Goal, QuarterStream, Task
from app.models.vault import VaultDay
from tests.conftest import TestSession

D = date(2026, 10, 7)


@pytest.mark.asyncio
async def test_two_users_can_each_have_a_day_for_the_same_date():
    async with TestSession() as db:
        db.add_all([
            VaultDay(user_id=1, date=D, mode="full", possible=21, total=0),
            VaultDay(user_id=2, date=D, mode="full", possible=21, total=0),
        ])
        await db.commit()


@pytest.mark.asyncio
async def test_one_user_cannot_have_two_days_for_the_same_date():
    async with TestSession() as db:
        db.add_all([
            VaultDay(user_id=1, date=D, mode="full", possible=21, total=0),
            VaultDay(user_id=1, date=D, mode="off", possible=0, total=0),
        ])
        with pytest.raises(IntegrityError):
            await db.commit()


@pytest.mark.asyncio
async def test_planner_rows_round_trip():
    async with TestSession() as db:
        db.add_all([
            Task(user_id=1, text="Pay invoice", done=False, due_on=D, source_path="Efforts/todo.md", position=0),
            Goal(user_id=1, position=0, title="Zero debt", value="62% paid", caption="", progress=62),
            QuarterStream(user_id=1, quarter="2026-Q4", slug="studio", name="Studio", color="violet", icon="server", slot="OT",
                          weekly=True, has_pipeline=True, in_note=True, goal="Ship DNS", status="committed",
                          checkpoints=[{"month": "oct", "text": "Router live"}], position=0),
        ])
        await db.commit()
        stream = await db.get(QuarterStream, 1)
        assert stream.checkpoints == [{"month": "oct", "text": "Router live"}]
