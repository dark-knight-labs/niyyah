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
    blocks: dict[str, list[int]]
    averages: dict[str, float]


class VaultStreakEntry(BaseModel):
    current: int
    longest: int


class VaultStreaksResponse(BaseModel):
    streaks: dict[str, VaultStreakEntry]


class VaultSyncResponse(BaseModel):
    synced_days: int
    errors: list[str]
