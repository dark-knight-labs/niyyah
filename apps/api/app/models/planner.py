"""Per-user planner data: what the vault notes hold, as rows. Every table is scoped by user_id."""
import datetime as dt

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, SmallInteger, String, Text, UniqueConstraint
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _owner() -> Mapped[int]:
    return mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


class Task(Base):
    """A task. It shows on a day when that day is its due, scheduled or start date."""
    __tablename__ = "planner_tasks"
    # One row per (user, stream, week) is that week's small domino: a partial index, so most rows (no focus_week) are free.
    __table_args__ = (Index("uq_planner_task_focus", "user_id", "stream", "focus_week", unique=True,
                            postgresql_where=sql_text("focus_week IS NOT NULL"), sqlite_where=sql_text("focus_week IS NOT NULL")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    scheduled_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    start_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    source_path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # the vault note it came from, if imported
    stream: Mapped[str | None] = mapped_column(String(24), nullable=True, index=True)  # the stream it belongs to, if any
    products: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # tags, typed as #word in the text
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)  # details, like a Plan item's
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Item fields. Every one has a database default, so an older image that does not know them can still insert a task.
    start_min: Mapped[int | None] = mapped_column(Integer, nullable=True)  # minutes from midnight on scheduled_on; None = all day
    end_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=sql_text("0"), nullable=False)  # 0-3
    # open | done | skipped. `done` stays the source of truth older code writes: when the two disagree, `done` wins.
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open", nullable=False)
    checklist: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)  # sub-tasks [{"id", "text", "done"}]
    # Planning fields: the stream pipelines and the week objectives live on the same row as the task (docs/export-format.md).
    # All nullable or defaulted, so an older image can still insert a task. A row with a `lane` is a pipeline item; a row with
    # `focus_week` + `objective_text` carries that week's objective; a row with a lane and no day is an undated item.
    lane: Mapped[str | None] = mapped_column(String(10), nullable=True)  # now | next | backlog | done; None = not a pipeline item
    lane_position: Mapped[int | None] = mapped_column(Integer, nullable=True)  # order in the stream's pipeline (the old item position)
    focus_week: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "2026-W45": this row is that week's small domino
    objective_text: Mapped[str | None] = mapped_column(Text, nullable=True)  # the week objective's own text; None = no objective
    objective_done: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    focus_checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)  # the objective's month checkpoint
    checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)  # the item's month checkpoint
    blocked_by: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)  # ext_ids of notebook blockers
    added_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("planner_tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    origin: Mapped[str | None] = mapped_column(String(48), nullable=True)  # 'pipeline:7', 'objective:3': the old row this came from


class EventOverlay(Base):
    """What the user added to one calendar event: status, weight, stream, tags, notes, sub-tasks. Title and time stay the feed's.

    `event_key` names the event across feeds and re-imports: the iCal UID, plus `|<original start>` for one occurrence of a
    repeating event (see calendar_events.event_key). `title`, `day` and `source_calendar` are cached from the last write.
    """
    __tablename__ = "planner_event_overlays"
    __table_args__ = (UniqueConstraint("user_id", "event_key", name="uq_planner_event_overlay_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    event_key: Mapped[str] = mapped_column(String(400), nullable=False)
    source_calendar: Mapped[str] = mapped_column(String(120), default="", server_default="", nullable=False)
    title: Mapped[str] = mapped_column(String(300), default="", server_default="", nullable=False)
    day: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open", server_default="open", nullable=False)
    weight: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=sql_text("0"), nullable=False)
    stream: Mapped[str | None] = mapped_column(String(24), nullable=True)
    products: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="", nullable=False)
    checklist: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)


class LogEntry(Base):
    __tablename__ = "planner_log_entries"
    __table_args__ = (UniqueConstraint("user_id", "day", "position", name="uq_planner_log_user_day_pos"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    day: Mapped[dt.date] = mapped_column(Date, nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class Goal(Base):
    __tablename__ = "planner_goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    value: Mapped[str] = mapped_column(String(400), nullable=False)
    caption: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    progress: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0-100, used when there is no checklist
    checklist: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # [{"id", "text", "done"}]; progress comes from it


class Quarter(Base):
    __tablename__ = "planner_quarters"
    __table_args__ = (UniqueConstraint("user_id", "label", name="uq_planner_quarter_user_label"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    label: Mapped[str] = mapped_column(String(10), nullable=False)  # "2026-Q4"
    starts: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    ends: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    objective: Mapped[str] = mapped_column(Text, default="", nullable=False)
    objective_ar: Mapped[str] = mapped_column(Text, default="", nullable=False)


class QuarterStream(Base):
    """A stream as one quarter defines it: display fields, goal text and month checkpoints."""
    __tablename__ = "planner_quarter_streams"
    __table_args__ = (UniqueConstraint("user_id", "quarter", "slug", name="uq_planner_qstream"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    quarter: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    icon: Mapped[str] = mapped_column(String(30), nullable=False)
    slot: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    weekly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # has a one-line weekly objective
    has_pipeline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # has a quarter goal and a pipeline
    in_note: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)  # False for built-ins the note does not define
    goal: Mapped[str] = mapped_column(Text, default="", nullable=False)  # the checklist's lines joined, kept as a plain summary
    goal_checklist: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # [{"id", "text", "done"}]
    status: Mapped[str] = mapped_column(String(20), default="committed", nullable=False)
    # [{"month": "oct", "text": "<lines joined>", "checklist": [{"id", "text", "done"}]}]
    checkpoints: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class WeekObjective(Base):
    __tablename__ = "planner_week_objectives"
    __table_args__ = (UniqueConstraint("user_id", "week", "stream", name="uq_planner_objective"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    week: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # "2026-W41"
    stream: Mapped[str] = mapped_column(String(24), nullable=False)
    text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)


class PipelineItem(Base):
    __tablename__ = "planner_pipeline_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    stream: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    lane: Mapped[str] = mapped_column(String(10), nullable=False)  # now | next | backlog | done
    text: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    products: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # tags: the parts of the block this belongs to
    checkpoint: Mapped[str | None] = mapped_column(String(3), nullable=True)
    added_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    focus_week: Mapped[str | None] = mapped_column(String(10), nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    blocked_by: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # ext_ids of notebook blockers
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class NotebookEntry(Base):
    __tablename__ = "planner_notebook_entries"
    __table_args__ = (UniqueConstraint("user_id", "stream", "ext_id", name="uq_planner_notebook_ext"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    stream: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    ext_id: Mapped[str] = mapped_column(String(24), nullable=False)  # the id pipeline items use in blocked_by
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # idea | meeting | blocker
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, default="", nullable=False)
    entry_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_open: Mapped[bool | None] = mapped_column(Boolean, nullable=True)  # blockers only
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class PlannerScheduleSetting(Base):
    __tablename__ = "planner_schedule_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    meta: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)  # city, lat, lon, tz, method, madhab


class PlannerScheduleBlock(Base):
    __tablename__ = "planner_schedule_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    day_type: Mapped[str] = mapped_column(String(10), nullable=False)  # weekday | weekend
    block: Mapped[str] = mapped_column(String(20), nullable=False)
    start: Mapped[str] = mapped_column(String(20), nullable=False)  # "06:00" or an anchor like "fajr+10"
    end: Mapped[str] = mapped_column(String(20), nullable=False)
    what: Mapped[str] = mapped_column(Text, default="", nullable=False)
    stream: Mapped[str | None] = mapped_column(String(24), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class PlannerCalendarFeed(Base):
    """An iCal feed (private URL) whose events show on the Overview."""
    __tablename__ = "planner_calendar_feeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # the Google account, to read through its API instead
    position: Mapped[int] = mapped_column(Integer, nullable=False)


class PlannerPin(Base):
    """An event or task the user marked important. `key` says which: "e:<event id or title|day|start>" or "t:<day>|<task text>"."""
    __tablename__ = "planner_pins"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_planner_pins_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    key: Mapped[str] = mapped_column(String(400), nullable=False)


class PlannerBlock(Base):
    """A part of the user's day. Votes and schedule rows refer to it by key; archived blocks stay so history still resolves."""
    __tablename__ = "planner_blocks"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_planner_block_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    key: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    ring_name: Mapped[str] = mapped_column(String(6), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    counts_for_stars: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class PlannerHabit(Base):
    """A small repeating behaviour that lives in a day block, with a life cycle: installing, on rails, retired."""
    __tablename__ = "planner_habits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    block: Mapped[str] = mapped_column(String(20), nullable=False)  # a key of planner_blocks
    anchor: Mapped[str] = mapped_column(String(60), default="", nullable=False)  # the cue: "After Fajr", "Asr to Maghrib"
    per_week: Mapped[int] = mapped_column(Integer, default=7, nullable=False)  # 7 = daily
    minimum: Mapped[str] = mapped_column(String(120), default="", nullable=False)  # the two-minute version
    stage: Mapped[str] = mapped_column(String(10), default="installing", nullable=False)  # installing | rails | retired
    stream: Mapped[str | None] = mapped_column(String(24), nullable=True)  # the goal it serves, if any
    gate_pct: Mapped[int] = mapped_column(Integer, default=80, nullable=False)
    gate_weeks: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    trip_pct: Mapped[int | None] = mapped_column(Integer, nullable=True)  # tripwire: written at demotion
    trip_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    started_on: Mapped[dt.date] = mapped_column(Date, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class PlannerHabitCheck(Base):
    """One habit done (or its minimum) on one day."""
    __tablename__ = "planner_habit_checks"
    __table_args__ = (UniqueConstraint("habit_id", "day"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    habit_id: Mapped[int] = mapped_column(Integer, ForeignKey("planner_habits.id", ondelete="CASCADE"), nullable=False, index=True)
    day: Mapped[dt.date] = mapped_column(Date, nullable=False)
    level: Mapped[str] = mapped_column(String(4), nullable=False)  # done | min


class PlannerArea(Base):
    """A life area (stream) defined once per user. In the shadow phase it is built from the latest quarter that defines the slug."""
    __tablename__ = "planner_areas"
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_planner_area_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    slug: Mapped[str] = mapped_column(String(24), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    icon: Mapped[str] = mapped_column(String(30), nullable=False)
    slot: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    weekly: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    has_pipeline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    in_note: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class PlannerItem(Base):
    """One node of the item tree. Its kind is not stored: app.services.item_rules derives it from period, horizon and parent."""
    __tablename__ = "planner_items"
    __table_args__ = (UniqueConstraint("user_id", "legacy_ref", name="uq_planner_item_legacy_ref"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    area: Mapped[str | None] = mapped_column(String(24), nullable=True)  # the area's slug
    parent_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("planner_items.id", ondelete="CASCADE"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    subtitle: Mapped[str | None] = mapped_column(Text, nullable=True)  # a second line, e.g. the Arabic line of the Super Objective
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    period: Mapped[str | None] = mapped_column(String(10), nullable=True)  # "2026-Q4", "2026-10", "2026-W45"
    horizon: Mapped[str | None] = mapped_column(String(10), nullable=True)  # now | next | someday (work items only)
    status: Mapped[str] = mapped_column(String(10), default="open", nullable=False)  # open | done | dropped
    commitment: Mapped[str | None] = mapped_column(String(20), nullable=True)  # active | committed | paused | archived (quarter goals only)
    day: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    start_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    weight: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=sql_text("0"), nullable=False)
    blocked_by: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    created_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    legacy_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)  # the legacy row this item mirrors, while legacy is authoritative
