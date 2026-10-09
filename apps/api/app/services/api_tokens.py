"""Read-only API tokens. The raw value is returned once, at creation; afterwards only its SHA-256 is known."""
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.models.user import ApiToken, User

PREFIX = "nyt_"
MAX_TOKENS = 10


async def list_active(db: AsyncSession, user_id: int) -> list[ApiToken]:
    rows = await db.execute(select(ApiToken).where(ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None)).order_by(ApiToken.id))
    return list(rows.scalars().all())


async def create(db: AsyncSession, user_id: int, name: str) -> tuple[ApiToken, str]:
    name = " ".join(name.split())
    if not 1 <= len(name) <= 80:
        raise ValueError("a token needs a name of 1 to 80 characters")
    if len(await list_active(db, user_id)) >= MAX_TOKENS:
        raise ValueError(f"at most {MAX_TOKENS} tokens; revoke one first")
    raw = PREFIX + secrets.token_urlsafe(32)
    row = ApiToken(user_id=user_id, name=name, prefix=raw[:8], token_hash=hash_token(raw))
    db.add(row)
    await db.flush()
    return row, raw


async def revoke(db: AsyncSession, user_id: int, token_id: int) -> bool:
    row = (await db.execute(select(ApiToken).where(
        ApiToken.id == token_id, ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    return True


async def user_for_token(db: AsyncSession, raw: str) -> User | None:
    """The owner of a live token, or None. Records the use."""
    row = (await db.execute(select(ApiToken).where(
        ApiToken.token_hash == hash_token(raw), ApiToken.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        return None
    row.last_used_at = datetime.now(timezone.utc)
    user = (await db.execute(select(User).where(User.id == row.user_id, User.is_active.is_(True)))).scalar_one_or_none()
    await db.commit()
    return user
