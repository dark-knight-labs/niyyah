from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.persona import Persona, ScheduleBlock
from app.models.user import User
from app.schemas.schedule import ScheduleBlockCreate, ScheduleBlockResponse, ScheduleBlockUpdate

router = APIRouter(prefix="/schedule", tags=["schedule"])


@router.get("", response_model=list[ScheduleBlockResponse])
async def list_blocks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ScheduleBlock).where(ScheduleBlock.user_id == user.id).order_by(ScheduleBlock.start_time)
    )
    return result.scalars().all()


@router.post("", response_model=ScheduleBlockResponse, status_code=status.HTTP_201_CREATED)
async def create_block(body: ScheduleBlockCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Verify persona ownership
    result = await db.execute(select(Persona).where(Persona.id == body.persona_id, Persona.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Persona not found")

    count_result = await db.execute(select(ScheduleBlock).where(ScheduleBlock.user_id == user.id))
    count = len(count_result.scalars().all())
    if user.subscription_tier == "free" and count >= 10:
        raise HTTPException(status_code=403, detail="Free tier limited to 10 schedule blocks")

    block = ScheduleBlock(user_id=user.id, order=count, **body.model_dump())
    db.add(block)
    await db.commit()
    await db.refresh(block)
    return block


@router.patch("/{block_id}", response_model=ScheduleBlockResponse)
async def update_block(block_id: int, body: ScheduleBlockUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScheduleBlock).where(ScheduleBlock.id == block_id, ScheduleBlock.user_id == user.id))
    block = result.scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(block, k, v)
    await db.commit()
    await db.refresh(block)
    return block


@router.delete("/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_block(block_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ScheduleBlock).where(ScheduleBlock.id == block_id, ScheduleBlock.user_id == user.id))
    block = result.scalar_one_or_none()
    if not block:
        raise HTTPException(status_code=404, detail="Block not found")
    await db.delete(block)
    await db.commit()
