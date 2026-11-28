from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.vault import _db_run, _local_now
from app.core.database import get_db
from app.core.deps import get_capture_user
from app.models.user import User
from app.schemas.capture import CaptureTask, CaptureTaskPatch, CaptureTasks
from app.services import capture_tasks, planner_products, planner_store

router = APIRouter(prefix="/capture", tags=["capture"])

_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class CaptureBlock(BaseModel):
    block: str  # the schedule block's key
    start: str  # "HH:MM", or a prayer name such as "fajr"
    end: str
    what: str
    stream: str | None = None  # the stream this slot works on, if any


class CaptureProduct(BaseModel):
    slug: str
    name: str
    block: str  # the planner stores a product's stream under this name: it is a stream slug, not a schedule block key


class CaptureStream(BaseModel):
    slug: str
    name: str


class CaptureOptions(BaseModel):
    blocks: list[CaptureBlock]  # today's schedule in order, so a client can pick the current one
    products: list[CaptureProduct]
    streams: list[CaptureStream]  # this quarter's streams with a pipeline: a task in a lane (now/next/backlog) needs one
    day: str  # "weekday" or "weekend": which schedule `blocks` come from


@router.get("/options", response_model=CaptureOptions)
async def capture_options(user: User = Depends(get_capture_user), db: AsyncSession = Depends(get_db)):
    """What a capture client needs to fill its pickers. Read-only; names and slugs only."""
    now = _local_now()
    sched = await planner_store.schedule(db, user.id)
    weekend = (sched or {}).get("meta", {}).get("weekend_days", ["sat", "sun"])
    day = "weekend" if _DAYS[now.weekday()] in weekend else "weekday"
    blocks = [CaptureBlock(block=r["block"], start=r["start"], end=r["end"], what=r["what"], stream=r["stream"])
              for r in (sched or {}).get("days", {}).get(day, [])]
    products = [CaptureProduct(slug=p.slug, name=p.name, block=p.block) for p in await planner_products.rows_of(db, user.id)]
    streams = [CaptureStream(slug=s.id, name=s.name) for s in await planner_store.streams_for(db, user.id, now.date()) if s.goal and not s.archived]
    return CaptureOptions(blocks=blocks, products=products, streams=streams, day=day)


def _device_token_id(request: Request) -> int:
    """The device token that made this call. The sync routes belong to one device's own tasks, so a login (no device) is refused."""
    token_id = getattr(request.state, "device_token_id", None)
    if token_id is None:
        raise HTTPException(status_code=403, detail="These routes are for device tokens")
    return token_id


@router.get("/tasks", response_model=CaptureTasks)
async def list_capture_tasks(request: Request, include_done: bool = False, limit: int = Query(default=200, ge=1, le=500),
                             user: User = Depends(get_capture_user), db: AsyncSession = Depends(get_db)):
    """The tasks this device created, newest first: open ones, or all with `include_done`. Never another device's or user's."""
    token_id = _device_token_id(request)
    return {"tasks": await capture_tasks.list_for_device(db, user.id, token_id, include_done, limit)}


@router.patch("/tasks/{client_id}", response_model=CaptureTask)
async def patch_capture_task(client_id: UUID, data: CaptureTaskPatch, request: Request,
                             user: User = Depends(get_capture_user), db: AsyncSession = Depends(get_db)):
    """Change the fields sent on the task this device created with `client_id`: done, text, link, deadline_at, tracked_seconds,
    timer_started_at. Sending the same values again changes nothing. 404 when this device has no task for the id."""
    token_id = _device_token_id(request)
    user_id = user.id  # read now: a rollback expires the user object
    fields = data.model_dump(exclude_unset=True)
    today = _local_now().date()
    result = await _db_run(db, lambda: capture_tasks.patch_for_device(db, user_id, token_id, str(client_id), fields, today))
    if result is None:
        raise HTTPException(status_code=404, detail="No task for this client_id on this device")
    return result
