from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services import board_files as svc

# Registered BEFORE the boards router: "/boards/files" must not be read as "/boards/{board_id}".
router = APIRouter(prefix="/boards/files", tags=["board files"])


class FileOut(BaseModel):
    id: str
    name: str
    mime: str
    size: int
    created_at: datetime
    used: bool


class FileList(BaseModel):
    used_bytes: int
    quota_bytes: int
    files: list[FileOut]


@router.post("", response_model=FileOut, status_code=201)
async def upload(request: Request, name: str = Query(default="file", max_length=255), board: int | None = Query(default=None),
                 user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Raw body (not multipart). The Content-Length header is required and checked first; the bytes are counted as they stream in and the
    read stops at the cap, so an oversize body is never held in memory."""
    declared = request.headers.get("content-length")
    if declared is None or not declared.isdigit():
        raise HTTPException(status_code=411, detail="Content-Length is required")
    if int(declared) > svc.MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"A file can be at most {svc.MAX_FILE_BYTES // 1048576} MB")
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > svc.MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"A file can be at most {svc.MAX_FILE_BYTES // 1048576} MB")
        chunks.append(chunk)
    if total == 0:
        raise HTTPException(status_code=422, detail="The file is empty")
    try:
        row = await svc.store(db, user.id, board, name, b"".join(chunks))
    except svc.QuotaExceeded as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc), "used_bytes": exc.used, "quota_bytes": exc.limit})
    return FileOut(id=row.id, name=row.name, mime=row.mime, size=row.size, created_at=row.created_at, used=False)


@router.get("", response_model=FileList)
async def list_files(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await svc.list_files(db, user.id)


@router.get("/{file_id}")
async def download(file_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """The bytes, to their owner only. Hardened: nosniff, a sandboxing CSP, never cached by shared caches; anything that is not a
    sniffed raster image is served as an attachment."""
    row = await svc.get_file(db, user.id, file_id)
    if row is None:
        raise HTTPException(status_code=404, detail="File not found")
    is_image = row.mime in svc.IMAGE_TYPES
    disposition = "inline" if is_image else "attachment"
    safe = row.name.replace('"', "")
    ascii_name = safe.encode("ascii", "ignore").decode() or "file"
    from urllib.parse import quote
    headers = {
        "Content-Disposition": f"{disposition}; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(row.name)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": "private, max-age=3600",
        "Content-Length": str(row.size),
    }
    return Response(content=row.data, media_type=row.mime, headers=headers)


@router.delete("/{file_id}", status_code=204)
async def remove(file_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not await svc.delete_file(db, user.id, file_id):
        raise HTTPException(status_code=404, detail="File not found")
    return Response(status_code=204)
