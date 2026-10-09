from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.tracker import DailyCheck, NonNegotiable, Streak
from app.models.user import User
from app.schemas.tracker import (
    DailyCheckRequest,
    DailyCheckResponse,
    NonNegotiableCreate,
    NonNegotiableResponse,
    NonNegotiableUpdate,
    TrackerDayResponse,
)

router = APIRouter(prefix="/tracker", tags=["tracker"])


@router.get("/non-negotiables", response_model=list[NonNegotiableResponse])
async def list_non_negotiables(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(NonNegotiable)
        .where(NonNegotiable.user_id == user.id)
        .options(selectinload(NonNegotiable.streak))
        .order_by(NonNegotiable.order)
    )
    return result.scalars().all()


@router.post("/non-negotiables", response_model=NonNegotiableResponse, status_code=status.HTTP_201_CREATED)
async def create_non_negotiable(body: NonNegotiableCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count_result = await db.execute(select(NonNegotiable).where(NonNegotiable.user_id == user.id))
    count = len(count_result.scalars().all())
    nn = NonNegotiable(user_id=user.id, order=count, **body.model_dump())
    db.add(nn)
    await db.flush()
    db.add(Streak(non_negotiable_id=nn.id))
    await db.commit()
    await db.refresh(nn, ["streak"])
    return nn


@router.patch("/non-negotiables/{nn_id}", response_model=NonNegotiableResponse)
async def update_non_negotiable(nn_id: int, body: NonNegotiableUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NonNegotiable).where(NonNegotiable.id == nn_id, NonNegotiable.user_id == user.id))
    nn = result.scalar_one_or_none()
    if not nn:
        raise HTTPException(status_code=404, detail="Non-negotiable not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(nn, k, v)
    await db.commit()
    await db.refresh(nn, ["streak"])
    return nn


@router.delete("/non-negotiables/{nn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_non_negotiable(nn_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NonNegotiable).where(NonNegotiable.id == nn_id, NonNegotiable.user_id == user.id))
    nn = result.scalar_one_or_none()
    if not nn:
        raise HTTPException(status_code=404, detail="Non-negotiable not found")
    await db.delete(nn)
    await db.commit()


@router.post("/check", response_model=DailyCheckResponse, status_code=status.HTTP_201_CREATED)
async def check_item(body: DailyCheckRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Verify ownership
    result = await db.execute(select(NonNegotiable).where(NonNegotiable.id == body.non_negotiable_id, NonNegotiable.user_id == user.id))
    nn = result.scalar_one_or_none()
    if not nn:
        raise HTTPException(status_code=404, detail="Non-negotiable not found")

    check_date = body.check_date or date.today()

    # Check if already checked
    existing = await db.execute(
        select(DailyCheck).where(DailyCheck.non_negotiable_id == nn.id, DailyCheck.check_date == check_date)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Already checked for this date")

    check = DailyCheck(non_negotiable_id=nn.id, check_date=check_date)
    db.add(check)

    # Update streak
    streak_result = await db.execute(select(Streak).where(Streak.non_negotiable_id == nn.id))
    streak = streak_result.scalar_one_or_none()
    if streak:
        if streak.last_check_date and (check_date - streak.last_check_date) == timedelta(days=1):
            streak.current_streak += 1
        elif streak.last_check_date != check_date:
            streak.current_streak = 1
        streak.longest_streak = max(streak.longest_streak, streak.current_streak)
        streak.last_check_date = check_date

    await db.commit()
    await db.refresh(check)
    return check


@router.delete("/check/{check_id}", status_code=status.HTTP_204_NO_CONTENT)
async def uncheck_item(check_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(DailyCheck).join(NonNegotiable).where(DailyCheck.id == check_id, NonNegotiable.user_id == user.id)
    )
    check = result.scalar_one_or_none()
    if not check:
        raise HTTPException(status_code=404, detail="Check not found")
    await db.delete(check)
    await db.commit()


@router.get("/today", response_model=TrackerDayResponse)
async def get_today(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = date.today()
    nn_result = await db.execute(
        select(NonNegotiable)
        .where(NonNegotiable.user_id == user.id)
        .options(selectinload(NonNegotiable.streak))
        .order_by(NonNegotiable.order)
    )
    nns = nn_result.scalars().all()

    checks_result = await db.execute(
        select(DailyCheck).join(NonNegotiable).where(
            NonNegotiable.user_id == user.id, DailyCheck.check_date == today
        )
    )
    checks = checks_result.scalars().all()

    return TrackerDayResponse(date=today, checks=checks, non_negotiables=nns)
