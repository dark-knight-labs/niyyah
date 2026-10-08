import asyncio
import logging
import re
import secrets
from dataclasses import asdict
from datetime import date, datetime, time as clock, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import database
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.google import GoogleCredential
from app.models.user import User
from app.models.vault import VaultDay
from app.schemas.vault import (
    EditAccessResponse,
    CalendarEventIn,
    CalendarEventResponse,
    CalendarEventsResponse,
    GoogleConnectResponse,
    GoogleStatusResponse,
    EditResponse,
    LogEntryIn,
    LogEntryRemoveIn,
    LogEntryResponse,
    ModeIn,
    NoteIn,
    ObjectiveIn,
    ObjectivesResponse,
    PipelineAddIn,
    PipelineCheckpointIn,
    PipelineDescriptionIn,
    PipelineMoveIn,
    PipelineRefIn,
    PipelineTextIn,
    PipelinesResponse,
    QuarterResponse,
    StreamAddIn,
    StreamFieldsIn,
    SuperObjectiveIn,
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
    NotebookAddIn,
    PipelineBlockedByIn,
    NotebookBlockerIn,
    NotebookEditIn,
    NotebooksResponse,
    VaultSyncResponse,
    VaultWeekResponse,
)
from app.services.vault_parser import CANONICAL_BLOCKS
from app.services.vault_schedule import parse_schedule
from app.services import google_calendar
from app.services.google_calendar import GoogleCalendarError
from app.services.vault_calendar import events_for_day
from app.services.vault_git import Edit, VaultWriteError, commit_edits
from app.services.vault_sync import sync_vault
from app.services.vault_objectives import objectives_path, parse_objectives, update_objective, week_for
from app.services import vault_notebook, vault_pipeline
from app.services.vault_notebook import notebook_path, parse_notebook
from app.services.vault_pipeline import NOW_LIMIT, STALE_DAYS, parse_pipeline, pipeline_path
from app.services.vault_quarter import (
    add_stream, load_streams, parse_quarter, quarter_for, quarter_months, quarter_path, set_super_objective, update_stream,
)
from app.services.vault_streams import COLORS, ICONS, MONTHS
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


async def _credential(db: AsyncSession, user: User) -> GoogleCredential | None:
    return (await db.execute(select(GoogleCredential).where(GoogleCredential.user_id == user.id))).scalar_one_or_none()


@router.get("/day/{day}/events", response_model=CalendarEventsResponse)
async def get_day_events(day: date, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    """The day's events from the calendars configured in the vault (Day Planner iCal feeds). Private, owner only.

    The calendar matching the connected Google account is read through the Calendar API (fresh), the rest via iCal."""
    root = Path(settings.vault_workdir)
    cred = await _credential(db, user)
    google = None
    if cred:
        refresh = cred.refresh_token
        google = (cred.email, lambda start, end: google_calendar.list_events(google_calendar.access_token(refresh), start, end))
    events, errors = await asyncio.to_thread(events_for_day, root, day, settings.vault_tz, google)
    return {"events": events, "errors": errors}


# --- Google Calendar: connect once, then add events (owner only, except the OAuth callback) ----------------------

EVENT_AHEAD_DAYS = 60
GOOGLE_PATH = "/calendar/google"


@router.get(f"{GOOGLE_PATH}/status", response_model=GoogleStatusResponse)
async def google_status(user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    cred = await _credential(db, user)
    return {"configured": google_calendar.configured(), "connected": cred is not None, "email": cred.email if cred else None}


@router.get(f"{GOOGLE_PATH}/connect", response_model=GoogleConnectResponse)
async def google_connect(user: User = Depends(require_editor)):
    if not google_calendar.configured():
        raise HTTPException(status_code=409, detail="Google Calendar is not set up on the server")
    return {"url": google_calendar.build_auth_url(google_calendar.make_state(user.id))}


@router.get(f"{GOOGLE_PATH}/callback", include_in_schema=False)
async def google_callback(code: str = "", state: str = "", db: AsyncSession = Depends(get_db)):
    """Google sends the browser here, so there is no auth header: the signed state proves who started the flow."""
    back = f"{settings.web_public_url.rstrip('/')}/?calendar="
    user_id = google_calendar.read_state(state)
    if user_id is None or not code or not google_calendar.configured():
        return RedirectResponse(back + "error", status_code=302)
    user = await db.get(User, user_id)
    if user is None or not _can_edit(user):
        return RedirectResponse(back + "error", status_code=302)
    try:
        refresh, email = await asyncio.to_thread(google_calendar.exchange_code, code)
    except GoogleCalendarError:
        return RedirectResponse(back + "error", status_code=302)
    cred = await _credential(db, user)
    if cred:
        cred.refresh_token, cred.email = refresh, email
    else:
        db.add(GoogleCredential(user_id=user.id, email=email, refresh_token=refresh))
    await db.commit()
    return RedirectResponse(back + "connected", status_code=302)


@router.post("/day/{day}/events", response_model=CalendarEventResponse)
async def post_event(day: date, data: CalendarEventIn, user: User = Depends(require_editor), db: AsyncSession = Depends(get_db)):
    """Add an event to the owner's primary Google calendar. Today and the next 60 days."""
    today = _local_now().date()
    if not today <= day <= today + timedelta(days=EVENT_AHEAD_DAYS):
        raise HTTPException(status_code=422, detail=f"Events can be added for today and the next {EVENT_AHEAD_DAYS} days")
    title = data.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title is required")
    if data.end <= data.start:  # zero-padded HH:MM compares correctly as text
        raise HTTPException(status_code=422, detail="End must be after start")
    if not google_calendar.configured():
        raise HTTPException(status_code=409, detail="Google Calendar is not set up on the server")
    cred = await _credential(db, user)
    if not cred:
        raise HTTPException(status_code=409, detail="Connect Google Calendar first")

    zone = ZoneInfo(settings.vault_tz)
    start = datetime.combine(day, clock.fromisoformat(data.start), zone)
    end = datetime.combine(day, clock.fromisoformat(data.end), zone)
    location = (data.location or "").strip() or None
    try:
        def add():
            token = google_calendar.access_token(cred.refresh_token)
            return google_calendar.insert_event(token, title, start, end, settings.vault_tz, location)
        await asyncio.to_thread(add)
    except GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    midnight = datetime.combine(day, clock.min, zone)
    return {
        "title": title,
        "calendar": "Google Calendar",
        "color": None,
        "all_day": False,
        "location": location,
        "start_min": int((start - midnight).total_seconds() // 60),
        "end_min": int((end - midnight).total_seconds() // 60),
    }


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


# --- Quarter, streams, weekly objectives and pipelines (owner only) ----------------------------------------------

def _read(rel: str) -> str | None:
    note = Path(settings.vault_workdir) / rel
    return note.read_text(encoding="utf-8") if note.is_file() else None


def _streams(today: date):
    return load_streams(_read(quarter_path(quarter_for(today))))


def _info(s) -> dict:
    return {"stream": s.id, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly, "status": s.status}


def _write_error(exc: Exception) -> HTTPException:
    if isinstance(exc, VaultWriteError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def _objectives_response(today: date) -> ObjectivesResponse:
    start, end, label = week_for(today)
    streams = _streams(today)
    by_id = {s.id: s for s in streams}
    items = [{**i, "name": by_id[i["stream"]].name, "color": by_id[i["stream"]].color, "icon": by_id[i["stream"]].icon}
             for i in parse_objectives(_read(objectives_path(label)), streams)]
    return ObjectivesResponse(week=label, period=f"{start.isoformat()}/{end.isoformat()}", items=items)


@router.get("/objectives", response_model=ObjectivesResponse)
async def get_objectives(user: User = Depends(require_editor)):
    return await asyncio.to_thread(_objectives_response, _local_now().date())


@router.put("/objectives", response_model=ObjectivesResponse)
async def put_objective(data: ObjectiveIn, user: User = Depends(require_editor)):
    """Edit a week objective. For blocks with a pipeline the objective is its small-domino item: the item is renamed,
    created in Now (new text) or moved to Done / back to Now (done flag) in the same commit."""
    today = _local_now().date()
    week_start, _, label = week_for(today)
    streams = await asyncio.to_thread(_streams, today)
    edits = {objectives_path(label): lambda c: update_objective(c, today, data.stream, data.text, data.done, data.checkpoint, streams)}
    block = next((s for s in streams if s.id == data.stream), None)
    if block and block.goal and not block.archived and (data.text is not None or data.done is not None):
        path = pipeline_path(block.id)

        def link(c):
            return vault_pipeline.sync_focus(c, block.id, block.name, label, today, text=data.text, done=data.done) or (c or "")

        edits[path] = link
    try:
        await asyncio.to_thread(commit_edits, edits, f"Niyyah: W{label[-2:]} {data.stream} objective")
    except (ValueError, VaultWriteError) as exc:
        raise _write_error(exc)
    return await asyncio.to_thread(_objectives_response, today)


def _quarter_response(today: date) -> QuarterResponse:
    label = quarter_for(today)
    content = _read(quarter_path(label))
    if content is None:
        raise HTTPException(status_code=404, detail=f"{quarter_path(label)} is not in the synced vault yet")
    data = parse_quarter(content)
    year, number = int(label[:4]), int(label[-1])
    first = date(year, 3 * number - 2, 1)
    try:
        start = date.fromisoformat(data["starts"]) if data["starts"] else first
        end = date.fromisoformat(data["ends"]) if data["ends"] else first + timedelta(days=90)
    except ValueError:
        start, end = first, first + timedelta(days=90)
    streams = [{**_info(s["info"]), "goal": s["goal"], "checkpoints": s["checkpoints"]} for s in data["streams"]]
    return QuarterResponse(
        quarter=data["quarter"] or label, starts=start.isoformat(), ends=end.isoformat(),
        objective=data["objective"], objective_ar=data["objective_ar"],
        week_of_quarter=max(1, (today - start).days // 7 + 1), weeks_in_quarter=((end - start).days + 7) // 7,
        current_month=MONTHS[today.month - 1], months=quarter_months(label), colors=list(COLORS), icons=list(ICONS),
        streams=streams,
    )


@router.get("/quarter", response_model=QuarterResponse)
async def get_quarter(user: User = Depends(require_editor)):
    """This quarter's objective, goals and month checkpoints. Private plans, so owner only."""
    return await asyncio.to_thread(_quarter_response, _local_now().date())


async def _save_quarter(edit, message: str) -> QuarterResponse:
    today = _local_now().date()
    try:
        await asyncio.to_thread(commit_edits, {quarter_path(quarter_for(today)): edit}, message)
    except (ValueError, VaultWriteError) as exc:
        raise _write_error(exc)
    return await asyncio.to_thread(_quarter_response, today)


def _fields(data: StreamFieldsIn) -> dict[str, str]:
    out = {k: v for k, v in {"name": data.name, "color": data.color, "icon": data.icon, "slot": data.slot,
                             "goal": data.goal, "status": data.status}.items() if v is not None}
    if data.weekly is not None:
        out["weekly"] = "yes" if data.weekly else "no"
    out.update(data.checkpoints or {})
    return out


@router.put("/quarter", response_model=QuarterResponse)
async def put_super_objective(data: SuperObjectiveIn, user: User = Depends(require_editor)):
    label = quarter_for(_local_now().date())
    return await _save_quarter(lambda c: set_super_objective(c, label, data.text, data.arabic), "Niyyah: edit the Super Objective")


@router.put("/quarter/stream", response_model=QuarterResponse)
async def put_stream(data: StreamFieldsIn, user: User = Depends(require_editor)):
    label = quarter_for(_local_now().date())
    fields = _fields(data)
    if not fields:
        raise HTTPException(status_code=422, detail="nothing to change")
    return await _save_quarter(lambda c: update_stream(c, label, data.stream, fields), f"Niyyah: edit {data.stream} in the quarter")


@router.post("/quarter/stream", response_model=QuarterResponse)
async def post_stream(data: StreamAddIn, user: User = Depends(require_editor)):
    label = quarter_for(_local_now().date())
    fields = _fields(data)
    return await _save_quarter(lambda c: add_stream(c, label, data.stream, fields), f"Niyyah: add {data.stream} to the quarter")


def _pipelines_response(today: date) -> PipelinesResponse:
    streams = []
    for s in _streams(today):
        if not s.goal or s.archived:
            continue
        path = pipeline_path(s.id)
        streams.append({**_info(s), "path": path, "items": parse_pipeline(_read(path), today)})
    return PipelinesResponse(week=week_for(today)[2], now_limit=NOW_LIMIT, stale_days=STALE_DAYS, streams=streams)


@router.get("/pipelines", response_model=PipelinesResponse)
async def get_pipelines(user: User = Depends(require_editor)):
    return await asyncio.to_thread(_pipelines_response, _local_now().date())


async def _save_pipeline(stream: str, edit, message: str) -> EditResponse:
    streams = await asyncio.to_thread(_streams, _local_now().date())
    if stream not in {s.id for s in streams if s.goal and not s.archived}:
        raise HTTPException(status_code=422, detail=f"unknown stream '{stream}'")
    try:
        commit = await asyncio.to_thread(commit_edits, {pipeline_path(stream): edit}, message)
    except (ValueError, VaultWriteError) as exc:
        raise _write_error(exc)
    return EditResponse(commit=commit, day=None)


@router.post("/pipeline/{stream}/items", response_model=EditResponse)
async def post_pipeline_items(stream: str, data: PipelineAddIn, user: User = Depends(require_editor)):
    today = _local_now().date()
    name = next((s.name for s in await asyncio.to_thread(_streams, today) if s.id == stream), None)
    return await _save_pipeline(
        stream, lambda c: vault_pipeline.add_items(c, stream, data.texts, data.lane, today, name, data.descriptions),
        f"Niyyah: add {len([t for t in data.texts if t.strip()])} to {stream} pipeline")


def _item_at(stream: str, line: int, expected_hash: str, today: date) -> dict | None:
    return next((i for i in parse_pipeline(_read(pipeline_path(stream)), today) if i["line"] == line and i["hash"] == expected_hash), None)


async def _save_pipeline_and_objective(stream: str, edit, objective_edit, message: str) -> EditResponse:
    """Like _save_pipeline, but the same commit also updates this week's objectives note when `objective_edit` is given."""
    today = _local_now().date()
    streams = await asyncio.to_thread(_streams, today)
    if stream not in {s.id for s in streams if s.goal and not s.archived}:
        raise HTTPException(status_code=422, detail=f"unknown stream '{stream}'")
    edits = {pipeline_path(stream): edit}
    if objective_edit:
        edits[objectives_path(week_for(today)[2])] = objective_edit(streams)
    try:
        commit = await asyncio.to_thread(commit_edits, edits, message)
    except (ValueError, VaultWriteError) as exc:
        raise _write_error(exc)
    return EditResponse(commit=commit, day=None)


@router.put("/pipeline/move", response_model=EditResponse)
async def put_pipeline_move(data: PipelineMoveIn, user: User = Depends(require_editor)):
    today = _local_now().date()
    week = week_for(today)[2]
    item = await asyncio.to_thread(_item_at, data.stream, data.line, data.hash, today)
    objective_edit = None
    if item and item["focus"] == week and (data.lane == "done") != item["done"]:
        # finishing (or reopening) the small domino ticks (or unticks) the week objective
        objective_edit = lambda streams: (lambda c: update_objective(c, today, data.stream, None, data.lane == "done", None, streams))  # noqa: E731
    return await _save_pipeline_and_objective(
        data.stream, lambda c: vault_pipeline.move_item(c or "", data.line, data.hash, data.lane, today), objective_edit,
        f"Niyyah: {data.stream} pipeline item to {data.lane}")


@router.put("/pipeline/focus", response_model=EditResponse)
async def put_pipeline_focus(data: PipelineRefIn, user: User = Depends(require_editor)):
    """Make a pipeline item this week's small domino: it goes to Now and the objective line follows."""
    today = _local_now().date()
    week = week_for(today)[2]
    item = await asyncio.to_thread(_item_at, data.stream, data.line, data.hash, today)
    if not item:
        raise HTTPException(status_code=422, detail="that item changed or moved; reload and try again")
    objective_edit = lambda streams: (lambda c: update_objective(  # noqa: E731
        c, today, data.stream, item["text"], False, item["checkpoint"] or "", streams))
    return await _save_pipeline_and_objective(
        data.stream, lambda c: vault_pipeline.set_focus(c or "", data.line, data.hash, week, today), objective_edit,
        f"Niyyah: {data.stream} small domino for W{week[-2:]}")


@router.put("/pipeline/checkpoint", response_model=EditResponse)
async def put_pipeline_checkpoint(data: PipelineCheckpointIn, user: User = Depends(require_editor)):
    return await _save_pipeline(
        data.stream, lambda c: vault_pipeline.set_checkpoint(c or "", data.line, data.hash, data.checkpoint or None),
        f"Niyyah: {data.stream} pipeline item checkpoint")


@router.put("/pipeline/text", response_model=EditResponse)
async def put_pipeline_text(data: PipelineTextIn, user: User = Depends(require_editor)):
    return await _save_pipeline(
        data.stream, lambda c: vault_pipeline.set_text(c or "", data.line, data.hash, data.text),
        f"Niyyah: rename an item in the {data.stream} pipeline")


@router.put("/pipeline/description", response_model=EditResponse)
async def put_pipeline_description(data: PipelineDescriptionIn, user: User = Depends(require_editor)):
    return await _save_pipeline(
        data.stream, lambda c: vault_pipeline.set_description(c or "", data.line, data.hash, data.description),
        f"Niyyah: describe an item in the {data.stream} pipeline")


@router.put("/pipeline/blocked-by", response_model=EditResponse)
async def put_pipeline_blocked_by(data: PipelineBlockedByIn, user: User = Depends(require_editor)):
    return await _save_pipeline(
        data.stream, lambda c: vault_pipeline.set_blocked_by(c or "", data.line, data.hash, data.ids),
        f"Niyyah: set what an item in the {data.stream} pipeline waits on")


@router.post("/pipeline/remove", response_model=EditResponse)
async def post_pipeline_remove(data: PipelineRefIn, user: User = Depends(require_editor)):
    today = _local_now().date()
    item = await asyncio.to_thread(_item_at, data.stream, data.line, data.hash, today)
    objective_edit = None
    if item and item["focus"] == week_for(today)[2]:
        objective_edit = lambda streams: (lambda c: update_objective(c, today, data.stream, "", None, "", streams))  # noqa: E731
    return await _save_pipeline_and_objective(
        data.stream, lambda c: vault_pipeline.remove_item(c or "", data.line, data.hash), objective_edit,
        f"Niyyah: remove from {data.stream} pipeline")


# --- stream notebooks: ideas, meetings, blockers (owner only) ---------------------------------

def _notebooks_response(today: date) -> NotebooksResponse:
    streams = []
    for s in _streams(today):
        if not s.goal or s.archived:
            continue
        path = notebook_path(s.id)
        streams.append({**_info(s), "path": path, "entries": parse_notebook(_read(path))})
    return NotebooksResponse(streams=streams)


@router.get("/notebooks", response_model=NotebooksResponse)
async def get_notebooks(user: User = Depends(require_editor)):
    return await asyncio.to_thread(_notebooks_response, _local_now().date())


async def _save_notebook(stream: str, edit, message: str) -> EditResponse:
    streams = await asyncio.to_thread(_streams, _local_now().date())
    if stream not in {s.id for s in streams if s.goal and not s.archived}:
        raise HTTPException(status_code=422, detail=f"unknown stream '{stream}'")
    try:
        commit = await asyncio.to_thread(commit_edits, {notebook_path(stream): edit}, message)
    except (ValueError, VaultWriteError) as exc:
        raise _write_error(exc)
    return EditResponse(commit=commit, day=None)


@router.post("/notebook/{stream}/entries", response_model=EditResponse)
async def post_notebook_entry(stream: str, data: NotebookAddIn, user: User = Depends(require_editor)):
    today = _local_now().date()
    name = next((s.name for s in await asyncio.to_thread(_streams, today) if s.id == stream), None)
    return await _save_notebook(
        stream, lambda c: vault_notebook.add_entry(c, stream, name, data.kind, data.title, data.body, today),
        f"Niyyah: add a {data.kind} to the {stream} notebook")


@router.put("/notebook/entry", response_model=EditResponse)
async def put_notebook_entry(data: NotebookEditIn, user: User = Depends(require_editor)):
    return await _save_notebook(
        data.stream, lambda c: vault_notebook.set_entry(c or "", data.line, data.hash, data.title, data.body),
        f"Niyyah: edit an entry in the {data.stream} notebook")


@router.put("/notebook/blocker", response_model=EditResponse)
async def put_notebook_blocker(data: NotebookBlockerIn, user: User = Depends(require_editor)):
    return await _save_notebook(
        data.stream, lambda c: vault_notebook.set_blocker(c or "", data.line, data.hash, data.open),
        f"Niyyah: {'reopen' if data.open else 'clear'} a blocker in the {data.stream} notebook")


@router.post("/notebook/remove", response_model=EditResponse)
async def post_notebook_remove(data: PipelineRefIn, user: User = Depends(require_editor)):
    return await _save_notebook(
        data.stream, lambda c: vault_notebook.remove_entry(c or "", data.line, data.hash),
        f"Niyyah: remove an entry from the {data.stream} notebook")
