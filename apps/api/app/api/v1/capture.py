from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.vault import _local_now
from app.core.database import get_db
from app.core.deps import get_capture_user
from app.models.user import User
from app.services import planner_products, planner_store

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
