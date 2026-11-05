"""Boards in the export file, and keeping their `task:<id>` links right when an import renumbers the Plan's rows.

Import rebuilds planner_tasks without keeping row ids, so a board that links `task:12` would point at the wrong item (or none).
Ids are matched by content: a (text, stream, lane) that occurs exactly once on both sides is the same item; anything ambiguous or
unmatched keeps its key and shows under "Unplaced" on the Life board rather than being linked to a guess.
"""
import re
from collections import Counter

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.board import Board, BoardEdge, BoardNode
from app.schemas.snapshot import SnapBoard

MAX_NODES = 5000
MAX_EDGES = 5000
TASK_KEY = re.compile(r"^task:(\d+)$")
NODE_COLUMNS = ("id", "kind", "parent_id", "parent_key", "position", "x", "y", "w", "h", "text", "style", "collapsed", "hidden", "ref_key", "frame_id")


async def export_boards(db: AsyncSession, user_id: int) -> list[dict]:
    boards = (await db.execute(select(Board).where(Board.user_id == user_id).order_by(Board.kind.desc(), Board.id))).scalars().all()
    out = []
    for b in boards:
        nodes = (await db.execute(select(BoardNode).where(BoardNode.board_id == b.id).order_by(BoardNode.position, BoardNode.id))).scalars().all()
        edges = (await db.execute(select(BoardEdge).where(BoardEdge.board_id == b.id).order_by(BoardEdge.id))).scalars().all()
        out.append({"title": b.title, "kind": b.kind, "viewport": dict(b.viewport or {}),
                    "nodes": [{c: getattr(n, c) for c in NODE_COLUMNS} for n in nodes],
                    "edges": [{"id": e.id, "from_id": e.from_id, "to_id": e.to_id, "label": e.label, "style": dict(e.style or {})} for e in edges]})
    return out


def content_map(old_rows: list[tuple], new_rows: list[tuple]) -> dict[int, int]:
    """{old id: new id} for rows (id, text, stream, lane) whose (text, stream, lane) appears exactly once on each side."""
    old_count = Counter(r[1:] for r in old_rows)
    new_count = Counter(r[1:] for r in new_rows)
    new_id = {r[1:]: r[0] for r in new_rows}
    return {r[0]: new_id[r[1:]] for r in old_rows if old_count[r[1:]] == 1 and new_count[r[1:]] == 1}


def _key(value: str | None, mapping: dict[int, int]) -> str | None:
    m = TASK_KEY.match(value) if value else None
    return f"task:{mapping[int(m.group(1))]}" if m and int(m.group(1)) in mapping else value


async def remap_task_keys(db: AsyncSession | None, nodes: list[BoardNode], edges: list[BoardEdge], mapping: dict[int, int]) -> list[BoardNode]:
    """Rewrite `task:<old>` to `task:<new>` in ref_key, parent_key and edge ends of one board. Returns the nodes dropped by a merge.

    When a remapped key lands on a key another node already holds, the two are one item: the existing node stays, takes the
    remapped one's collapsed/hidden state, and children and edges of the dropped node move to it.
    With a session (rows already stored) the keys change in two steps, because 1->2 and 2->3 at once would clash on the unique
    (board_id, ref_key) index for a moment. Without one (rows not yet added) they are just assigned."""
    if not mapping:
        return []
    original = {n.id: n.ref_key for n in nodes}
    final = {n.id: _key(n.ref_key, mapping) for n in nodes}
    holders: dict[str, list[BoardNode]] = {}
    for n in nodes:
        if final[n.id] is not None:
            holders.setdefault(final[n.id], []).append(n)
    dropped: list[BoardNode] = []
    into: dict[str, str] = {}
    for group in holders.values():
        if len(group) > 1:
            kept = [n for n in group if final[n.id] == original[n.id]]
            survivor = kept[0] if kept else group[0]
            for n in group:
                if n is survivor:
                    continue
                if final[n.id] != original[n.id]:
                    survivor.collapsed, survivor.hidden = n.collapsed, n.hidden
                into[n.id] = survivor.id
                dropped.append(n)
    for n in nodes:
        if n.parent_id in into:
            n.parent_id = into[n.parent_id]
        n.parent_key = _key(n.parent_key, mapping)
    for e in edges:
        e.from_id, e.to_id = into.get(e.from_id, e.from_id), into.get(e.to_id, e.to_id)
        e.from_id, e.to_id = _key(e.from_id, mapping) or e.from_id, _key(e.to_id, mapping) or e.to_id
    gone = {n.id for n in dropped}
    moving = [n for n in nodes if n.id not in gone and final[n.id] != original[n.id]]
    if db is not None:
        for n in moving:
            n.ref_key = f"~{n.id}"
        for n in dropped:
            await db.delete(n)
        await db.flush()
    for n in moving:
        n.ref_key = final[n.id]
    return dropped


async def remap_existing(db: AsyncSession, user_id: int, mapping: dict[int, int]) -> None:
    """Remap the links of every stored board of the user (an import whose file has no boards)."""
    if not mapping:
        return
    for board in (await db.execute(select(Board).where(Board.user_id == user_id))).scalars().all():
        nodes = list((await db.execute(select(BoardNode).where(BoardNode.board_id == board.id))).scalars())
        edges = list((await db.execute(select(BoardEdge).where(BoardEdge.board_id == board.id))).scalars())
        await remap_task_keys(db, nodes, edges, mapping)
        board.revision += 1   # an open tab reloads
    await db.flush()


def check_boards(boards: list[SnapBoard]) -> None:
    """Refuse a file whose boards the API itself would not store. Raises BoardLimitError (413) or ValueError (422)."""
    for b in boards:
        if len(b.nodes) > MAX_NODES:
            raise BoardLimitError(f"Board '{b.title}' has {len(b.nodes)} nodes; a board holds at most {MAX_NODES}")
        if len(b.edges) > MAX_EDGES:
            raise BoardLimitError(f"Board '{b.title}' has {len(b.edges)} connectors; a board holds at most {MAX_EDGES}")
        ids = [n.id for n in b.nodes]
        if len(ids) != len(set(ids)):
            raise ValueError(f"A node id appears twice in board '{b.title}'")
        if len({e.id for e in b.edges}) != len(b.edges):
            raise ValueError(f"A connector id appears twice in board '{b.title}'")
        keys = [n.ref_key for n in b.nodes if n.ref_key]
        if len(keys) != len(set(keys)):
            raise ValueError(f"A ref_key appears twice in board '{b.title}'")
        parent = {n.id: n.parent_id for n in b.nodes}
        for n in b.nodes:
            if n.parent_id is not None and n.parent_id not in parent:
                raise ValueError(f"Node '{n.id}' of board '{b.title}' has a parent that is not on the board")
        for start in parent:
            seen, current = set(), start
            while parent.get(current) is not None:
                if current in seen:
                    raise ValueError(f"Board '{b.title}' has a parent loop at '{start}'")
                seen.add(current)
                current = parent[current]


class BoardLimitError(ValueError):
    """A board in the file is over the limits; the route answers 413."""


async def replace_boards(db: AsyncSession, user_id: int, boards: list[SnapBoard], mapping: dict[int, int]) -> None:
    """Replace the user's boards with the file's. Board ids are new; node and edge ids are kept. `mapping` is file task id -> new task id.

    One life board at most: a second one in the file becomes a free board."""
    check_boards(boards)
    owned = select(Board.id).where(Board.user_id == user_id)
    await db.execute(delete(BoardEdge).where(BoardEdge.board_id.in_(owned)))
    await db.execute(delete(BoardNode).where(BoardNode.board_id.in_(owned)))
    await db.execute(delete(Board).where(Board.user_id == user_id))
    await db.flush()
    life_taken = False
    for b in boards:
        kind = "life" if b.kind == "life" and not life_taken else "free"
        life_taken = life_taken or kind == "life"
        row = Board(user_id=user_id, title="Life" if kind == "life" else b.title, kind=kind, viewport=b.viewport, revision=0)
        db.add(row)
        await db.flush()
        nodes = [BoardNode(board_id=row.id, **n.model_dump(include=set(NODE_COLUMNS))) for n in b.nodes]
        edges = [BoardEdge(board_id=row.id, **e.model_dump()) for e in b.edges]
        dropped = await remap_task_keys(None, nodes, edges, mapping)
        gone = {id(n) for n in dropped}
        db.add_all([n for n in nodes if id(n) not in gone])
        db.add_all(edges)
        await db.flush()
