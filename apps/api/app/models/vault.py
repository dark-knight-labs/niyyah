from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VaultDay(Base):
    __tablename__ = "vault_days"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    possible: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    focus: Mapped[str | None] = mapped_column(Text, nullable=True)
    log: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    block_votes: Mapped[list["VaultBlockVote"]] = relationship(back_populates="day", cascade="all, delete-orphan")


class VaultBlockVote(Base):
    __tablename__ = "vault_block_votes"
    __table_args__ = (UniqueConstraint("vault_day_id", "block"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_day_id: Mapped[int] = mapped_column(Integer, ForeignKey("vault_days.id"), nullable=False, index=True)
    block: Mapped[str] = mapped_column(String(20), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)

    day: Mapped["VaultDay"] = relationship(back_populates="block_votes", foreign_keys=[vault_day_id])
