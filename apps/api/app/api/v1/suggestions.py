"""Suggestions: bundles of proposed plan changes the signed-in user reads, picks from, applies and can undo.

Logins only (no API token). Each change goes through the same services the screens use (app/services/suggestions)."""
from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.vault import _local_now
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.suggestion import SuggestionBundle, SuggestionChange
from app.models.user import User
from app.schemas.suggestion import ApplyIn, SuggestionIn, SuggestionList, SuggestionOut, SuggestionSummary
from app.services import suggestions as service

router = APIRouter(prefix="/suggestions", tags=["suggestions"])


def _out(bundle: SuggestionBundle, changes: list[SuggestionChange]) -> SuggestionOut:
    decided = bundle.decided_at
    if decided is not None and decided.tzinfo is None:
        decided = decided.replace(tzinfo=timezone.utc)
    undo_until = decided + timedelta(days=service.UNDO_DAYS) if decided and bundle.status in ("applied", "partly_applied") else None
    return SuggestionOut(
        id=bundle.id, source=bundle.source, run_id=bundle.run_id, title=bundle.title, reason=bundle.reason, status=bundle.status,
        created_at=bundle.created_at, decided_at=bundle.decided_at, undo_until=undo_until,
        lines=[{"seq": c.seq, "entity": c.entity, "op": c.op, "target": c.target, "payload": c.payload, "base": c.base, "ref": c.ref,
                "created_key": c.created_key, "status": c.status, "error": c.error} for c in changes])


async def _run(work):
    try:
        return await work()
    except service.NotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except service.Conflict as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except service.SuggestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@router.get("", response_model=SuggestionList)
async def list_suggestions(status: str | None = Query(default=None, pattern="^(pending|applied|partly_applied|rejected|undone)$"),
                           user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await service.list_bundles(db, user.id, status)
    return SuggestionList(pending=await service.pending_count(db, user.id), items=[
        SuggestionSummary(id=b.id, source=b.source, run_id=b.run_id, title=b.title, status=b.status, lines=n,
                          created_at=b.created_at, decided_at=b.decided_at) for b, n in rows])


@router.get("/{suggestion_id}", response_model=SuggestionOut)
async def get_suggestion(suggestion_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _out(*await _run(lambda: service.get(db, user.id, suggestion_id)))


@router.post("", response_model=SuggestionOut, status_code=201)
async def post_suggestion(data: SuggestionIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Write a bundle by hand. Its source is always the signed-in user, whatever the body says."""
    async def work():
        bundle = await service.create_for_owner(db, user.id, data.title, data.reason, [l.model_dump() for l in data.lines],
                                                data.run_id, today=_local_now().date())
        await db.commit()
        return await service.get(db, user.id, bundle.id)

    try:
        return _out(*await _run(work))
    except HTTPException:
        await db.rollback()
        raise


@router.post("/{suggestion_id}/apply", response_model=SuggestionOut)
async def apply_suggestion(suggestion_id: int, data: ApplyIn | None = None, user: User = Depends(get_current_user),
                           db: AsyncSession = Depends(get_db)):
    """Apply the picked lines (all by default) in one transaction. A line whose data changed since is marked stale and skipped;
    an error rolls everything back and marks that line failed."""
    lines = data.lines if data else None
    return _out(*await _run(lambda: service.apply(db, user.id, suggestion_id, lines, today=_local_now().date())))


@router.post("/{suggestion_id}/reject", response_model=SuggestionOut)
async def reject_suggestion(suggestion_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return _out(*await _run(lambda: service.reject(db, user.id, suggestion_id)))


@router.post("/{suggestion_id}/undo", response_model=SuggestionOut)
async def undo_suggestion(suggestion_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Put back what an applied suggestion changed (within 7 days); a line whose rows changed since is left as it is."""
    return _out(*await _run(lambda: service.undo(db, user.id, suggestion_id)))
