from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services import api_tokens

router = APIRouter(prefix="/tokens", tags=["tokens"])


class TokenIn(BaseModel):
    name: str


class TokenOut(BaseModel):
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None

    model_config = {"from_attributes": True}


class TokenCreated(TokenOut):
    token: str  # shown once


# These endpoints use get_current_user, which only understands a login: a token can never mint or list tokens.
@router.get("", response_model=list[TokenOut])
async def list_tokens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await api_tokens.list_active(db, user.id)


@router.post("", response_model=TokenCreated, status_code=201)
async def create_token(data: TokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        row, raw = await api_tokens.create(db, user.id, data.name)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    await db.commit()
    return TokenCreated(id=row.id, name=row.name, prefix=row.prefix, created_at=row.created_at, last_used_at=None, token=raw)


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not await api_tokens.revoke(db, user.id, token_id):
        raise HTTPException(status_code=404, detail="no such token")
    await db.commit()
