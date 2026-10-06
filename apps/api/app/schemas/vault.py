from datetime import date

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class VaultDayResponse(BaseModel):
    date: date
    mode: str
    possible: int
    blocks: dict[str, int]
    total: int
    pct: int
    focus: str | None
    log: str | None


class VaultWeekResponse(BaseModel):
    days: list[VaultDayResponse]
    totals: dict[str, int]
    week_total: int
    week_possible: int
    week_pct: int


class VaultMonthResponse(BaseModel):
    month: str
    days: list[VaultDayResponse]
    totals: dict[str, int]
    modes: dict[str, int]
    month_pct: int


class VaultBlocksSeriesResponse(BaseModel):
    range: int
    blocks: dict[str, list[int | None]]
    averages: dict[str, float]


class VaultStreakEntry(BaseModel):
    current: int
    longest: int


class VaultStreaksResponse(BaseModel):
    streaks: dict[str, VaultStreakEntry]


class ScheduleBlockResponse(BaseModel):
    block: str
    start: str
    end: str
    what: str


class VaultScheduleResponse(BaseModel):
    meta: dict
    days: dict[str, list[ScheduleBlockResponse]]
    errors: list[str]


class VaultSyncResponse(BaseModel):
    synced_days: int
    errors: list[str]


class ModeIn(BaseModel):
    mode: str


class VoteIn(BaseModel):
    block: str
    stars: int


class NoteIn(BaseModel):
    section: str  # e.g. "OT"
    span: str  # e.g. "06:00-16:03"
    text: str


class EditAccessResponse(BaseModel):
    allowed: bool


class EditResponse(BaseModel):
    commit: str
    day: VaultDayResponse | None


class TaskResponse(BaseModel):
    path: str
    line: int
    hash: str
    text: str
    done: bool


class TaskToggleIn(BaseModel):
    path: str
    line: int
    hash: str
    done: bool


class TaskIn(BaseModel):
    text: str


class TaskTextIn(BaseModel):
    path: str
    line: int
    hash: str
    text: str


class TaskRemoveIn(BaseModel):
    path: str
    line: int
    hash: str


class LogEntryResponse(BaseModel):
    index: int
    hash: str
    text: str


class LogEntryIn(BaseModel):
    index: int
    hash: str
    text: str


class LogEntryRemoveIn(BaseModel):
    index: int
    hash: str


ObjectiveStream = Literal["soul", "body", "kahf", "alisha", "distribution", "fnf", "sleep"]
PipelineStream = Literal["soul", "body", "kahf", "alisha", "distribution", "fnf", "finance"]
Month = Literal["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
Lane = Literal["now", "next", "backlog", "done"]


class ObjectiveItem(BaseModel):
    stream: ObjectiveStream
    text: str
    done: bool
    checkpoint: Month | None = None


class ObjectivesResponse(BaseModel):
    week: str  # "2026-W41"
    period: str  # "2026-10-03/2026-10-09"
    items: list[ObjectiveItem]


class ObjectiveIn(BaseModel):
    stream: ObjectiveStream
    text: str | None = None
    done: bool | None = None
    checkpoint: Month | Literal[""] | None = None  # "" clears it

    @model_validator(mode="after")
    def _something_to_change(self):
        if self.text is None and self.done is None and self.checkpoint is None:
            raise ValueError("give text, done and/or checkpoint")
        return self


# --- Quarter and pipelines ---------------------------------------------------------------------------------------

class QuarterCheckpoint(BaseModel):
    month: Month
    text: str


class QuarterStream(BaseModel):
    stream: PipelineStream
    goal: str
    status: str
    checkpoints: list[QuarterCheckpoint]


class QuarterResponse(BaseModel):
    quarter: str  # "2026-Q4"
    starts: str | None
    ends: str | None
    objective: str
    objective_ar: str
    week_of_quarter: int
    weeks_in_quarter: int
    current_month: Month
    streams: list[QuarterStream]


class PipelineItem(BaseModel):
    line: int
    hash: str
    text: str
    lane: Lane
    checkpoint: Month | None
    added: str | None
    done_on: str | None
    done: bool
    age_days: int
    stale: bool


class PipelineStreamData(BaseModel):
    stream: PipelineStream
    path: str
    items: list[PipelineItem]


class PipelinesResponse(BaseModel):
    now_limit: int
    stale_days: int
    streams: list[PipelineStreamData]


class PipelineAddIn(BaseModel):
    texts: list[str]
    lane: Lane = "backlog"


class PipelineRefIn(BaseModel):
    stream: PipelineStream
    line: int
    hash: str


class PipelineMoveIn(PipelineRefIn):
    lane: Lane


class PipelineCheckpointIn(PipelineRefIn):
    checkpoint: Month | Literal[""]


class CalendarEventResponse(BaseModel):
    title: str
    calendar: str
    color: str | None
    all_day: bool
    location: str | None
    start_min: int | None  # minutes since local midnight; None for all-day events
    end_min: int | None


class CalendarEventIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # local HH:MM
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    location: str | None = Field(default=None, max_length=200)


class GoogleStatusResponse(BaseModel):
    configured: bool
    connected: bool
    email: str | None


class GoogleConnectResponse(BaseModel):
    url: str


class CalendarEventsResponse(BaseModel):
    events: list[CalendarEventResponse]
    errors: list[str]
