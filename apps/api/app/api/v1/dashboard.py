from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.persona import Persona, ScheduleBlock
from app.models.tracker import DailyCheck, NonNegotiable, Streak
from app.models.user import User, UserSettings

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = date.today()

    # Personas count
    persona_result = await db.execute(
        select(Persona).where(Persona.user_id == user.id).options(selectinload(Persona.milestones)).order_by(Persona.order)
    )
    personas = persona_result.scalars().all()

    # Schedule blocks
    blocks_result = await db.execute(
        select(ScheduleBlock).where(ScheduleBlock.user_id == user.id).order_by(ScheduleBlock.start_time)
    )
    blocks = blocks_result.scalars().all()

    # Today's checks
    checks_result = await db.execute(
        select(DailyCheck).join(NonNegotiable).where(
            NonNegotiable.user_id == user.id, DailyCheck.check_date == today
        )
    )
    today_checks = checks_result.scalars().all()

    # Non-negotiables with streaks
    nn_result = await db.execute(
        select(NonNegotiable)
        .where(NonNegotiable.user_id == user.id)
        .options(selectinload(NonNegotiable.streak))
        .order_by(NonNegotiable.order)
    )
    non_negotiables = nn_result.scalars().all()

    # Settings
    settings_result = await db.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    settings = settings_result.scalar_one_or_none()

    return {
        "super_objective": settings.super_objective if settings else "Allah SWT's Satisfaction",
        "personas": [{"id": p.id, "name": p.name, "arabic_name": p.arabic_name, "domain": p.domain, "icon": p.icon, "color": p.color} for p in personas],
        "schedule_blocks": [{"id": b.id, "start_time": b.start_time, "end_time": b.end_time, "activity": b.activity, "persona_id": b.persona_id, "is_prayer_block": b.is_prayer_block} for b in blocks],
        "non_negotiables_total": len(non_negotiables),
        "non_negotiables_checked_today": len(today_checks),
        "streaks": [{"title": nn.title, "current": nn.streak.current_streak if nn.streak else 0, "longest": nn.streak.longest_streak if nn.streak else 0} for nn in non_negotiables],
    }
