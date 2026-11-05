"""Boards: owner-scoped reads and writes. Every query carries the user id, so another user's board is simply not found."""
from datetime import date, datetime, timezone

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.board import Board, BoardEdge, BoardNode
from app.services import planner_work
from app.schemas.board import DeleteEdgeOp, DeleteNodeOp, NodeIn, Op, UpsertEdgeOp, UpsertNodeOp

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


# --- Ops ---------------------------------------------------------------------------------------------------------

MAX_NODES = 5000
MAX_EDGES = 5000
MAX_OPS = 500

_OP = TypeAdapter(Op)
_NODE_FIELDS = tuple(f for f in NodeIn.model_fields if f != "id")


class OpsError(Exception):
    """A batch that was rejected whole. `bad_ops` are the ids of the offending ops (empty when none is to blame)."""

    def __init__(self, status: int, detail: str, bad_ops: list[str] | None = None):
        super().__init__(detail)
        self.status, self.detail, self.bad_ops = status, detail, bad_ops or []


def _op_id(raw) -> str:
    """The id an op is about, read leniently from the raw dict so a malformed op can still be named."""
    if not isinstance(raw, dict):
        return "?"
    for holder in (raw.get("node"), raw.get("edge"), raw):
        if isinstance(holder, dict) and isinstance(holder.get("id"), str):
            return holder["id"]
    return "?"


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _validate(raw_ops: list) -> list:
    if len(raw_ops) > MAX_OPS:
        raise OpsError(413, f"At most {MAX_OPS} ops per request")
    parsed, bad = [], []
    for raw in raw_ops:
        try:
            parsed.append(_OP.validate_python(raw))
        except ValidationError as exc:
            bad.append(_op_id(raw))
            first = exc.errors()[0]
            reason = f"{'.'.join(str(p) for p in first['loc'])}: {first['msg']}"
    if bad:
        raise OpsError(422, f"Invalid op ({reason})", list(dict.fromkeys(bad)))
    return parsed


def _subtree(nodes: dict[str, BoardNode], root_id: str) -> set[str]:
    children: dict[str, list[str]] = {}
    for n in nodes.values():
        if n.parent_id is not None:
            children.setdefault(n.parent_id, []).append(n.id)
    out, todo = set(), [root_id]
    while todo:
        current = todo.pop()
        if current not in out:
            out.add(current)
            todo.extend(children.get(current, []))
    return out


def _check_tree(nodes: dict[str, BoardNode], touched: dict[str, None]) -> None:
    dangling = [i for i in touched if i in nodes and nodes[i].parent_id is not None and nodes[i].parent_id not in nodes]
    if dangling:
        raise OpsError(422, "A parent does not exist (its branch may have been deleted in another tab)", dangling)
    cyclic = []
    for start in touched:
        seen, current = set(), nodes.get(start)
        while current is not None and current.parent_id is not None:
            if current.id in seen or current.parent_id == start:
                cyclic.append(start)
                break
            seen.add(current.id)
            current = nodes.get(current.parent_id)
    if cyclic:
        raise OpsError(422, "A node cannot be its own ancestor", cyclic)
    owners: dict[str, list[str]] = {}
    for n in nodes.values():
        if n.ref_key is not None:
            owners.setdefault(n.ref_key, []).append(n.id)
    clash = [i for ids in owners.values() if len(ids) > 1 for i in ids if i in touched]
    if clash:
        raise OpsError(422, "Another node on this board already holds that ref_key", clash)


async def _apply(db: AsyncSession, board: Board, ops: list) -> list[str]:
    nodes = {n.id: n for n in (await db.execute(select(BoardNode).where(BoardNode.board_id == board.id))).scalars()}
    edges = {e.id: e for e in (await db.execute(select(BoardEdge).where(BoardEdge.board_id == board.id))).scalars()}
    stale: list[str] = []
    touched: dict[str, None] = {}

    def is_stale(row: BoardNode, base: datetime | None) -> bool:
        return base is not None and _utc(row.updated_at) > _utc(base)

    for op in ops:
        if isinstance(op, UpsertNodeOp):
            row = nodes.get(op.node.id)
            if row is not None and is_stale(row, op.base_updated_at):
                stale.append(row.id)
                continue
            values = op.node.model_dump(include=set(_NODE_FIELDS))
            if row is None:
                row = nodes[op.node.id] = BoardNode(board_id=board.id, id=op.node.id, **values)
                db.add(row)
            else:
                for key, value in values.items():
                    setattr(row, key, value)
            touched[row.id] = None
        elif isinstance(op, DeleteNodeOp):
            row = nodes.get(op.id)
            if row is None:
                continue
            if is_stale(row, op.base_updated_at):
                stale.append(row.id)
                continue
            gone = _subtree(nodes, row.id)
            ends = gone | {nodes[i].ref_key for i in gone if nodes[i].ref_key}
            for i in gone:
                await db.delete(nodes.pop(i))
                touched.pop(i, None)
            for e in [e for e in edges.values() if e.from_id in ends or e.to_id in ends]:
                await db.delete(edges.pop(e.id))
            await db.flush()  # so a later op in this batch may reuse a deleted key
        elif isinstance(op, UpsertEdgeOp):
            values = op.edge.model_dump(exclude={"id"})
            row = edges.get(op.edge.id)
            if row is None:
                row = edges[op.edge.id] = BoardEdge(board_id=board.id, id=op.edge.id, **values)
                db.add(row)
            else:
                for key, value in values.items():
                    setattr(row, key, value)
        elif isinstance(op, DeleteEdgeOp) and op.id in edges:
            await db.delete(edges.pop(op.id))
            await db.flush()

    _check_tree(nodes, touched)
    if len(nodes) > MAX_NODES:
        raise OpsError(413, f"A board holds at most {MAX_NODES} nodes")
    if len(edges) > MAX_EDGES:
        raise OpsError(413, f"A board holds at most {MAX_EDGES} connectors")
    board.revision += 1
    await db.flush()
    return stale


async def apply_ops(db: AsyncSession, board: Board, raw_ops: list) -> dict:
    """One transaction per batch. Each op is a full-row upsert or a delete, so a retried batch changes nothing. A bad batch changes nothing.

    A concurrent batch can create the same new row first (primary-key clash): the batch is retried once, now as an overwrite."""
    ops = _validate(raw_ops)
    board_id = board.id
    for attempt in (1, 2):
        try:
            stale = await _apply(db, board, ops)
            await db.commit()
            return {"revision": board.revision, "bad_ops": [], "stale_ops": stale}
        except OpsError:
            await db.rollback()
            raise
        except IntegrityError:
            await db.rollback()
            if attempt == 2:
                raise OpsError(422, "The batch conflicts with another change", [])
            board = await db.get(Board, board_id)


# --- Promote -----------------------------------------------------------------------------------------------------

async def promote(db: AsyncSession, user_id: int, board: Board, node_id: str, stream: str, lane: str, checkpoint: str | None, today: date) -> dict:
    """Turn a thought into a Plan item, in one transaction: create the pipeline row, set its checkpoint, make the node a ref to it.

    The caller has checked the stream. Raises LookupError for an unknown node and ValueError for input the Plan refuses.
    The vault write helper (`_day_write`) only commits and maps ValueError to 422, which the router does here too."""
    node = (await db.execute(select(BoardNode).where(BoardNode.board_id == board.id, BoardNode.id == node_id))).scalar_one_or_none()
    if node is None:
        raise LookupError("Node not found")
    if node.kind != "mind":
        raise ValueError("Only a thought can become a Plan item")
    if not node.text.strip():
        raise ValueError("The thought is empty")
    created = await planner_work.add_rows(db, user_id, stream, [node.text], lane, today)
    if not created:
        raise ValueError("The thought is empty")
    task = created[0]
    if checkpoint:  # an explicit checkpoint wins over a #month typed in the text
        await planner_work.set_checkpoint(db, user_id, stream, task.id, checkpoint)
    node.kind, node.ref_key, node.text = "ref", f"task:{task.id}", task.text   # the Plan's cleaned title is the last-known one
    board.revision += 1
    await db.commit()
    await db.refresh(node)
    return {"task_id": task.id, "revision": board.revision, "node": node}
