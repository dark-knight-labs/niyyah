from fastapi.responses import JSONResponse
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.vault import _known_stream, _local_now
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.board import Board
from app.models.user import User
from app.schemas.board import BoardCreate, BoardOut, BoardSummary, BoardUpdate, OpsIn, OpsResult, PromoteIn, PromoteOut
from app.services import boards as boards_service

router = APIRouter(prefix="/boards", tags=["boards"])


async def owned_board(board_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> Board:
    board = await boards_service.get_board(db, user.id, board_id)
    if board is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return board


@router.get("", response_model=list[BoardSummary])
async def list_boards(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await boards_service.list_boards(db, user.id)


@router.post("", response_model=BoardOut, status_code=201)
async def create_board(body: BoardCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        board = await boards_service.create_board(db, user.id, body.title)
    except boards_service.BoardLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc))
    return await boards_service.board_view(db, board)


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(board: Board = Depends(owned_board), db: AsyncSession = Depends(get_db)):
    return await boards_service.board_view(db, board)


@router.patch("/{board_id}", response_model=BoardOut)
async def patch_board(body: BoardUpdate, board: Board = Depends(owned_board), db: AsyncSession = Depends(get_db)):
    try:
        board = await boards_service.update_board(db, board, body.model_dump(exclude_unset=True))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    return await boards_service.board_view(db, board)


@router.delete("/{board_id}", status_code=204)
async def delete_board(board: Board = Depends(owned_board), db: AsyncSession = Depends(get_db)):
    try:
        await boards_service.delete_board(db, board)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return Response(status_code=204)


@router.post("/{board_id}/ops", response_model=OpsResult)
async def post_ops(body: OpsIn, board: Board = Depends(owned_board), db: AsyncSession = Depends(get_db)):
    """A batch of upserts and deletes in one transaction; per-row last write wins. 422 and 413 refuse the whole batch."""
    try:
        return await boards_service.apply_ops(db, board, body.ops)
    except boards_service.OpsError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail, "bad_ops": exc.bad_ops})
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.post("/{board_id}/nodes/{node_id}/promote", response_model=PromoteOut)
async def promote_node(node_id: str, body: PromoteIn, board: Board = Depends(owned_board), user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Make a thought a Plan item (a pipeline row); the node becomes a live ref to it. All or nothing."""
    today = _local_now().date()
    await _known_stream(db, user, body.stream, today)
    try:
        return await boards_service.promote(db, user.id, board, node_id, body.stream, body.lane, body.checkpoint, today, body.product)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
