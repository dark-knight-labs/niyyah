from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Date, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Persona(Base):
    __tablename__ = "personas"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    arabic_name: Mapped[str] = mapped_column(String(100), default="")
    domain: Mapped[str] = mapped_column(String(200), nullable=False)
    eventually: Mapped[str] = mapped_column(Text, default="")
    icon: Mapped[str] = mapped_column(String(50), default="star")
    color: Mapped[str] = mapped_column(String(7), default="#e11d48")
    one_thing: Mapped[str | None] = mapped_column(Text, nullable=True)
    ritual: Mapped[str | None] = mapped_column(Text, nullable=True)
    guardrail: Mapped[str | None] = mapped_column(Text, nullable=True)
    points: Mapped[dict | None] = mapped_column(JSON, default=list)
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="personas", foreign_keys=[user_id])
    milestones: Mapped[list["Milestone"]] = relationship(back_populates="persona", cascade="all, delete-orphan")
    schedule_blocks: Mapped[list["ScheduleBlock"]] = relationship(back_populates="persona", cascade="all, delete-orphan")


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    persona_id: Mapped[int] = mapped_column(Integer, ForeignKey("personas.id"), nullable=False, index=True)
    target_date: Mapped[datetime | None] = mapped_column(Date, nullable=True)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    persona: Mapped["Persona"] = relationship(back_populates="milestones", foreign_keys=[persona_id])


class ScheduleBlock(Base):
    __tablename__ = "schedule_blocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    persona_id: Mapped[int] = mapped_column(Integer, ForeignKey("personas.id"), nullable=False)
    start_time: Mapped[str] = mapped_column(String(5), nullable=False)  # "HH:MM"
    end_time: Mapped[str] = mapped_column(String(5), nullable=False)
    activity: Mapped[str] = mapped_column(String(200), nullable=False)
    day_type: Mapped[str] = mapped_column(String(10), default="weekday")  # weekday/weekend/daily
    is_prayer_block: Mapped[bool] = mapped_column(Boolean, default=False)
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    persona: Mapped["Persona"] = relationship(back_populates="schedule_blocks", foreign_keys=[persona_id])


from app.models.user import User  # noqa: E402, F401
