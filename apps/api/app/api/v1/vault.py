import asyncio
import logging
import re
import secrets
from dataclasses import asdict
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
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
    EditAccessResponse,
    EditResponse,
    LogEntryIn,
    LogEntryRemoveIn,
    LogEntryResponse,
    ModeIn,
    NoteIn,
    ObjectiveIn,
    ObjectivesResponse,
    TaskIn,
    TaskRemoveIn,
    TaskResponse,
    TaskTextIn,
    TaskToggleIn,
    VoteIn,
    VaultBlocksSeriesResponse,
    VaultDayResponse,
    VaultMonthResponse,
    VaultScheduleResponse,
    VaultStreakEntry,
    VaultStreaksResponse,
    VaultSyncResponse,
    VaultWeekResponse,
)
from app.services.vault_parser import CANONICAL_BLOCKS
from app.services.vault_schedule import parse_schedule
from app.services.vault_git import Edit, VaultWriteError, commit_edits
from app.services.vault_sync import sync_vault
from app.services.vault_objectives import objectives_path, parse_objectives, update_objective, week_for
from app.services.vault_tasks import add_task, find_tasks, remove_task, set_task_done, set_task_text, task_file
from app.services.vault_write import (
    add_log_note,
    edit_log_entry,
    log_entries,
    new_daily_note,
    remove_log_entry,
    set_mode,
    set_vote,
)

router = APIRouter(prefix="/vault", tags=["vault"])
logger = logging.getLogger(__name__)


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
async def get_blocks(
    days: int = Query(30, ge=1, le=366),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
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


@router.get("/schedule", response_model=VaultScheduleResponse)
async def get_schedule():
    # Public by design: the routine ring is a shareable page. Read-only, no user data.
    note = Path(settings.vault_workdir) / "Calendar" / "Schedule.md"
    if not note.exists():
        raise HTTPException(status_code=404, detail="Calendar/Schedule.md not found in vault checkout")
    parsed = parse_schedule(note.read_text(encoding="utf-8"))
    return VaultScheduleResponse(
        meta=parsed.meta,
        days={name: [asdict(b) for b in blocks] for name, blocks in parsed.days.items()},
        errors=parsed.errors,
    )


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
    try:
        async with database.async_session() as session:
            result = await sync_vault(session)
        if result.errors:
            logger.warning(
                "vault webhook sync completed with %d error(s): %s", len(result.errors), result.errors
            )
        else:
            logger.info("vault webhook sync completed: %d day(s) synced", result.synced_days)
    except Exception:
        logger.exception("vault webhook sync failed unexpectedly")


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
    if not provided or not secrets.compare_digest(
        provided.encode("utf-8"), settings.vault_sync_secret.encode("utf-8")
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sync secret")

    # Cold syncs (git clone + parsing every file) can exceed GitLab's ~10s
    # webhook delivery timeout, so run the sync out-of-band and ack immediately.
    background_tasks.add_task(_sync_vault_in_background)
    return {"accepted": True}


# --- Writing to the vault (owner only) -------------------------------------------------------------------------

EDIT_WINDOW_DAYS = 7


def _can_edit(user: User) -> bool:
    allowed = {e.strip().lower() for e in settings.vault_write_emails.split(",") if e.strip()}
    return user.email.lower() in allowed


def require_editor(user: User = Depends(get_current_user)) -> User:
    if not _can_edit(user):
        raise HTTPException(status_code=403, detail="Not allowed to edit the vault")
    return user


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.vault_tz))


def _check_day(day: date) -> None:
    today = _local_now().date()
    if not today - timedelta(days=EDIT_WINDOW_DAYS) <= day <= today:
        raise HTTPException(status_code=422, detail=f"Only the last {EDIT_WINDOW_DAYS} days can be edited")


def _fresh_note(day: date) -> str:
    """Today's note does not exist yet: copy the layout of the latest one."""
    daily = Path(settings.vault_workdir) / "Calendar" / "Daily"
    notes = sorted(p for p in daily.glob("*.md") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem))
    if not notes:
        raise VaultWriteError("there is no daily note to copy the layout from")
    base = notes[-1]
    return new_daily_note(base.read_text(encoding="utf-8"), date.fromisoformat(base.stem), day)


def _day_edit(day: date, apply) -> dict[str, Edit]:
    def edit(content: str | None) -> str:
        return apply(content if content is not None else _fresh_note(day))
    return {f"Calendar/Daily/{day.isoformat()}.md": edit}


async def _save(day: date, apply, message: str, db: AsyncSession) -> EditResponse:
    try:
        commit = await asyncio.to_thread(commit_edits, _day_edit(day, apply), message)
    except ValueError as exc:  # bad mode / block / note text
        raise HTTPException(status_code=422, detail=str(exc))
    except VaultWriteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    await sync_vault(db)  # refresh the DB copy so /vault/today shows the change at once
    found = await _get_day(db, day)
    return EditResponse(commit=commit, day=_day_to_response(found) if found else None)


@router.get("/edit-access", response_model=EditAccessResponse)
async def edit_access(user: User = Depends(get_current_user)):
    return EditAccessResponse(allowed=_can_edit(user))


@router.put("/day/{day}/mode", response_model=EditResponse)
async def put_mode(day: date, data: ModeIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _save(day, lambda c: set_mode(c, data.mode), f"Niyyah: set {day} mode to {data.mode}", db)


@router.put("/day/{day}/vote", response_model=EditResponse)
async def put_vote(day: date, data: VoteIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _save(day, lambda c: set_vote(c, data.block, data.stars), f"Niyyah: {day} {data.block} vote {data.stars}", db)


@router.post("/day/{day}/notes", response_model=EditResponse)
async def post_note(day: date, data: NoteIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    clock = _local_now().strftime("%H:%M")
    return await _save(day, lambda c: add_log_note(c, clock, data.section, data.span, data.text), f"Niyyah: {day} note on {data.section}", db)


@router.get("/day/{day}/tasks", response_model=list[TaskResponse])
async def get_day_tasks(day: date, user: User = Depends(require_editor)):
    """Tasks (Obsidian Tasks syntax) due or scheduled on `day`. Private note text, so owner only."""
    root = Path(settings.vault_workdir)
    return await asyncio.to_thread(lambda: [asdict(t) for t in find_tasks(root, day.isoformat())])


async def _save_task(path: str, apply, message: str, db: AsyncSession) -> EditResponse:
    root = Path(settings.vault_workdir)
    try:
        rel = task_file(root, path).relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        commit = await asyncio.to_thread(commit_edits, {rel: lambda c: apply(c or "")}, message.format(rel=rel))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except VaultWriteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    await sync_vault(db)
    return EditResponse(commit=commit, day=None)


@router.put("/tasks", response_model=EditResponse)
async def put_task(data: TaskToggleIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    today = _local_now().date().isoformat()
    message = f"Niyyah: {'done' if data.done else 'reopen'} task in {{rel}}"
    return await _save_task(data.path, lambda c: set_task_done(c, data.line, data.hash, data.done, today), message, db)


@router.put("/tasks/text", response_model=EditResponse)
async def put_task_text(data: TaskTextIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    return await _save_task(data.path, lambda c: set_task_text(c, data.line, data.hash, data.text), "Niyyah: edit task in {rel}", db)


@router.post("/tasks/remove", response_model=EditResponse)
async def post_task_remove(data: TaskRemoveIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    return await _save_task(data.path, lambda c: remove_task(c, data.line, data.hash), "Niyyah: remove task in {rel}", db)


@router.post("/day/{day}/tasks", response_model=EditResponse)
async def post_task(day: date, data: TaskIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _save(day, lambda c: add_task(c, data.text, day.isoformat()), f"Niyyah: {day} add task", db)


@router.get("/day/{day}/log", response_model=list[LogEntryResponse])
async def get_day_log(day: date, user: User = Depends(require_editor)):
    """Entries under the day's '## Log'. Private note text, so owner only."""
    _check_day(day)
    note = Path(settings.vault_workdir) / "Calendar" / "Daily" / f"{day.isoformat()}.md"
    if not note.is_file():
        return []
    return log_entries(await asyncio.to_thread(note.read_text, encoding="utf-8"))


@router.put("/day/{day}/log", response_model=EditResponse)
async def put_log_entry(day: date, data: LogEntryIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _save(day, lambda c: edit_log_entry(c, data.index, data.hash, data.text), f"Niyyah: {day} edit log entry", db)


@router.post("/day/{day}/log/remove", response_model=EditResponse)
async def post_log_remove(day: date, data: LogEntryRemoveIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _save(day, lambda c: remove_log_entry(c, data.index, data.hash), f"Niyyah: {day} remove log entry", db)


# --- Weekly objectives (owner only) -----------------------------------------------------------------------------

def _objectives_response(today: date) -> ObjectivesResponse:
    start, end, label = week_for(today)
    note = Path(settings.vault_workdir) / objectives_path(label)
    content = note.read_text(encoding="utf-8") if note.is_file() else None
    return ObjectivesResponse(week=label, period=f"{start.isoformat()}/{end.isoformat()}", items=parse_objectives(content))


@router.get("/objectives", response_model=ObjectivesResponse)
async def get_objectives(user: User = Depends(require_editor)):
    return await asyncio.to_thread(_objectives_response, _local_now().date())


@router.put("/objectives", response_model=ObjectivesResponse)
async def put_objective(data: ObjectiveIn, user: User = Depends(require_editor)):
    today = _local_now().date()
    label = week_for(today)[2]
    edit = lambda c: update_objective(c, today, data.block, data.text, data.done)  # noqa: E731
    try:
        await asyncio.to_thread(commit_edits, {objectives_path(label): edit}, f"Niyyah: W{label[-2:]} {data.block} objective")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except VaultWriteError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return await asyncio.to_thread(_objectives_response, today)
