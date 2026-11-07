from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

BundleStatus = Literal["pending", "applied", "partly_applied", "rejected", "undone"]
LineStatus = Literal["pending", "applied", "skipped", "stale", "failed", "undone"]


class LineIn(BaseModel):
    """One proposed change. `entity` + `op` pick what it does; `target`, `payload` and `base` depend on that (see docs/suggestions.md)."""
    entity: str = Field(min_length=1, max_length=24)
    op: str = Field(min_length=1, max_length=16)
    target: dict = {}
    payload: dict = {}
    base: dict | None = None  # what the author saw; read from the current data when left out
    ref: str | None = Field(default=None, max_length=8)  # names a created item so later lines can point at it


class SuggestionIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="", max_length=4000)
    run_id: str | None = Field(default=None, max_length=36)
    lines: list[LineIn] = Field(min_length=1, max_length=40)


class ApplyIn(BaseModel):
    lines: list[int] | None = None  # the seq numbers to apply; all lines when left out


class LineOut(BaseModel):
    seq: int
    entity: str
    op: str
    target: dict
    payload: dict
    base: dict | None
    ref: str | None
    created_key: dict | None
    status: LineStatus
    error: str | None


class SuggestionSummary(BaseModel):
    id: int
    source: str
    run_id: str | None
    title: str
    status: BundleStatus
    lines: int
    created_at: datetime
    decided_at: datetime | None


class SuggestionOut(BaseModel):
    id: int
    source: str
    run_id: str | None
    title: str
    reason: str
    status: BundleStatus
    created_at: datetime
    decided_at: datetime | None
    undo_until: datetime | None  # the last moment Undo works (applied bundles only)
    lines: list[LineOut]


class SuggestionList(BaseModel):
    pending: int  # how many are waiting, for the menu badge
    items: list[SuggestionSummary]
