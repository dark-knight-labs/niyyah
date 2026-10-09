from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.user import RefreshToken, User, UserSettings


async def register_user(db: AsyncSession, email: str, password: str, tz: str = "UTC") -> User:
    user = User(email=email, password_hash=hash_password(password), timezone=tz)
    db.add(user)
    await db.flush()
    db.add(UserSettings(user_id=user.id))
    from app.services.planner_config import seed_new_user  # a new account starts from the starter template
    await seed_new_user(db, user.id)
    await db.commit()
    await db.refresh(user)
    return user


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user and verify_password(password, user.password_hash):
        return user
    return None


async def create_tokens(db: AsyncSession, user: User) -> dict:
    access_token = create_access_token(user.id)
    raw_refresh = create_refresh_token()
    expires = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    rt = RefreshToken(user_id=user.id, token_hash=hash_token(raw_refresh), expires_at=expires)
    db.add(rt)
    await db.commit()
    return {"access_token": access_token, "token_type": "bearer", "refresh_token": raw_refresh}


async def refresh_tokens(db: AsyncSession, raw_refresh: str) -> dict | None:
    hashed = hash_token(raw_refresh)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == hashed,
            RefreshToken.expires_at > datetime.now(timezone.utc),
        )
    )
    rt = result.scalar_one_or_none()
    if not rt:
        return None
    user_result = await db.execute(select(User).where(User.id == rt.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        return None
    # The refresh token is not rotated: several requests refreshing at once (or two tabs) must all succeed,
    # and rotation made the loser of that race sign the owner out. Each use slides its expiry forward.
    rt.expires_at = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    await db.commit()
    return {"access_token": create_access_token(user.id), "token_type": "bearer", "refresh_token": raw_refresh}


async def revoke_refresh_token(db: AsyncSession, raw_refresh: str) -> None:
    hashed = hash_token(raw_refresh)
    await db.execute(delete(RefreshToken).where(RefreshToken.token_hash == hashed))
    await db.commit()
