from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.compass import Compass
from app.models.user import User
from app.schemas.compass import CompassResponse, CompassUpdate
from app.services import compass as compass_service

router = APIRouter(prefix="/compass", tags=["compass"])


def _view(row: Compass | None) -> CompassResponse:
    if row is None:
        return CompassResponse(mission="", vision="", vision_horizon="", updated_at=None)
    return CompassResponse(mission=row.mission, vision=row.vision, vision_horizon=row.vision_horizon, updated_at=row.updated_at)


@router.get("", response_model=CompassResponse)
async def get_compass(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _view(await compass_service.get(db, user.id))


@router.put("", response_model=CompassResponse)
async def put_compass(body: CompassUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _view(await compass_service.update(db, user.id, body.model_dump(exclude_unset=True)))
