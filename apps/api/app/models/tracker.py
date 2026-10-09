from datetime import date, datetime, timezone

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class NonNegotiable(Base):
    __tablename__ = "non_negotiables"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(20), default="spiritual")  # spiritual/health/growth
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    user: Mapped["User"] = relationship(back_populates="non_negotiables", foreign_keys=[user_id])
    daily_checks: Mapped[list["DailyCheck"]] = relationship(back_populates="non_negotiable", cascade="all, delete-orphan")
    streak: Mapped["Streak"] = relationship(back_populates="non_negotiable", uselist=False, cascade="all, delete-orphan")


class DailyCheck(Base):
    __tablename__ = "daily_checks"
    __table_args__ = (UniqueConstraint("non_negotiable_id", "check_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    non_negotiable_id: Mapped[int] = mapped_column(Integer, ForeignKey("non_negotiables.id"), nullable=False, index=True)
    check_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_completed: Mapped[bool] = mapped_column(Boolean, default=True)

    non_negotiable: Mapped["NonNegotiable"] = relationship(back_populates="daily_checks", foreign_keys=[non_negotiable_id])


class Streak(Base):
    __tablename__ = "streaks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    non_negotiable_id: Mapped[int] = mapped_column(Integer, ForeignKey("non_negotiables.id"), unique=True, nullable=False)
    current_streak: Mapped[int] = mapped_column(Integer, default=0)
    longest_streak: Mapped[int] = mapped_column(Integer, default=0)
    last_check_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    non_negotiable: Mapped["NonNegotiable"] = relationship(back_populates="streak", foreign_keys=[non_negotiable_id])


from app.models.user import User  # noqa: E402, F401
