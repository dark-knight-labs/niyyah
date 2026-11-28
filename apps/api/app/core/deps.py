from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User
from app.services import api_tokens, device_tokens

bearer_scheme = HTTPBearer()

DEVICE_LIMIT = 60  # requests per minute per device token; counted in this process, so the ceiling is 60 x the number of api pods
DEVICE_WINDOW = 60


def _refuse_device_token(raw: str) -> None:
    """A device token opens two routes (get_capture_user) and nothing else: anywhere else it is a 403, never a login."""
    if raw.startswith(device_tokens.PREFIX):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="A device token cannot be used here")


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    _refuse_device_token(credentials.credentials)
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


optional_bearer = HTTPBearer(auto_error=False)


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """The signed-in user, or None when the request carries no valid token (for pages that are public in vault mode)."""
    if credentials is None:
        return None
    _refuse_device_token(credentials.credentials)
    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        return None
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def get_export_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """A login or an API token. Only the export endpoint uses this; every other endpoint accepts logins only."""
    if credentials.credentials.startswith(api_tokens.PREFIX):
        user = await api_tokens.user_for_token(db, credentials.credentials)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user
    return await get_current_user(credentials, db)


async def get_capture_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """A login or a device token (nyd_), rate limited per device token. Only POST /vault/items and GET /capture/options use
    this. An export token (nyt_) is not a login, so it fails here with 401."""
    raw = credentials.credentials
    if raw.startswith(device_tokens.PREFIX):
        found = await device_tokens.authenticate(db, raw)
        if found is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user, row = found
        ratelimit.enforce(f"device:{row.id}", DEVICE_LIMIT, DEVICE_WINDOW)
        request.state.device_token_id = row.id  # lets a route scope a capture's client_id to this device
        return user
    return await get_current_user(credentials, db)
