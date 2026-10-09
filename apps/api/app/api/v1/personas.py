from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.persona import Milestone, Persona
from app.models.user import User
from app.schemas.persona import (
    MilestoneCreate,
    MilestoneResponse,
    PersonaCreate,
    PersonaResponse,
    PersonaUpdate,
    ReorderRequest,
)

router = APIRouter(prefix="/personas", tags=["personas"])


@router.get("", response_model=list[PersonaResponse])
async def list_personas(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Persona)
        .where(Persona.user_id == user.id)
        .options(selectinload(Persona.milestones))
        .order_by(Persona.order)
    )
    return result.scalars().all()


@router.post("", response_model=PersonaResponse, status_code=status.HTTP_201_CREATED)
async def create_persona(body: PersonaCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    count_result = await db.execute(select(Persona).where(Persona.user_id == user.id))
    count = len(count_result.scalars().all())
    if user.subscription_tier == "free" and count >= 3:
        raise HTTPException(status_code=403, detail="Free tier limited to 3 personas")
    persona = Persona(user_id=user.id, order=count, **body.model_dump())
    db.add(persona)
    await db.commit()
    await db.refresh(persona, ["milestones"])
    return persona


@router.get("/{persona_id}", response_model=PersonaResponse)
async def get_persona(persona_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Persona)
        .where(Persona.id == persona_id, Persona.user_id == user.id)
        .options(selectinload(Persona.milestones))
    )
    persona = result.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    return persona


@router.patch("/{persona_id}", response_model=PersonaResponse)
async def update_persona(persona_id: int, body: PersonaUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Persona).where(Persona.id == persona_id, Persona.user_id == user.id))
    persona = result.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(persona, k, v)
    await db.commit()
    await db.refresh(persona, ["milestones"])
    return persona


@router.delete("/{persona_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_persona(persona_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Persona).where(Persona.id == persona_id, Persona.user_id == user.id))
    persona = result.scalar_one_or_none()
    if not persona:
        raise HTTPException(status_code=404, detail="Persona not found")
    await db.delete(persona)
    await db.commit()


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_personas(body: ReorderRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    for idx, pid in enumerate(body.ids):
        result = await db.execute(select(Persona).where(Persona.id == pid, Persona.user_id == user.id))
        persona = result.scalar_one_or_none()
        if persona:
            persona.order = idx
    await db.commit()


@router.post("/{persona_id}/milestones", response_model=MilestoneResponse, status_code=status.HTTP_201_CREATED)
async def add_milestone(persona_id: int, body: MilestoneCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Persona).where(Persona.id == persona_id, Persona.user_id == user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Persona not found")
    from datetime import date as date_type
    target = None
    if body.target_date:
        try:
            target = date_type.fromisoformat(body.target_date)
        except ValueError:
            target = None
    milestone = Milestone(persona_id=persona_id, goal=body.goal, target_date=target)
    db.add(milestone)
    await db.commit()
    await db.refresh(milestone)
    return milestone


@router.delete("/{persona_id}/milestones/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_milestone(persona_id: int, milestone_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Milestone).join(Persona).where(
            Milestone.id == milestone_id,
            Milestone.persona_id == persona_id,
            Persona.user_id == user.id,
        )
    )
    milestone = result.scalar_one_or_none()
    if not milestone:
        raise HTTPException(status_code=404, detail="Milestone not found")
    await db.delete(milestone)
    await db.commit()
