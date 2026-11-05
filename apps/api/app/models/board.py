from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, func, Index, Integer, String, Text, text as sql_text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Board(Base):
    """A canvas of thoughts and live Plan nodes. Kind `life` is the one board per user whose plan tree is derived from Plan."""
    __tablename__ = "boards"
    __table_args__ = (Index("uq_board_life_per_user", "user_id", unique=True,
                            postgresql_where=sql_text("kind = 'life'"), sqlite_where=sql_text("kind = 'life'")),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="free", server_default="free")  # life | free
    viewport: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")  # bumps per ops batch: change detection only
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=func.now())


class BoardNode(Base):
    """One object on a board. (board_id, id) is the key: the id is a client UUID, so two boards never clash."""
    __tablename__ = "board_nodes"
    __table_args__ = (Index("uq_board_node_ref", "board_id", "ref_key", unique=True,
                            postgresql_where=sql_text("ref_key IS NOT NULL"), sqlite_where=sql_text("ref_key IS NOT NULL")),)

    board_id: Mapped[int] = mapped_column(Integer, ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)  # mind | ref | sticky | text | shape | frame
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)  # another node of the mind tree; no FK, the service checks it per batch
    parent_key: Mapped[str | None] = mapped_column(String(80), nullable=True)  # a derived Life key this thought hangs under
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    x: Mapped[float | None] = mapped_column(Float, nullable=True)
    y: Mapped[float | None] = mapped_column(Float, nullable=True)
    w: Mapped[float | None] = mapped_column(Float, nullable=True)
    h: Mapped[float | None] = mapped_column(Float, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    style: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
    collapsed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=sql_text("false"))
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=sql_text("false"))
    ref_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    frame_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, server_default=func.now())


class BoardEdge(Base):
    """A connector. Its ends are node ids or derived Life keys, hence no FK on them."""
    __tablename__ = "board_edges"

    board_id: Mapped[int] = mapped_column(Integer, ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True)
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    from_id: Mapped[str] = mapped_column(String(80), nullable=False)
    to_id: Mapped[str] = mapped_column(String(80), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False, default="", server_default="")
    style: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict, server_default="{}")
