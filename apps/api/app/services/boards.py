"""Boards: owner-scoped reads and writes. Every query carries the user id, so another user's board is simply not found."""
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.board import Board, BoardEdge, BoardNode

LIFE_TITLE = "Life"


async def get_board(db: AsyncSession, user_id: int, board_id: int) -> Board | None:
    return (await db.execute(select(Board).where(Board.id == board_id, Board.user_id == user_id))).scalar_one_or_none()


async def ensure_life(db: AsyncSession, user_id: int) -> None:
    """Create the Life board if missing. INSERT .. ON CONFLICT DO NOTHING on the one-life-per-user index, so two first opens at once make one row."""
    exists = (await db.execute(select(Board.id).where(Board.user_id == user_id, Board.kind == "life"))).first()
    if exists:
        return
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    await db.execute(insert(Board).values(user_id=user_id, title=LIFE_TITLE, kind="life", viewport={}, revision=0).on_conflict_do_nothing())
    await db.commit()


async def list_boards(db: AsyncSession, user_id: int) -> list[dict]:
    await ensure_life(db, user_id)
    boards = (await db.execute(select(Board).where(Board.user_id == user_id).order_by(Board.kind.desc(), Board.id))).scalars().all()
    ids = [b.id for b in boards]
    nodes = dict((await db.execute(select(BoardNode.board_id, func.count()).where(BoardNode.board_id.in_(ids)).group_by(BoardNode.board_id))).all())
    edges = dict((await db.execute(select(BoardEdge.board_id, func.count()).where(BoardEdge.board_id.in_(ids)).group_by(BoardEdge.board_id))).all())
    return [{"id": b.id, "title": b.title, "kind": b.kind, "revision": b.revision, "updated_at": b.updated_at,
             "counts": {"nodes": nodes.get(b.id, 0), "edges": edges.get(b.id, 0)}} for b in boards]


async def create_board(db: AsyncSession, user_id: int, title: str) -> Board:
    board = Board(user_id=user_id, title=title, kind="free", viewport={}, revision=0)
    db.add(board)
    await db.commit()
    await db.refresh(board)
    return board


async def board_view(db: AsyncSession, board: Board) -> dict:
    nodes = (await db.execute(select(BoardNode).where(BoardNode.board_id == board.id).order_by(BoardNode.position, BoardNode.id))).scalars().all()
    edges = (await db.execute(select(BoardEdge).where(BoardEdge.board_id == board.id).order_by(BoardEdge.id))).scalars().all()
    return {"id": board.id, "title": board.title, "kind": board.kind, "viewport": board.viewport, "revision": board.revision,
            "nodes": nodes, "edges": edges}


async def update_board(db: AsyncSession, board: Board, changes: dict) -> Board:
    """Title and viewport. The Life board keeps its title (view state is still saved)."""
    title = changes.get("title")
    if title is not None and title != board.title:
        if board.kind == "life":
            raise ValueError("The Life board cannot be renamed")
        board.title = title
    if changes.get("viewport") is not None:
        board.viewport = changes["viewport"]
    await db.commit()
    await db.refresh(board)
    return board


async def delete_board(db: AsyncSession, board: Board) -> None:
    if board.kind == "life":
        raise ValueError("The Life board cannot be deleted")
    # Children first: SQLite does not enforce ON DELETE CASCADE unless foreign keys are switched on.
    await db.execute(delete(BoardEdge).where(BoardEdge.board_id == board.id))
    await db.execute(delete(BoardNode).where(BoardNode.board_id == board.id))
    await db.delete(board)
    await db.commit()
