"""Per-user planner data: what the vault notes hold, as rows. Every table is scoped by user_id."""
import datetime as dt

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _owner() -> Mapped[int]:
    return mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)


class Task(Base):
    """A task. It shows on a day when that day is its due, scheduled or start date."""
    __tablename__ = "planner_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    scheduled_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    start_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True, index=True)
    done_on: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    source_path: Mapped[str | None] = mapped_column(String(500), nullable=True)  # the vault note it came from, if imported
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


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
    product: Mapped[str | None] = mapped_column(String(100), nullable=True)
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
