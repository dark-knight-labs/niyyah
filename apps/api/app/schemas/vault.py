from datetime import date

from pydantic import BaseModel


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
