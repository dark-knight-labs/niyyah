"""Task extras a capture client sends and reads back: link, exact deadline, tracked time and a running timer. See docs/capture-api.md."""
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

MAX_LINK = 2048
MAX_TRACKED_SECONDS = 315_360_000  # ten years: fits a 32-bit column and no real task is longer
CLOCK_SKEW = timedelta(days=1)  # a timer or deadline this far ahead is a clock error for a timer, fine for a deadline

Status = Literal["open", "done", "skipped"]


def clean_link(value: str | None) -> str | None:
    """An absolute http or https URL, or None. Anything else (javascript:, file:, relative, with spaces) is refused."""
    if value is None:
        return None
    if not value or len(value) > MAX_LINK:
        raise ValueError(f"link must be 1-{MAX_LINK} characters")
    if any(ord(c) < 33 or ord(c) == 127 for c in value):
        raise ValueError("link must not contain spaces or control characters")
    parts = urlsplit(value)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        raise ValueError("link must be an absolute http or https URL")
    return value


def aware(value: datetime | None) -> datetime | None:
    """A moment with a zone, in UTC. A date-time without a zone is ambiguous, so it is refused."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("send a date-time with a zone, e.g. 2026-12-01T17:30:00Z")
    try:
        return value.astimezone(timezone.utc)
    except OverflowError:  # year 1 with a positive offset, year 9999 with a negative one
        raise ValueError("that date-time is out of range")


class TaskExtrasIn(BaseModel):
    """Optional on every create and update: a client that does not know them simply leaves them out."""
    link: str | None = Field(default=None, max_length=MAX_LINK)
    deadline_at: datetime | None = None  # the exact deadline; due_on stays the date-only due day
    tracked_seconds: int | None = Field(default=None, ge=0, le=MAX_TRACKED_SECONDS)  # time banked before the running timer started
    timer_started_at: datetime | None = None  # when the running timer started; null = no timer running

    @field_validator("link")
    @classmethod
    def _link(cls, v):
        return clean_link(v)

    @field_validator("deadline_at")
    @classmethod
    def _deadline(cls, v):
        return aware(v)

    @field_validator("timer_started_at")
    @classmethod
    def _timer(cls, v):
        v = aware(v)
        if v is not None and v > datetime.now(timezone.utc) + CLOCK_SKEW:
            raise ValueError("timer_started_at is in the future")
        return v


class CaptureTaskPatch(TaskExtrasIn):
    """What a device may change on a task it captured. Only the fields sent change; null clears link, deadline_at and timer_started_at."""
    text: str | None = Field(default=None, min_length=1, max_length=300)
    done: bool | None = None

    @field_validator("text", "done", "tracked_seconds")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("cannot be null")
        return v


class CaptureTask(BaseModel):
    client_id: UUID
    id: int
    text: str
    status: Status
    done: bool
    link: str | None
    deadline_at: datetime | None
    tracked_seconds: int
    timer_started_at: datetime | None
    due_on: date | None
    scheduled_on: date | None
    lane: str | None
    stream: str | None
    products: list[str]


class CaptureTasks(BaseModel):
    tasks: list[CaptureTask]


class WeeklyLogEntry(BaseModel):
    id: int
    text: str
    stream: str | None  # null = filed under no stream ("Unfiled")
    done: bool
    on: Literal["done", "captured"]  # which date it sits on: the day it was finished, or (still open) the day it is for
    link: str | None
    tracked_seconds: int


class WeeklyLogDay(BaseModel):
    day: date
    entries: list[WeeklyLogEntry]


class WeeklyLogStream(BaseModel):
    stream: str | None  # null = "Unfiled": captures that named no stream
    name: str
    color: str
    done: int  # finished this week
    total: int  # listed this week: finished + still open


class WeeklyLog(BaseModel):
    week: str  # "2026-W48", Sunday to Saturday
    start: date
    end: date
    prev_week: str  # for the previous / next buttons
    next_week: str
    streams: list[WeeklyLogStream]  # only streams with something this week
    days: list[WeeklyLogDay]  # always seven, Sunday first
