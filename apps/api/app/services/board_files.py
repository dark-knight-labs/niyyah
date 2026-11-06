"""Uploaded images and files for board nodes. Every query carries the user id: another user's file is simply not found."""
import hashlib
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import undefer

from app.models.board import Board, BoardFile, BoardNode
from app.models.user import User

MAX_FILE_BYTES = 10 * 1024 * 1024        # one file
QUOTA_BYTES = 200 * 1024 * 1024          # all of a user's files
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")


class FileTooLarge(Exception):
    pass


def human(n: int) -> str:
    return f"{n / 1048576:.1f} MB" if n >= 1048576 else f"{n / 1024:.0f} KB" if n >= 10240 else f"{n} B"


class QuotaExceeded(Exception):
    def __init__(self, used: int, limit: int):
        super().__init__(f"You are using {human(used)} of {human(limit)} of file space. Delete files you no longer use in the Files panel (board bar).")
        self.used, self.limit = used, limit


def sniff(head: bytes) -> str | None:
    """The image type by magic bytes (the client's content type is never trusted); None for anything else, which is stored as a plain file."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def clean_name(name: str) -> str:
    base = name.replace("\\", "/").rsplit("/", 1)[-1]
    base = "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"|?*').strip().strip(".")
    return (base or "file")[:255]


async def used_bytes(db: AsyncSession, user_id: int) -> int:
    return (await db.execute(select(func.coalesce(func.sum(BoardFile.size), 0)).where(BoardFile.user_id == user_id))).scalar_one()


async def store(db: AsyncSession, user_id: int, board_id: int | None, name: str, content: bytes) -> BoardFile:
    if len(content) > MAX_FILE_BYTES:
        raise FileTooLarge()
    # Serialise this user's uploads (a row lock on PostgreSQL; a no-op on SQLite, which has one writer): two at once cannot both pass the quota check.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update())
    used = await used_bytes(db, user_id)
    if used + len(content) > QUOTA_BYTES:
        raise QuotaExceeded(used, QUOTA_BYTES)
    mime = sniff(content[:16]) or "application/octet-stream"
    row = BoardFile(id=str(uuid.uuid4()), user_id=user_id, board_id=board_id, name=clean_name(name), mime=mime, size=len(content),
                    sha256=hashlib.sha256(content).hexdigest(), data=content)
    db.add(row)
    await db.commit()
    await db.refresh(row, attribute_names=["created_at"])
    return row


async def referenced_ids(db: AsyncSession, user_id: int) -> set[str]:
    """file ids named by the style of the user's image and file nodes (a small set: only those two kinds are read)."""
    rows = (await db.execute(select(BoardNode.style).join(Board, Board.id == BoardNode.board_id)
                             .where(Board.user_id == user_id, BoardNode.kind.in_(("image", "file"))))).scalars().all()
    return {s.get("file_id") for s in rows if isinstance(s, dict) and isinstance(s.get("file_id"), str)}


async def list_files(db: AsyncSession, user_id: int) -> dict:
    """Metadata only: the bytes column is deferred and never touched here."""
    rows = (await db.execute(select(BoardFile).where(BoardFile.user_id == user_id).order_by(BoardFile.created_at.desc(), BoardFile.id))).scalars().all()
    used = await referenced_ids(db, user_id)
    return {"used_bytes": sum(r.size for r in rows), "quota_bytes": QUOTA_BYTES,
            "files": [{"id": r.id, "name": r.name, "mime": r.mime, "size": r.size, "created_at": r.created_at, "used": r.id in used} for r in rows]}


async def get_file(db: AsyncSession, user_id: int, file_id: str) -> BoardFile | None:
    """One file with its bytes (the only query that loads the deferred column)."""
    return (await db.execute(select(BoardFile).options(undefer(BoardFile.data)).where(BoardFile.id == file_id, BoardFile.user_id == user_id))).scalar_one_or_none()


async def delete_file(db: AsyncSession, user_id: int, file_id: str) -> bool:
    res = await db.execute(delete(BoardFile).where(BoardFile.id == file_id, BoardFile.user_id == user_id))
    await db.commit()
    return bool(res.rowcount)
