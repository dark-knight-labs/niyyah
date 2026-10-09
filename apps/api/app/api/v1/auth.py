from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth import (
    authenticate_user,
    create_tokens,
    refresh_tokens,
    register_user,
    revoke_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if settings.registration != "open":
        raise HTTPException(status_code=403, detail="Registration is closed on this installation")
    ratelimit.enforce(f"register:{ratelimit.client_ip(request)}", 10, 3600)
    from sqlalchemy import select
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = await register_user(db, body.email, body.password, body.timezone)
    return await create_tokens(db, user)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ratelimit.enforce(f"login:ip:{ratelimit.client_ip(request)}", 20, 60)
    ratelimit.enforce(f"login:email:{body.email.lower()}", 8, 60)
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return await create_tokens(db, user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)):
    ratelimit.enforce(f"refresh:{ratelimit.client_ip(request)}", 60, 60)
    tokens = await refresh_tokens(db, body.refresh_token)
    if not tokens:
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    return tokens


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    await revoke_refresh_token(db, body.refresh_token)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)):
    return user
