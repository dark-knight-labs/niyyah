from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.principle import Principle
from app.models.user import User
from app.schemas.principle import PrincipleCreate, PrincipleResponse, PrincipleUpdate

router = APIRouter(prefix="/principles", tags=["principles"])


@router.get("", response_model=list[PrincipleResponse])
async def list_principles(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Principle).where(Principle.user_id == user.id).order_by(Principle.order)
    )
    return result.scalars().all()


@router.post("", response_model=PrincipleResponse, status_code=status.HTTP_201_CREATED)
async def create_principle(body: PrincipleCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count_result = await db.execute(select(Principle).where(Principle.user_id == user.id))
    count = len(count_result.scalars().all())
    principle = Principle(user_id=user.id, order=count, **body.model_dump())
    db.add(principle)
    await db.commit()
    await db.refresh(principle)
    return principle


@router.patch("/{principle_id}", response_model=PrincipleResponse)
async def update_principle(principle_id: int, body: PrincipleUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Principle).where(Principle.id == principle_id, Principle.user_id == user.id))
    principle = result.scalar_one_or_none()
    if not principle:
        raise HTTPException(status_code=404, detail="Principle not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(principle, k, v)
    await db.commit()
    await db.refresh(principle)
    return principle


@router.delete("/{principle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_principle(principle_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Principle).where(Principle.id == principle_id, Principle.user_id == user.id))
    principle = result.scalar_one_or_none()
    if not principle:
        raise HTTPException(status_code=404, detail="Principle not found")
    await db.delete(principle)
    await db.commit()
