from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.vault import VaultDay
from app.schemas.vault import (
    VaultBlocksSeriesResponse,
    VaultDayResponse,
    VaultMonthResponse,
    VaultStreakEntry,
    VaultStreaksResponse,
    VaultWeekResponse,
)

router = APIRouter(prefix="/vault", tags=["vault"])


def _day_to_response(day: VaultDay) -> VaultDayResponse:
    blocks = {v.block: v.stars for v in day.block_votes}
    pct = round(100 * day.total / day.possible) if day.possible else 0
    return VaultDayResponse(
        date=day.date, mode=day.mode, possible=day.possible, blocks=blocks,
        total=day.total, pct=pct, focus=day.focus, log=day.log,
    )


async def _get_day(db: AsyncSession, target_date: date) -> VaultDay | None:
    result = await db.execute(
        select(VaultDay).where(VaultDay.date == target_date).options(selectinload(VaultDay.block_votes))
    )
    return result.scalar_one_or_none()


async def _get_days_range(db: AsyncSession, start: date, end: date) -> list[VaultDay]:
    result = await db.execute(
        select(VaultDay)
        .where(VaultDay.date >= start, VaultDay.date <= end)
        .options(selectinload(VaultDay.block_votes))
        .order_by(VaultDay.date)
    )
    return list(result.scalars().all())


@router.get("/today", response_model=VaultDayResponse)
async def get_today(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    day = await _get_day(db, date.today())
    if day is None:
        raise HTTPException(status_code=404, detail="No vault data synced for today")
    return _day_to_response(day)


@router.get("/week", response_model=VaultWeekResponse)
async def get_week(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    end = date.today()
    start = end - timedelta(days=6)
    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end)]

    totals: dict[str, int] = {}
    for r in responses:
        for block, stars in r.blocks.items():
            totals[block] = totals.get(block, 0) + stars

    week_total = sum(r.total for r in responses)
    week_possible = sum(r.possible for r in responses)
    week_pct = round(100 * week_total / week_possible) if week_possible else 0

    return VaultWeekResponse(
        days=responses, totals=totals, week_total=week_total,
        week_possible=week_possible, week_pct=week_pct,
    )


@router.get("/month", response_model=VaultMonthResponse)
async def get_month(month: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        year_str, month_str = month.split("-")
        start = date(int(year_str), int(month_str), 1)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1) - timedelta(days=1)

    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end)]

    totals: dict[str, int] = {}
    modes: dict[str, int] = {}
    for r in responses:
        for block, stars in r.blocks.items():
            totals[block] = totals.get(block, 0) + stars
        modes[r.mode] = modes.get(r.mode, 0) + 1

    month_total = sum(r.total for r in responses)
    month_possible = sum(r.possible for r in responses)
    month_pct = round(100 * month_total / month_possible) if month_possible else 0

    return VaultMonthResponse(month=month, days=responses, totals=totals, modes=modes, month_pct=month_pct)


@router.get("/blocks", response_model=VaultBlocksSeriesResponse)
async def get_blocks(days: int = 30, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    end = date.today()
    start = end - timedelta(days=days - 1)
    day_rows = await _get_days_range(db, start, end)

    series: dict[str, list[int]] = {}
    for day in day_rows:
        for vote in day.block_votes:
            series.setdefault(vote.block, []).append(vote.stars)

    averages = {block: round(sum(values) / len(values), 2) for block, values in series.items() if values}

    return VaultBlocksSeriesResponse(range=days, blocks=series, averages=averages)


@router.get("/streaks", response_model=VaultStreaksResponse)
async def get_streaks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VaultDay).options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date.asc())
    )
    day_rows = list(result.scalars().all())

    running: dict[str, int] = {}
    longest: dict[str, int] = {}

    for day in day_rows:
        for vote in day.block_votes:
            running[vote.block] = running.get(vote.block, 0) + 1 if vote.stars > 0 else 0
            longest[vote.block] = max(longest.get(vote.block, 0), running[vote.block])

    streaks = {
        block: VaultStreakEntry(current=running.get(block, 0), longest=longest.get(block, 0))
        for block in longest
    }
    return VaultStreaksResponse(streaks=streaks)
