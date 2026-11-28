from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services import device_tokens

router = APIRouter(prefix="/devices/tokens", tags=["devices"])


class DeviceTokenIn(BaseModel):
    name: str


class DeviceTokenOut(BaseModel):
    id: int
    name: str
    prefix: str
    scope: str
    created_at: datetime
    last_used_at: datetime | None = None

    model_config = {"from_attributes": True}


class DeviceTokenCreated(DeviceTokenOut):
    token: str  # shown once


# These endpoints use get_current_user, which only understands a login: no token of any kind can mint, list or revoke device tokens.
@router.get("", response_model=list[DeviceTokenOut])
async def list_device_tokens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await device_tokens.list_active(db, user.id)


@router.post("", response_model=DeviceTokenCreated, status_code=201)
async def create_device_token(data: DeviceTokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        row, raw = await device_tokens.create(db, user.id, data.name)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    await db.commit()
    return DeviceTokenCreated(id=row.id, name=row.name, prefix=row.prefix, scope=row.scope, created_at=row.created_at,
                              last_used_at=None, token=raw)


@router.delete("/{token_id}", status_code=204)
async def revoke_device_token(token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not await device_tokens.revoke(db, user.id, token_id):
        raise HTTPException(status_code=404, detail="no such device token")
    await db.commit()
