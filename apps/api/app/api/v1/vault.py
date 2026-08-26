import secrets
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import database
from app.core.config import settings
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
    VaultSyncResponse,
    VaultWeekResponse,
)
from app.services.vault_parser import CANONICAL_BLOCKS
from app.services.vault_sync import sync_vault

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

    # Every block gets one entry per day in [start, end], using None where
    # that block has no vote at all that day. A block present on only some
    # days must not yield a shorter array than one present every day — the
    # frontend renders each array element as an equal-width bar, so mismatched
    # lengths silently render different time spans as the same width.
    votes_by_date = {day.date: {v.block: v.stars for v in day.block_votes} for day in day_rows}
    date_range = [start + timedelta(days=i) for i in range(days)]

    series: dict[str, list[int | None]] = {block: [] for block in CANONICAL_BLOCKS}
    for d in date_range:
        day_votes = votes_by_date.get(d, {})
        for block in CANONICAL_BLOCKS:
            series[block].append(day_votes.get(block))

    averages: dict[str, float] = {}
    for block, values in series.items():
        present = [v for v in values if v is not None]
        if present:
            averages[block] = round(sum(present) / len(present), 2)

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


@router.post("/sync", response_model=VaultSyncResponse)
async def trigger_sync(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await sync_vault(db)
    return VaultSyncResponse(synced_days=result.synced_days, errors=result.errors)


async def _sync_vault_in_background() -> None:
    # A request-scoped session (Depends(get_db)) is closed by FastAPI's
    # dependency exit stack before background tasks run, so it must not be
    # reused here — open a fresh session for the lifetime of this task.
    # Referenced via the module (not imported by name) so tests can
    # monkeypatch app.core.database.async_session to point at the test DB.
    async with database.async_session() as session:
        await sync_vault(session)


@router.post("/sync/webhook", status_code=status.HTTP_202_ACCEPTED)
async def webhook_sync(
    background_tasks: BackgroundTasks,
    x_vault_sync_secret: str | None = Header(default=None),
    x_gitlab_token: str | None = Header(default=None),
):
    # GitLab webhooks send the secret via X-Gitlab-Token, not a custom header;
    # accept either. Both are optional so a request with no header at all hits
    # this 401 check instead of a FastAPI 422 validation error.
    provided = x_vault_sync_secret or x_gitlab_token
    if not provided or not secrets.compare_digest(provided, settings.vault_sync_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sync secret")

    # Cold syncs (git clone + parsing every file) can exceed GitLab's ~10s
    # webhook delivery timeout, so run the sync out-of-band and ack immediately.
    background_tasks.add_task(_sync_vault_in_background)
    return {"accepted": True}
