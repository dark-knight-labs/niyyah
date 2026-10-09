from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.snapshot import Snapshot
from app.services import planner_import

router = APIRouter(prefix="/import", tags=["import"])


@router.post("")
async def import_data(snapshot: Snapshot, replace: bool = Query(False), user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    """Replace your planner data with an export snapshot (docs/export-format.md). Needs ?replace=true because it overwrites everything.

    Signed-in session only: an API token can read your export but never change anything."""
    if not replace:
        raise HTTPException(status_code=422, detail="Importing replaces all your planner data; send ?replace=true to confirm")
    try:
        counts = await planner_import.import_snapshot(db, user.id, snapshot)
        await db.commit()
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    return {"imported": counts}
