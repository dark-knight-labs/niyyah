from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Principle(Base):
    __tablename__ = "principles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    arabic: Mapped[str] = mapped_column(String(100), default="")
    meaning: Mapped[str] = mapped_column(Text, nullable=False)
    verse: Mapped[str | None] = mapped_column(String(200), nullable=True)
    icon: Mapped[str] = mapped_column(String(50), default="heart")
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    user: Mapped["User"] = relationship(back_populates="principles", foreign_keys=[user_id])


from app.models.user import User  # noqa: E402, F401
