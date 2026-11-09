"""A user's mission and vision. One row per user, created by the first save."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.compass import Compass

FIELDS = ("mission", "vision", "vision_horizon")


async def get(db: AsyncSession, user_id: int) -> Compass | None:
    return (await db.execute(select(Compass).where(Compass.user_id == user_id))).scalar_one_or_none()


async def update(db: AsyncSession, user_id: int, changes: dict) -> Compass | None:
    """Apply the given fields (others stay) and return the row; no row is created for an empty change.

    Flushes, never commits (a caller may be part of a bigger change). `save` is the one that commits."""
    row = await get(db, user_id)
    changes = {k: v for k, v in changes.items() if k in FIELDS}
    if not changes:
        return row
    if row is None:
        row = Compass(user_id=user_id)
        db.add(row)
    for key, value in changes.items():
        setattr(row, key, value)
    await db.flush()
    return row


async def save(db: AsyncSession, user_id: int, changes: dict, _retry: bool = True) -> Compass | None:
    """`update` and commit. Two first saves can race on the unique user_id: the loser rolls back and retries once, now as an update."""
    try:
        row = await update(db, user_id, changes)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        if not _retry:
            raise
        return await save(db, user_id, changes, _retry=False)
    if row is not None:
        await db.refresh(row)
    return row
