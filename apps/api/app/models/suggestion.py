"""Suggestions: a bundle of proposed changes to the plan that the owner reads, picks from, applies and can undo."""
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SuggestionBundle(Base):
    """One proposal: a title, the reason for it and its lines (SuggestionChange). Nothing in it changes the plan until it is applied."""
    __tablename__ = "suggestion_bundles"
    __table_args__ = (Index("ix_suggestion_bundles_user_status", "user_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(80), nullable=False)  # "owner", or the name of the plugin that made it
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # groups bundles made by one run of a source
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending|applied|partly_applied|rejected|undone
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SuggestionChange(Base):
    """One line of a bundle: an operation on one entity (see app/services/suggestions/registry.py)."""
    __tablename__ = "suggestion_changes"
    __table_args__ = (UniqueConstraint("bundle_id", "seq", name="uq_suggestion_change_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bundle_id: Mapped[int] = mapped_column(Integer, ForeignKey("suggestion_bundles.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    op: Mapped[str] = mapped_column(String(16), nullable=False)
    entity: Mapped[str] = mapped_column(String(24), nullable=False)
    target: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    base: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # what the suggester saw; a different value now makes the line stale
    ref: Mapped[str | None] = mapped_column(String(8), nullable=True)  # a create line's label, which later lines can point at
    created_key: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # what apply created, e.g. {"id": 41}
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")  # pending|applied|skipped|stale|failed|undone
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    inverse: Mapped[list | None] = mapped_column(JSON, nullable=True)  # the rows apply changed, before and after: what undo restores
