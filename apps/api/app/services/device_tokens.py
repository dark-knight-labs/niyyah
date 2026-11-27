"""Device tokens for capture clients. The raw value is returned once, at creation; afterwards only its SHA-256 is known.

A device token is accepted on exactly two routes (see app.core.deps.get_capture_user); every other route refuses it with 403."""
import hmac
import secrets
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.models.planner import Task
from app.models.user import DeviceCapture, DeviceToken, User

PREFIX = "nyd_"
SCOPE = "capture"
MAX_TOKENS = 10


async def list_active(db: AsyncSession, user_id: int) -> list[DeviceToken]:
    rows = await db.execute(select(DeviceToken).where(DeviceToken.user_id == user_id, DeviceToken.revoked_at.is_(None)).order_by(DeviceToken.id))
    return list(rows.scalars().all())


async def create(db: AsyncSession, user_id: int, name: str) -> tuple[DeviceToken, str]:
    name = " ".join(name.split())
    if not 1 <= len(name) <= 80:
        raise ValueError("a device token needs a name of 1 to 80 characters")
    if len(await list_active(db, user_id)) >= MAX_TOKENS:
        raise ValueError(f"at most {MAX_TOKENS} device tokens; revoke one first")
    raw = PREFIX + secrets.token_urlsafe(32)  # 32 random bytes, base64url
    row = DeviceToken(user_id=user_id, name=name, prefix=raw[:8], token_hash=hash_token(raw), scope=SCOPE)
    db.add(row)
    await db.flush()
    return row, raw


async def revoke(db: AsyncSession, user_id: int, token_id: int) -> bool:
    row = (await db.execute(select(DeviceToken).where(
        DeviceToken.id == token_id, DeviceToken.user_id == user_id, DeviceToken.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    return True


async def authenticate(db: AsyncSession, raw: str) -> tuple[User, DeviceToken] | None:
    """The owner and the row of a live capture token, or None. Records the use."""
    digest = hash_token(raw)
    row = (await db.execute(select(DeviceToken).where(DeviceToken.token_hash == digest))).scalar_one_or_none()
    # The lookup is by hash, so a timing difference reveals nothing about the token; the constant-time compare is the
    # explicit check that what matched is what was sent.
    if row is None or not hmac.compare_digest(row.token_hash, digest) or row.revoked_at is not None or row.scope != SCOPE:
        return None
    user = (await db.execute(select(User).where(User.id == row.user_id, User.is_active.is_(True)))).scalar_one_or_none()
    if user is None:
        return None
    row.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return user, row


async def captured_task(db: AsyncSession, user_id: int, token_id: int, client_id: str) -> Task | None:
    """The task this device already created for `client_id`, or None. A mapping whose task was deleted since is dropped."""
    link = (await db.execute(select(DeviceCapture).where(
        DeviceCapture.device_token_id == token_id, DeviceCapture.client_id == client_id))).scalar_one_or_none()
    if link is None:
        return None
    task = (await db.execute(select(Task).where(Task.id == link.task_id, Task.user_id == user_id))).scalar_one_or_none()
    if task is None:
        await db.execute(delete(DeviceCapture).where(DeviceCapture.id == link.id))
        await db.commit()
    return task


def remember_capture(db: AsyncSession, token_id: int, client_id: str, task_id: int) -> None:
    """Record, in the caller's transaction, that `client_id` made `task_id`. The unique key is (token, client_id)."""
    db.add(DeviceCapture(device_token_id=token_id, client_id=client_id, task_id=task_id))
