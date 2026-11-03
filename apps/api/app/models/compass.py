from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, func, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Compass(Base):
    """A user's mission and vision. One row per user, created on the first save."""
    __tablename__ = "compass"
    __table_args__ = (UniqueConstraint("user_id", name="uq_compass_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    mission: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    vision: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    vision_horizon: Mapped[str] = mapped_column(String(10), nullable=False, default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
