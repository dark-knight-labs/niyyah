"""The export snapshot as an import payload (docs/export-format.md). Limits match the database columns, so bad input is a 422."""
import datetime as dt
import re
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.schemas.board import EdgeIn, NodeIn, Title, _small_json

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


class SnapLine(_Loose):
    id: str | None = Field(default=None, max_length=12)
    text: str = Field(max_length=400)
    done: bool = False


class SnapGoal(_Loose):
    title: str = Field(max_length=200)
    value: str = Field(max_length=400)
    caption: str = Field(default="", max_length=400)
    progress: int | None = Field(default=None, ge=0, le=100)
    checklist: list[SnapLine] = Field(default=[], max_length=15)


class SnapCheckpoint(_Loose):
    month: Month
    text: str = ""
    checklist: list[SnapLine] = Field(default=[], max_length=15)


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
    goal_checklist: list[SnapLine] = Field(default=[], max_length=15)
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
    id: int | None = None  # the old row id an export carries; kept as the new row's origin
    stream: Slug
    lane: str = Field(pattern=r"^(now|next|backlog|done)$")
    text: str
    description: str = ""
    product: str | None = Field(default=None, max_length=100)  # older exports: a single tag; products wins
    products: list[str] = Field(default=[], max_length=8)
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
    stream: str | None = Field(default=None, max_length=24)
    products: list[str] = []
    description: str = Field(default="", max_length=4000)
    # Item fields (newer exports). Older ones lack them: status then follows `done`, which wins whenever the two disagree.
    status: str | None = Field(default=None, pattern=r"^(open|done|skipped)$")
    start_min: int | None = Field(default=None, ge=0, le=1440)
    end_min: int | None = Field(default=None, ge=0, le=1440)
    weight: int = Field(default=0, ge=0, le=3)
    checklist: list[SnapLine] = Field(default=[], max_length=50)
    # Newer exports: the row's id in the export and the id of the row it is a piece of (ids are remapped on import).
    id: int | None = None
    parent_ref: int | None = None


class SnapPlanningRow(_Loose):
    """A task row that is a pipeline item and/or carries a week's objective: the full row (docs/export-format.md).

    lane null + focus_week set + objective_text set = a week objective no pipeline item carries."""
    id: int | None = None
    parent_ref: int | None = None
    origin: str | None = Field(default=None, max_length=48)
    stream: Slug
    lane: str | None = Field(default=None, pattern=r"^(now|next|backlog|done)$")
    lane_position: int | None = None
    text: str
    description: str = Field(default="", max_length=4000)
    products: list[str] = Field(default=[], max_length=12)
    checkpoint: Month | None = None
    added_on: dt.date | None = None
    done: bool = False
    done_on: dt.date | None = None
    status: str | None = Field(default=None, pattern=r"^(open|done|skipped)$")
    focus_week: WeekLabel | None = None
    objective_text: str | None = None
    objective_done: bool | None = None
    focus_checkpoint: Month | None = None
    blocked_by: list[str] = []
    due_on: dt.date | None = None
    scheduled_on: dt.date | None = None
    start_on: dt.date | None = None
    source_path: str | None = Field(default=None, max_length=500)
    start_min: int | None = Field(default=None, ge=0, le=1440)
    end_min: int | None = Field(default=None, ge=0, le=1440)
    weight: int = Field(default=0, ge=0, le=3)
    checklist: list[SnapLine] = Field(default=[], max_length=50)
    goal_ref: str | None = Field(default=None, max_length=16)  # Plan v2; absent in older exports
    label_month: str | None = Field(default=None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
    label_date: dt.date | None = None


class SnapOverlay(_Loose):
    """What the user added to one calendar event, matched by its event key (docs/export-format.md)."""
    key: str = Field(min_length=1, max_length=400)
    calendar: str = Field(default="", max_length=120)
    title: str = Field(default="", max_length=300)
    day: dt.date | None = None
    status: str = Field(default="open", pattern=r"^(open|done|skipped)$")
    weight: int = Field(default=0, ge=0, le=3)
    stream: str | None = Field(default=None, max_length=24)
    products: list[str] = []
    description: str = Field(default="", max_length=4000)
    checklist: list[SnapLine] = Field(default=[], max_length=50)


def _cap(limit: int):
    return Field(default=[], max_length=limit)


class SnapHabit(_Loose):
    name: str = Field(max_length=200)
    block: str = Field(max_length=20)
    anchor: str = Field(default="", max_length=60)
    per_week: int = Field(default=7, ge=1, le=7)
    minimum: str = Field(default="", max_length=120)
    stage: str = Field(default="installing", pattern=r"^(installing|rails|retired)$")
    stream: str | None = Field(default=None, max_length=24)
    gate_pct: int = Field(default=80, ge=1, le=100)
    gate_weeks: int = Field(default=8, ge=1, le=52)
    trip_pct: int | None = Field(default=None, ge=1, le=100)
    trip_weeks: int | None = Field(default=None, ge=1, le=26)
    started_on: dt.date
    checks: dict[dt.date, str] = {}

    @field_validator("checks")
    @classmethod
    def _levels(cls, checks):
        if set(checks.values()) - {"done", "min"}:
            raise ValueError("a habit check is 'done' or 'min'")
        return checks


class SnapCompass(_Loose):
    mission: str = Field(default="", max_length=1000)
    vision: str = Field(default="", max_length=1000)
    vision_horizon: str = Field(default="", max_length=10)


class SnapPersonaStream(_Loose):
    name: str = Field(max_length=100)
    stream: Slug


class SnapBoardNode(NodeIn):
    model_config = ConfigDict(extra="ignore")


class SnapBoardEdge(EdgeIn):
    model_config = ConfigDict(extra="ignore")


class SnapBoard(_Loose):
    """A board of the file. No db id: boards get new ones on import."""
    title: Title
    kind: str = Field(default="free", pattern=r"^(life|free)$")
    viewport: dict = Field(default_factory=dict)
    nodes: list[SnapBoardNode] = _cap(5000)   # the per-board limits of the API; the importer also caps the total over all boards
    edges: list[SnapBoardEdge] = _cap(5000)

    @field_validator("viewport")
    @classmethod
    def _viewport(cls, v):
        return _small_json(v, 1000, "viewport")


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
    planning_rows: list[SnapPlanningRow] | None = Field(default=None, max_length=50000)  # absent in older exports: then pipeline_items/week_objectives are read
    habits: list[SnapHabit] = _cap(500)
    item_overlays: list[SnapOverlay] = _cap(20000)
    compass: SnapCompass | None = None  # absent or null in older exports: the account's Compass stays as it is
    persona_streams: list[SnapPersonaStream] = _cap(100)
    boards: list[SnapBoard] | None = Field(default=None, max_length=50)  # absent in older exports: the account's boards stay as they are

    @field_validator("version")
    @classmethod
    def _version(cls, v):
        if v != 1:
            raise ValueError("this server reads export format version 1")
        return v
