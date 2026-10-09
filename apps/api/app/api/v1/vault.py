"""The planner API: days, votes, log, tasks, goals, quarter, streams, pipelines, notebooks, and the settings behind them.

Everything is scoped to the signed-in user. Writes go through the services in app/services/planner_*.py, which flush;
`_db_run` commits once and turns bad input (ValueError) into a 422 with nothing saved.
"""
import asyncio
from datetime import date, datetime, time as clock, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user, get_optional_user
from app.models.google import GoogleCredential
from app.models.user import User
from app.models.vault import VaultDay
from app.schemas.vault import (
    BlocksConfigIn,
    BlocksConfigResponse,
    CalendarEventIn,
    CalendarEventResponse,
    CalendarEventsResponse,
    DaysStatus,
    EditAccessResponse,
    EditResponse,
    FeedIn,
    FeedResponse,
    GoalItemTickIn,
    GoalsIn,
    GoalsResponse,
    GoogleConnectResponse,
    GoogleStatusResponse,
    LogEntryIn,
    LogEntryRemoveIn,
    LogEntryResponse,
    ModeIn,
    NoteIn,
    NotebookAddIn,
    NotebookBlockerIn,
    NotebookEditIn,
    NotebooksResponse,
    ObjectiveIn,
    ObjectivesResponse,
    PipelineAddIn,
    PipelineBlockedByIn,
    PipelineCheckpointIn,
    PipelineDescriptionIn,
    PipelineMoveIn,
    PipelineRefIn,
    PipelineTextIn,
    PipelinesResponse,
    QuarterResponse,
    ScheduleConfigIn,
    StreamAddIn,
    StreamFieldsIn,
    StreamItemTickIn,
    SuperObjectiveIn,
    TaskIn,
    TaskRemoveIn,
    TaskResponse,
    TaskTextIn,
    TaskToggleIn,
    VaultBlocksSeriesResponse,
    VaultDayResponse,
    VaultMonthResponse,
    VaultScheduleResponse,
    VaultStreakEntry,
    VaultStreaksResponse,
    VaultWeekResponse,
    VoteIn,
)
from app.services import google_calendar, planner_blocks, planner_config, planner_day, planner_store, planner_work
from app.services.calendar_events import events_for_day
from app.services.google_calendar import GoogleCalendarError
from app.services.planner_views import notebooks_response, objectives_response, pipelines_response, quarter_response
from app.services.rules import quarter_for, week_for

router = APIRouter(prefix="/vault", tags=["vault"])

EDIT_WINDOW_DAYS = 7


def _day_to_response(day: VaultDay) -> VaultDayResponse:
    blocks = {v.block: v.stars for v in day.block_votes}
    pct = round(100 * day.total / day.possible) if day.possible else 0
    return VaultDayResponse(
        date=day.date, mode=day.mode, possible=day.possible, blocks=blocks,
        total=day.total, pct=pct, focus=day.focus, log=day.log,
    )


async def _get_day(db: AsyncSession, target_date: date, user: User) -> VaultDay | None:
    result = await db.execute(select(VaultDay).where(VaultDay.user_id == user.id, VaultDay.date == target_date)
                              .options(selectinload(VaultDay.block_votes)))
    return result.scalar_one_or_none()


async def _get_days_range(db: AsyncSession, start: date, end: date, user: User) -> list[VaultDay]:
    result = await db.execute(
        select(VaultDay).where(VaultDay.user_id == user.id, VaultDay.date >= start, VaultDay.date <= end)
        .options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date))
    return list(result.scalars().all())


def _local_now() -> datetime:
    return datetime.now(ZoneInfo(settings.app_timezone))


def _check_day(day: date) -> None:
    today = _local_now().date()
    if not today - timedelta(days=EDIT_WINDOW_DAYS) <= day <= today:
        raise HTTPException(status_code=422, detail=f"Only the last {EDIT_WINDOW_DAYS} days can be edited")


async def _db_run(db: AsyncSession, work):
    """Run a database write and commit it. Bad input or a stale row (ValueError) is a 422 and nothing is saved."""
    try:
        result = await work()
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))


async def _day_write(db: AsyncSession, work) -> EditResponse:
    """A write whose `work()` returns the day row (or None); the response carries the day so the page can refresh at once."""
    row = await _db_run(db, work)
    return EditResponse(commit="db", day=_day_to_response(row) if row is not None else None)


# --- Days ---------------------------------------------------------------------------------------------------------

@router.get("/today", response_model=VaultDayResponse)
async def get_today(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    day = await _get_day(db, date.today(), user)
    if day is None:
        raise HTTPException(status_code=404, detail="No data for today yet")
    return _day_to_response(day)


@router.get("/week", response_model=VaultWeekResponse)
async def get_week(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    end = date.today()
    start = end - timedelta(days=6)
    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end, user)]

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

    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end, user)]

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
    day_rows = await _get_days_range(db, start, end, user)

    # Every block gets one entry per day in [start, end], using None where that block has no vote at all that day.
    # A block present on only some days must not yield a shorter array than one present every day: the frontend renders
    # each array element as an equal-width bar, so mismatched lengths would draw different time spans at the same width.
    votes_by_date = {day.date: {v.block: v.stars for v in day.block_votes} for day in day_rows}
    date_range = [start + timedelta(days=i) for i in range(days)]

    block_keys = await planner_blocks.counted_keys(db, user.id, include_archived=True)
    series: dict[str, list[int | None]] = {block: [] for block in block_keys}
    for d in date_range:
        day_votes = votes_by_date.get(d, {})
        for block in block_keys:
            series[block].append(day_votes.get(block))

    averages: dict[str, float] = {}
    for block, values in series.items():
        present = [v for v in values if v is not None]
        if present:
            averages[block] = round(sum(present) / len(present), 2)

    return VaultBlocksSeriesResponse(range=days, blocks=series, averages=averages)


@router.get("/streaks", response_model=VaultStreaksResponse)
async def get_streaks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(VaultDay).where(VaultDay.user_id == user.id)
                              .options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date.asc()))
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


@router.get("/status", response_model=DaysStatus)
async def get_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """How many days the user has logged, for the Vault page's status line."""
    days = (await db.execute(select(func.count()).select_from(VaultDay).where(VaultDay.user_id == user.id))).scalar_one()
    return DaysStatus(days=days)


# --- Settings: blocks, schedule, calendars, goals -----------------------------------------------------------------

@router.get("/schedule", response_model=VaultScheduleResponse)
async def get_schedule(user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to see your schedule")
    found = await planner_store.schedule(db, user.id)
    if found is None:
        raise HTTPException(status_code=404, detail="No schedule yet")
    return found


@router.get("/config/blocks", response_model=BlocksConfigResponse)
async def get_blocks_config(user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to see your blocks")
    return BlocksConfigResponse(blocks=await planner_blocks.list_blocks(db, user.id))


@router.put("/config/blocks", response_model=BlocksConfigResponse)
async def put_blocks_config(data: BlocksConfigIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _db_run(db, lambda: planner_blocks.replace_blocks(db, user.id, [b.model_dump() for b in data.blocks]))
    return BlocksConfigResponse(blocks=await planner_blocks.list_blocks(db, user.id))


@router.put("/config/schedule", response_model=VaultScheduleResponse)
async def put_schedule_config(data: ScheduleConfigIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    streams = await planner_store.streams_for(db, user.id, today)
    ids = {s.id for s in streams}
    await _db_run(db, lambda: planner_config.replace_schedule(
        db, user.id, data.meta.model_dump(), [r.model_dump() for r in data.weekday], [r.model_dump() for r in data.weekend], ids))
    return await planner_store.schedule(db, user.id)


@router.get("/config/feeds", response_model=list[FeedResponse])
async def get_feeds(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await planner_config.list_feeds(db, user.id)


@router.post("/config/feeds", response_model=FeedResponse)
async def post_feed(data: FeedIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _db_run(db, lambda: planner_config.add_feed(db, user.id, data.name, data.url))
    return (await planner_config.list_feeds(db, user.id))[-1]


@router.delete("/config/feeds/{feed_id}", status_code=204)
async def delete_feed(feed_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not await planner_config.remove_feed(db, user.id, feed_id):
        raise HTTPException(status_code=404, detail="no such calendar")
    await db.commit()


@router.get("/goals", response_model=GoalsResponse)
async def get_goals(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Goal cards for the Overview header."""
    return GoalsResponse(items=await planner_store.goals(db, user.id))


@router.put("/goals/item", response_model=GoalsResponse)
async def put_goal_item(data: GoalItemTickIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Tick or untick one line of a goal card."""
    await _db_run(db, lambda: planner_config.toggle_goal_item(db, user.id, data.id, data.done))
    return GoalsResponse(items=await planner_store.goals(db, user.id))


@router.put("/config/goals", response_model=GoalsResponse)
async def put_goals_config(data: GoalsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _db_run(db, lambda: planner_config.replace_goals(db, user.id, [g.model_dump() for g in data.items]))
    return GoalsResponse(items=await planner_store.goals(db, user.id))


@router.get("/edit-access", response_model=EditAccessResponse)
async def edit_access(user: User = Depends(get_current_user)):
    """Every signed-in user may edit their own data; the web app asks this to tell a signed-in page from a public one."""
    return EditAccessResponse(allowed=True)


# --- Day: mode, votes, log notes, tasks ---------------------------------------------------------------------------

@router.put("/day/{day}/mode", response_model=EditResponse)
async def put_mode(day: date, data: ModeIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _day_write(db, lambda: planner_day.set_mode(db, user.id, day, data.mode))


@router.put("/day/{day}/vote", response_model=EditResponse)
async def put_vote(day: date, data: VoteIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _day_write(db, lambda: planner_day.set_vote(db, user.id, day, data.block, data.stars))


@router.post("/day/{day}/notes", response_model=EditResponse)
async def post_note(day: date, data: NoteIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    now = _local_now().strftime("%H:%M")
    return await _day_write(db, lambda: planner_day.add_note(db, user.id, day, now, data.section, data.span, data.text))


@router.get("/day/{day}/tasks", response_model=list[TaskResponse])
async def get_day_tasks(day: date, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Tasks due, scheduled or starting on `day`."""
    return await planner_store.day_tasks(db, user.id, day)


@router.put("/tasks", response_model=EditResponse)
async def put_task(data: TaskToggleIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _day_write(db, lambda: planner_day.set_task_done(db, user.id, data.line, data.done, _local_now().date()))


@router.put("/tasks/text", response_model=EditResponse)
async def put_task_text(data: TaskTextIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _day_write(db, lambda: planner_day.set_task_text(db, user.id, data.line, data.text))


@router.post("/tasks/remove", response_model=EditResponse)
async def post_task_remove(data: TaskRemoveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _day_write(db, lambda: planner_day.remove_task(db, user.id, data.line))


@router.post("/day/{day}/tasks", response_model=EditResponse)
async def post_task(day: date, data: TaskIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _day_write(db, lambda: planner_day.add_task(db, user.id, day, data.text))


@router.get("/day/{day}/log", response_model=list[LogEntryResponse])
async def get_day_log(day: date, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await planner_store.day_log(db, user.id, day)


@router.put("/day/{day}/log", response_model=EditResponse)
async def put_log_entry(day: date, data: LogEntryIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _day_write(db, lambda: planner_day.edit_log_entry(db, user.id, day, data.index, data.hash, data.text))


@router.post("/day/{day}/log/remove", response_model=EditResponse)
async def post_log_remove(day: date, data: LogEntryRemoveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    return await _day_write(db, lambda: planner_day.remove_log_entry(db, user.id, day, data.index, data.hash))


# --- Calendar events and Google Calendar --------------------------------------------------------------------------

EVENT_AHEAD_DAYS = 60
GOOGLE_PATH = "/calendar/google"


async def _credential(db: AsyncSession, user: User) -> GoogleCredential | None:
    return (await db.execute(select(GoogleCredential).where(GoogleCredential.user_id == user.id))).scalar_one_or_none()


@router.get("/day/{day}/events", response_model=CalendarEventsResponse)
async def get_day_events(day: date, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The day's events from the user's calendar feeds.

    The feed matching the connected Google account is read through the Calendar API (fresh), the rest via iCal."""
    cred = await _credential(db, user)
    google = None
    if cred:
        refresh = cred.refresh_token
        google = (cred.email, lambda start, end: google_calendar.list_events(google_calendar.access_token(refresh), start, end))
    feeds = await planner_store.calendar_feeds(db, user.id)
    events, errors = await asyncio.to_thread(events_for_day, day, settings.app_timezone, feeds, google)
    return {"events": events, "errors": errors}


@router.get(f"{GOOGLE_PATH}/status", response_model=GoogleStatusResponse)
async def google_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    cred = await _credential(db, user)
    return {"configured": google_calendar.configured(), "connected": cred is not None, "email": cred.email if cred else None}


@router.get(f"{GOOGLE_PATH}/connect", response_model=GoogleConnectResponse)
async def google_connect(user: User = Depends(get_current_user)):
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
    if user is None:
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
async def post_event(day: date, data: CalendarEventIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Add an event to the user's primary Google calendar. Today and the next 60 days."""
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

    zone = ZoneInfo(settings.app_timezone)
    start = datetime.combine(day, clock.fromisoformat(data.start), zone)
    end = datetime.combine(day, clock.fromisoformat(data.end), zone)
    location = (data.location or "").strip() or None
    try:
        def add():
            token = google_calendar.access_token(cred.refresh_token)
            return google_calendar.insert_event(token, title, start, end, settings.app_timezone, location)
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


# --- Quarter, streams, weekly objectives and pipelines ------------------------------------------------------------

@router.get("/objectives", response_model=ObjectivesResponse)
async def get_objectives(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    streams = await planner_store.streams_for(db, user.id, today)
    parsed = await planner_store.week_objectives(db, user.id, week_for(today)[2], streams)
    return objectives_response(parsed, streams, today)


@router.put("/objectives", response_model=ObjectivesResponse)
async def put_objective(data: ObjectiveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Edit a week objective. For blocks with a pipeline the objective is its small-domino item: the item is renamed,
    created in Now (new text) or moved to Done / back to Now (done flag) in the same commit."""
    today = _local_now().date()
    week = week_for(today)[2]
    streams = await planner_store.streams_for(db, user.id, today)
    block = next((s for s in streams if s.id == data.stream), None)

    async def work():
        await planner_work.update_objective(db, user.id, today, data.stream, data.text, data.done, data.checkpoint, streams)
        if block and block.goal and not block.archived and (data.text is not None or data.done is not None):
            await planner_work.sync_focus(db, user.id, data.stream, week, today, text=data.text, done=data.done)

    await _db_run(db, work)
    parsed = await planner_store.week_objectives(db, user.id, week, streams)
    return objectives_response(parsed, streams, today)


async def _quarter(db: AsyncSession, user: User, today: date) -> QuarterResponse:
    label = quarter_for(today)
    data = await planner_store.quarter_data(db, user.id, label)
    if data is None:  # a new account has no plan yet: start this quarter with the placeholder objective
        await _db_run(db, lambda: planner_work.ensure_quarter(db, user.id, label))
        data = await planner_store.quarter_data(db, user.id, label)
    return quarter_response(data, label, today)


@router.get("/quarter", response_model=QuarterResponse)
async def get_quarter(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """This quarter's objective, goals and month checkpoints."""
    return await _quarter(db, user, _local_now().date())


def _fields(data: StreamFieldsIn) -> dict[str, str]:
    out = {k: v for k, v in {"name": data.name, "color": data.color, "icon": data.icon, "slot": data.slot,
                             "goal": data.goal, "status": data.status}.items() if v is not None}
    if data.weekly is not None:
        out["weekly"] = "yes" if data.weekly else "no"
    out.update(data.checkpoints or {})
    return out


def _lists(data: StreamFieldsIn):
    """The goal's lines and the months' lines from a stream request, as plain dicts (None where the request leaves them alone)."""
    goal = None if data.goal_checklist is None else [i.model_dump() for i in data.goal_checklist]
    months = None if data.month_checklists is None else {m: [i.model_dump() for i in items] for m, items in data.month_checklists.items()}
    return goal, months


@router.put("/quarter", response_model=QuarterResponse)
async def put_super_objective(data: SuperObjectiveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    label = quarter_for(today)
    await _db_run(db, lambda: planner_work.set_super_objective(db, user.id, label, data.text, data.arabic))
    return await _quarter(db, user, today)


@router.put("/quarter/stream", response_model=QuarterResponse)
async def put_stream(data: StreamFieldsIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    label = quarter_for(today)
    fields = _fields(data)
    if not fields and data.goal_checklist is None and not data.month_checklists:
        raise HTTPException(status_code=422, detail="nothing to change")
    await _db_run(db, lambda: planner_work.update_stream(db, user.id, label, data.stream, fields, *_lists(data)))
    return await _quarter(db, user, today)


@router.put("/quarter/stream/item", response_model=QuarterResponse)
async def put_stream_item(data: StreamItemTickIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Tick or untick one line of a stream's goal or of one of its months."""
    today = _local_now().date()
    await _db_run(db, lambda: planner_work.toggle_stream_item(db, user.id, quarter_for(today), data.stream, data.scope, data.id, data.done))
    return await _quarter(db, user, today)


@router.post("/quarter/stream", response_model=QuarterResponse)
async def post_stream(data: StreamAddIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    label = quarter_for(today)
    fields = _fields(data)
    await _db_run(db, lambda: planner_work.add_stream(db, user.id, label, data.stream, fields, *_lists(data)))
    return await _quarter(db, user, today)


@router.get("/pipelines", response_model=PipelinesResponse)
async def get_pipelines(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    streams = await planner_store.streams_for(db, user.id, today)
    return pipelines_response(streams, await planner_store.pipeline_items(db, user.id, today), today)


async def _known_stream(db: AsyncSession, user: User, stream: str, today: date) -> None:
    streams = await planner_store.streams_for(db, user.id, today)
    if stream not in {s.id for s in streams if s.goal and not s.archived}:
        raise HTTPException(status_code=422, detail=f"unknown stream '{stream}'")


@router.post("/pipeline/{stream}/items", response_model=EditResponse)
async def post_pipeline_items(stream: str, data: PipelineAddIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    await _known_stream(db, user, stream, today)
    return await _day_write(db, lambda: planner_work.add_items(db, user.id, stream, data.texts, data.lane, today, data.descriptions))


@router.put("/pipeline/move", response_model=EditResponse)
async def put_pipeline_move(data: PipelineMoveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    await _known_stream(db, user, data.stream, today)
    week = week_for(today)[2]
    streams = await planner_store.streams_for(db, user.id, today)

    async def work():
        item = await planner_work.item_row(db, user.id, data.stream, data.line)
        if item.focus_week == week and (data.lane == "done") != item.done:  # finishing the small domino ticks the objective
            await planner_work.update_objective(db, user.id, today, data.stream, None, data.lane == "done", None, streams)
        await planner_work.move_item(db, user.id, data.stream, data.line, data.lane, today)

    return await _day_write(db, work)


@router.put("/pipeline/focus", response_model=EditResponse)
async def put_pipeline_focus(data: PipelineRefIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Make a pipeline item this week's small domino: it goes to Now and the objective line follows."""
    today = _local_now().date()
    await _known_stream(db, user, data.stream, today)
    week = week_for(today)[2]
    streams = await planner_store.streams_for(db, user.id, today)

    async def work():
        item = await planner_work.item_row(db, user.id, data.stream, data.line)
        await planner_work.update_objective(db, user.id, today, data.stream, item.text, False, item.checkpoint or "", streams)
        await planner_work.set_focus(db, user.id, data.stream, data.line, week, today)

    return await _day_write(db, work)


@router.put("/pipeline/checkpoint", response_model=EditResponse)
async def put_pipeline_checkpoint(data: PipelineCheckpointIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_checkpoint(db, user.id, data.stream, data.line, data.checkpoint or None))


@router.put("/pipeline/text", response_model=EditResponse)
async def put_pipeline_text(data: PipelineTextIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_text(db, user.id, data.stream, data.line, data.text))


@router.put("/pipeline/description", response_model=EditResponse)
async def put_pipeline_description(data: PipelineDescriptionIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_description(db, user.id, data.stream, data.line, data.description))


@router.put("/pipeline/blocked-by", response_model=EditResponse)
async def put_pipeline_blocked_by(data: PipelineBlockedByIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_blocked_by(db, user.id, data.stream, data.line, data.ids))


@router.post("/pipeline/remove", response_model=EditResponse)
async def post_pipeline_remove(data: PipelineRefIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    await _known_stream(db, user, data.stream, today)
    week = week_for(today)[2]
    streams = await planner_store.streams_for(db, user.id, today)

    async def work():
        item = await planner_work.item_row(db, user.id, data.stream, data.line)
        if item.focus_week == week:
            await planner_work.update_objective(db, user.id, today, data.stream, "", None, "", streams)
        await planner_work.remove_item(db, user.id, data.stream, data.line)

    return await _day_write(db, work)


# --- Stream notebooks: ideas, meetings, blockers ------------------------------------------------------------------

@router.get("/notebooks", response_model=NotebooksResponse)
async def get_notebooks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    streams = await planner_store.streams_for(db, user.id, _local_now().date())
    return notebooks_response(streams, await planner_store.notebook_entries(db, user.id))


@router.post("/notebook/{stream}/entries", response_model=EditResponse)
async def post_notebook_entry(stream: str, data: NotebookAddIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    await _known_stream(db, user, stream, today)
    return await _day_write(db, lambda: planner_work.add_entry(db, user.id, stream, data.kind, data.title, data.body, today))


@router.put("/notebook/entry", response_model=EditResponse)
async def put_notebook_entry(data: NotebookEditIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_entry(db, user.id, data.stream, data.line, data.title, data.body))


@router.put("/notebook/blocker", response_model=EditResponse)
async def put_notebook_blocker(data: NotebookBlockerIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.set_blocker(db, user.id, data.stream, data.line, data.open))


@router.post("/notebook/remove", response_model=EditResponse)
async def post_notebook_remove(data: PipelineRefIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _known_stream(db, user, data.stream, _local_now().date())
    return await _day_write(db, lambda: planner_work.remove_entry(db, user.id, data.stream, data.line))
