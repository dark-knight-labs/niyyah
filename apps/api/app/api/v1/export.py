from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_export_user
from app.models.user import User
from app.services import planner_export

router = APIRouter(prefix="/export", tags=["export"])


@router.get("")
async def export(request: Request, user: User = Depends(get_export_user), db: AsyncSession = Depends(get_db)):
    """Everything one user has in Niyyah, as JSON (see docs/export-format.md). Send If-None-Match to poll cheaply."""
    if settings.storage_backend != "db":
        raise HTTPException(status_code=409, detail="Export needs STORAGE_BACKEND=db")
    snapshot = await planner_export.build_snapshot(db, user)
    tag = planner_export.etag_for(snapshot)
    headers = {"ETag": tag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(snapshot, headers=headers)
