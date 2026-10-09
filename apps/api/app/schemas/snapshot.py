"""The export snapshot as an import payload (docs/export-format.md). Limits match the database columns, so bad input is a 422."""
import datetime as dt
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Str = Annotated[str, StringConstraints(strip_whitespace=False)]
Slug = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{1,23}$")]
QuarterLabel = Annotated[str, StringConstraints(pattern=r"^\d{4}-Q[1-4]$")]
WeekLabel = Annotated[str, StringConstraints(pattern=r"^\d{4}-W\d{2}$")]
Month = Annotated[str, StringConstraints(pattern=r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$")]


class _Loose(BaseModel):
    model_config = ConfigDict(extra="ignore")


class SnapBlock(_Loose):
    key: str = Field(max_length=20)
    label: str = Field(max_length=40)
    ring_name: str = Field(max_length=6)
    color: str = Field(max_length=20)
    counts_for_stars: bool = True
    archived: bool = False


class SnapScheduleRow(_Loose):
    block: str = Field(max_length=20)
    start: str = Field(max_length=20)
    end: str = Field(max_length=20)
    what: str = ""
    stream: str | None = Field(default=None, max_length=24)


class SnapSchedule(_Loose):
    meta: dict = {}
    days: dict[str, list[SnapScheduleRow]] = {}

    @field_validator("days")
    @classmethod
    def _day_types(cls, days):
        if set(days) - {"weekday", "weekend"}:
            raise ValueError("schedule days are 'weekday' and 'weekend'")
        return days


class SnapFeed(_Loose):
    name: str = Field(max_length=120)
    url: str | None = Field(default=None, max_length=2000)  # an export never carries it; a feed without one is skipped on import
    color: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=255)

    @field_validator("url")
    @classmethod
    def _https(cls, url):
        if url is not None and not url.startswith("https://"):
            raise ValueError("calendar addresses must be https")
        return url


class SnapGoal(_Loose):
    title: str = Field(max_length=200)
    value: str = Field(max_length=400)
    caption: str = Field(default="", max_length=400)
    progress: int | None = Field(default=None, ge=0, le=100)


class SnapCheckpoint(_Loose):
    month: Month
    text: str = ""


class SnapStream(_Loose):
    slug: Slug
    name: str = Field(max_length=80)
    color: str = Field(max_length=20)
    icon: str = Field(max_length=30)
    slot: str = Field(default="", max_length=200)
    weekly: bool = True
    has_pipeline: bool = True
    in_note: bool = True
    goal: str = ""
    status: str = Field(default="committed", max_length=20)
    checkpoints: list[SnapCheckpoint] = []


class SnapQuarter(_Loose):
    label: QuarterLabel
    starts: dt.date | None = None
    ends: dt.date | None = None
    objective: str = ""
    objective_ar: str = ""
    streams: list[SnapStream] = []


class SnapObjective(_Loose):
    week: WeekLabel
    stream: Slug
    text: str = ""
    done: bool = False
    checkpoint: Month | None = None


class SnapPipelineItem(_Loose):
    stream: Slug
    lane: str = Field(pattern=r"^(now|next|backlog|done)$")
    text: str
    description: str = ""
    product: str | None = Field(default=None, max_length=100)
    checkpoint: Month | None = None
    added_on: dt.date | None = None
    done_on: dt.date | None = None
    focus_week: WeekLabel | None = None
    done: bool = False
    blocked_by: list[str] = []


class SnapNotebookEntry(_Loose):
    stream: Slug
    id: str = Field(max_length=24)
    kind: str = Field(pattern=r"^(idea|meeting|blocker)$")
    title: str = Field(max_length=200)
    body: str = ""
    date: str | None = Field(default=None, max_length=10)
    open: bool | None = None


class SnapDay(_Loose):
    date: dt.date
    mode: str = Field(max_length=20)
    possible: int = 0
    total: int = 0
    focus: str | None = None
    votes: dict[str, int] = {}
    log: list[str] = []


class SnapTask(_Loose):
    text: str
    done: bool = False
    due_on: dt.date | None = None
    scheduled_on: dt.date | None = None
    start_on: dt.date | None = None
    done_on: dt.date | None = None
    source_path: str | None = Field(default=None, max_length=500)


def _cap(limit: int):
    return Field(default=[], max_length=limit)


class Snapshot(_Loose):
    version: int
    blocks: list[SnapBlock] = _cap(60)
    schedule: SnapSchedule | None = None
    feeds: list[SnapFeed] = _cap(50)
    goals: list[SnapGoal] = _cap(20)
    quarters: list[SnapQuarter] = _cap(200)
    week_objectives: list[SnapObjective] = _cap(20000)
    pipeline_items: list[SnapPipelineItem] = _cap(20000)
    notebook_entries: list[SnapNotebookEntry] = _cap(20000)
    days: list[SnapDay] = _cap(20000)
    tasks: list[SnapTask] = _cap(50000)

    @field_validator("version")
    @classmethod
    def _version(cls, v):
        if v != 1:
            raise ValueError("this server reads export format version 1")
        return v
