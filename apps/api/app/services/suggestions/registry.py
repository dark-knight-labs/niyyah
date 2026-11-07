"""What a suggestion line can do: one entry per (entity, op).

An entry says how to check a line (payload model, free-text fields), what the suggester saw (`read_base`), which rows the
change may write (`touched`) and how to make it (`apply`). `apply` only calls the services the screens call, so a line
gives the same result as the same edit made by hand. Services flush; they never commit.

Targets and refs: an item line names its target as {"id": n}, or {"ref": "L1"} for an item that an earlier line of the
same bundle creates. `parent_ref` in an item payload does the same for the parent link.
"""
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.board import BoardEdge, BoardNode
from app.models.compass import Compass
from app.models.planner import LogEntry, Quarter, QuarterStream, Task
from app.models.vault import VaultBlockVote, VaultDay
from app.services import compass as compass_service
from app.services import planner_day, planner_items, planner_work
from app.services.rules import checklist_from_text, quarter_for, quarter_months
from app.services.suggestions import snapshot
from app.services.suggestions.snapshot import RowRef

TASKS, QUARTERS, STREAMS, COMPASS = "planner_tasks", "planner_quarters", "planner_quarter_streams", "compass"
DAYS, VOTES, LOG = "vault_days", "vault_block_votes", "planner_log_entries"

Month = Literal["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
Line = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]
REF = re.compile(r"^[A-Za-z0-9_-]{1,8}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


@dataclass
class Ctx:
    db: AsyncSession
    user_id: int
    today: date


class CheckLine(Strict):
    id: str | None = Field(default=None, max_length=12)
    text: str = Field(min_length=1, max_length=300)
    done: bool = False


# --- Targets ------------------------------------------------------------------------------------------------------

class ItemTarget(Strict):
    id: int | None = None
    ref: str | None = Field(default=None, pattern=REF.pattern)

    @model_validator(mode="after")
    def _one(self):
        if (self.id is None) == (self.ref is None):
            raise ValueError("send exactly one of `id` and `ref`")
        return self


class NoTarget(Strict):
    pass


class WeekTarget(Strict):
    week: str = Field(pattern=r"^\d{4}-W\d{2}$")
    stream: str = Field(min_length=1, max_length=24)


class DayTarget(Strict):
    day: date


class CheckpointTarget(Strict):
    stream: str = Field(min_length=1, max_length=24)
    month: Month


class QuarterTarget(Strict):
    quarter: str = Field(pattern=r"^\d{4}-Q[1-4]$")


# --- Payloads -----------------------------------------------------------------------------------------------------

class ItemCreate(Strict):
    """Exactly one of `day` (an item on that day) and `lane` + `stream` (an undated item in the stream's pipeline)."""
    text: str = Field(min_length=1, max_length=300)
    day: date | None = None
    lane: Literal["now", "next", "backlog"] | None = None
    stream: str | None = Field(default=None, max_length=24)
    description: str | None = Field(default=None, max_length=4000)
    checklist: list[CheckLine] | None = Field(default=None, max_length=50)
    products: list[str] | None = Field(default=None, max_length=12)
    start_min: int | None = Field(default=None, ge=0, le=1440)
    end_min: int | None = Field(default=None, ge=0, le=1440)
    parent_id: int | None = None
    parent_ref: str | None = Field(default=None, pattern=REF.pattern)

    @model_validator(mode="after")
    def _shape(self):
        if (self.day is None) == (self.lane is None):
            raise ValueError("send exactly one of `day` and `lane`")
        if self.parent_id is not None and self.parent_ref is not None:
            raise ValueError("send one of `parent_id` and `parent_ref`")
        return self


class ItemUpdate(Strict):
    """Only the fields sent change. `unschedule` clears the day and the time; it cannot go with `day`."""
    text: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=4000)
    checklist: list[CheckLine] | None = Field(default=None, max_length=50)
    products: list[str] | None = Field(default=None, max_length=12)
    checkpoint: Month | Literal[""] | None = None
    stream: str | None = Field(default=None, max_length=24)
    day: date | None = None
    unschedule: bool | None = None
    start_min: int | None = Field(default=None, ge=0, le=1440)
    end_min: int | None = Field(default=None, ge=0, le=1440)
    parent_id: int | None = None
    parent_ref: str | None = Field(default=None, pattern=REF.pattern)
    status: Literal["open", "done"] | None = None

    @model_validator(mode="after")
    def _shape(self):
        if not self.model_fields_set:
            raise ValueError("nothing to change")
        if self.unschedule and self.day is not None:
            raise ValueError("send `day` or `unschedule`, not both")
        if "parent_id" in self.model_fields_set and "parent_ref" in self.model_fields_set:
            raise ValueError("send one of `parent_id` and `parent_ref`")
        for key in ("text", "stream", "day", "status"):  # null means "leave alone" for these; `stream` null is not offered
            if key in self.model_fields_set and getattr(self, key) is None:
                raise ValueError(f"`{key}` cannot be null")
        return self


class ItemMove(Strict):
    lane: Literal["now", "next", "backlog", "done"]


class ItemFocus(Strict):
    pass


class WeekObjective(Strict):
    """Text, done flag and/or month checkpoint ("" clears it) of one stream's objective for the week."""
    text: str | None = Field(default=None, max_length=200)
    done: bool | None = None
    checkpoint: Month | Literal[""] | None = None

    @model_validator(mode="after")
    def _something(self):
        if self.text is None and self.done is None and self.checkpoint is None:
            raise ValueError("give text, done and/or checkpoint")
        return self


class LogNote(Strict):
    clock: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    section: str = Field(min_length=1, max_length=60)
    span: str = Field(min_length=1, max_length=60)
    text: str = Field(min_length=1, max_length=500)


class CheckpointUpdate(Strict):
    checklist: list[CheckLine] = Field(max_length=15)


class QuarterObjective(Strict):
    text: str = Field(min_length=1, max_length=400)
    arabic: str | None = Field(default=None, max_length=400)


class CompassUpdate(Strict):
    mission: str | None = Field(default=None, max_length=1000)
    vision: str | None = Field(default=None, max_length=1000)
    vision_horizon: str | None = Field(default=None, max_length=10)

    @model_validator(mode="after")
    def _something(self):
        if not any(getattr(self, k) is not None for k in ("mission", "vision", "vision_horizon")):
            raise ValueError("give mission, vision and/or vision_horizon")
        return self


# --- Entries ------------------------------------------------------------------------------------------------------

@dataclass(frozen=True)
class Entry:
    entity: str
    op: str
    target_model: type[BaseModel]
    payload_model: type[BaseModel]
    text_fields: tuple[str, ...]  # payload fields whose text goes through the checks hook
    read_base: Callable[..., Awaitable[dict | None]]  # (ctx, target, payload, lock) -> what the suggester saw; None = no such row
    touched: Callable[..., Awaitable[list[RowRef]]]  # (ctx, target, payload, lock) -> rows apply may change
    apply: Callable[..., Awaitable[dict | None]]  # (ctx, target, payload) -> created_key
    compares_base: bool = True
    needs_row: bool = False  # the target must exist when the line is made


REGISTRY: dict[tuple[str, str], Entry] = {}


def entry(*args, **kwargs) -> Entry:
    e = Entry(*args, **kwargs)
    REGISTRY[(e.entity, e.op)] = e
    return e


def lookup(entity: str, op: str) -> Entry | None:
    return REGISTRY.get((entity, op))


# Helpers -----------------------------------------------------------------------------------------------------------

async def _task(ctx: Ctx, task_id: int, lock: bool = False) -> dict | None:
    """An item row (not a week objective that no item carries) of this user, as a snapshot; None if there is none."""
    row = (await snapshot.read_rows(ctx.db, [(TASKS, task_id)], lock=lock)).get((TASKS, task_id))
    if row is None or row["user_id"] != ctx.user_id or (row["lane"] is None and row["focus_week"] is not None):
        return None
    return row


async def _stream_tasks(ctx: Ctx, stream: str, lock: bool) -> list[RowRef]:
    """Rows of a stream that carry pipeline or week state: what sync_focus and set_focus may rename, link, move or delete."""
    return await snapshot.read_where(ctx.db, TASKS, Task.user_id == ctx.user_id, Task.stream == stream,
                                     or_(Task.lane.is_not(None), Task.focus_week.is_not(None)), lock=lock)


def _fields(model: BaseModel) -> dict:
    return model.model_dump(exclude_unset=True, mode="python")


def _pipeline_stream(row: dict) -> str:
    if row["lane"] is None:
        raise ValueError("that item is not in a pipeline")
    return row["stream"]


async def _known_pipeline_stream(ctx: Ctx, stream: str) -> None:
    if stream not in await planner_work.pipeline_streams(ctx.db, ctx.user_id, ctx.today):
        raise ValueError(f"unknown stream '{stream}'")


# item.create ---------------------------------------------------------------------------------------------------------

async def _no_base(ctx, target, payload, lock=False):
    return {}


async def _touch_nothing(ctx, target, payload, lock=False):
    return []


async def _item_create(ctx: Ctx, target, payload: ItemCreate):
    fields = _fields(payload)
    fields.pop("parent_ref", None)
    if payload.day is not None:
        planner_items.check_task_day(payload.day, ctx.today)
    task = await planner_items.create_item(ctx.db, ctx.user_id, payload.day, fields, ctx.today)
    return {"id": task.id}


entry("item", "create", NoTarget, ItemCreate, ("text", "description", "checklist"), _no_base, _touch_nothing, _item_create,
      compares_base=False)


# item.update ---------------------------------------------------------------------------------------------------------

_UPDATE_COLUMNS = {
    "text": ("text",), "description": ("description",), "checklist": ("checklist",), "products": ("products",),
    "checkpoint": ("checkpoint",), "stream": ("stream",), "day": ("scheduled_on",), "unschedule": ("scheduled_on", "start_min", "end_min"),
    "start_min": ("start_min",), "end_min": ("end_min",), "parent_id": ("parent_id",), "parent_ref": ("parent_id",), "status": ("status", "lane"),
}


async def _item_update_base(ctx, target: ItemTarget, payload: ItemUpdate, lock=False):
    row = await _task(ctx, target.id, lock)
    if row is None:
        return None
    columns = dict.fromkeys(c for key in payload.model_fields_set for c in _UPDATE_COLUMNS[key])
    return {c: row[c] for c in columns}


async def _item_row_only(ctx, target: ItemTarget, payload, lock=False):
    return [(TASKS, target.id)] if await _task(ctx, target.id, lock) is not None else []


async def _item_update(ctx: Ctx, target: ItemTarget, payload: ItemUpdate):
    fields = _fields(payload)
    fields.pop("parent_ref", None)
    checkpoint = fields.pop("checkpoint", None) if "checkpoint" in fields else Ellipsis
    if payload.day is not None:
        planner_items.check_task_day(payload.day, ctx.today)
    task = await planner_items.update_item(ctx.db, ctx.user_id, target.id, fields, ctx.today)
    if checkpoint is not Ellipsis:
        await planner_work.set_checkpoint(ctx.db, ctx.user_id, task.stream, task.id, checkpoint or None)
    return None


entry("item", "update", ItemTarget, ItemUpdate, ("text", "description", "checklist"), _item_update_base, _item_row_only, _item_update,
      needs_row=True)


# item.move -----------------------------------------------------------------------------------------------------------

async def _item_move_base(ctx, target: ItemTarget, payload: ItemMove, lock=False):
    row = await _task(ctx, target.id, lock)
    return None if row is None else {"lane": row["lane"], "stream": row["stream"]}


async def _item_move(ctx: Ctx, target: ItemTarget, payload: ItemMove):
    row = await _task(ctx, target.id)
    if row is None:
        raise ValueError(planner_work.ITEM_GONE)
    stream = _pipeline_stream(row)
    await _known_pipeline_stream(ctx, stream)
    await planner_work.pipeline_move(ctx.db, ctx.user_id, stream, target.id, payload.lane, ctx.today)
    return None


entry("item", "move", ItemTarget, ItemMove, (), _item_move_base, _item_row_only, _item_move, needs_row=True)


# item.focus ----------------------------------------------------------------------------------------------------------

async def _item_focus_base(ctx, target: ItemTarget, payload, lock=False):
    row = await _task(ctx, target.id, lock)
    return None if row is None else {"lane": row["lane"], "stream": row["stream"], "focus_week": row["focus_week"]}


async def _item_focus_touched(ctx, target: ItemTarget, payload, lock=False):
    row = await _task(ctx, target.id)
    if row is None or row["lane"] is None:
        return []
    return await _stream_tasks(ctx, row["stream"], lock)


async def _item_focus(ctx: Ctx, target: ItemTarget, payload: ItemFocus):
    row = await _task(ctx, target.id)
    if row is None:
        raise ValueError(planner_work.ITEM_GONE)
    stream = _pipeline_stream(row)
    await _known_pipeline_stream(ctx, stream)
    await planner_work.pipeline_focus(ctx.db, ctx.user_id, stream, target.id, ctx.today)
    return None


entry("item", "focus", ItemTarget, ItemFocus, (), _item_focus_base, _item_focus_touched, _item_focus, needs_row=True)


# week_objective.update -----------------------------------------------------------------------------------------------

async def _week_row(ctx: Ctx, target: WeekTarget, lock=False) -> dict | None:
    refs = await snapshot.read_where(ctx.db, TASKS, Task.user_id == ctx.user_id, Task.stream == target.stream,
                                     Task.focus_week == target.week, lock=lock)
    rows = await snapshot.read_rows(ctx.db, refs[:1])
    return next(iter(rows.values()), None)


async def _week_base(ctx, target: WeekTarget, payload: WeekObjective, lock=False):
    row = await _week_row(ctx, target, lock)
    if row is None or row["objective_text"] is None:
        return {"text": "", "done": False, "checkpoint": None}
    return {"text": row["objective_text"], "done": bool(row["objective_done"]), "checkpoint": row["focus_checkpoint"]}


async def _week_touched(ctx, target: WeekTarget, payload, lock=False):
    if target.week == planner_work.week_for(ctx.today)[2]:  # the stream's small-domino item may be renamed, linked, created, moved
        return await _stream_tasks(ctx, target.stream, lock)
    return await snapshot.read_where(ctx.db, TASKS, Task.user_id == ctx.user_id, Task.stream == target.stream,
                                     Task.focus_week == target.week, lock=lock)


async def _week_apply(ctx: Ctx, target: WeekTarget, payload: WeekObjective):
    await planner_work.week_objective_set(ctx.db, ctx.user_id, ctx.today, target.stream, payload.text, payload.done,
                                          payload.checkpoint, week=target.week)
    return None


entry("week_objective", "update", WeekTarget, WeekObjective, ("text",), _week_base, _week_touched, _week_apply)


# log_note.create -----------------------------------------------------------------------------------------------------

async def _log_touched(ctx, target: DayTarget, payload, lock=False):
    refs = await snapshot.read_where(ctx.db, DAYS, VaultDay.user_id == ctx.user_id, VaultDay.date == target.day, lock=lock)
    if refs:
        refs += await snapshot.read_where(ctx.db, VOTES, VaultBlockVote.vault_day_id == refs[0][1], lock=lock)
    return refs + await snapshot.read_where(ctx.db, LOG, LogEntry.user_id == ctx.user_id, LogEntry.day == target.day, lock=lock)


async def _log_apply(ctx: Ctx, target: DayTarget, payload: LogNote):
    planner_day.check_edit_day(target.day, ctx.today)
    await planner_day.add_note(ctx.db, ctx.user_id, target.day, payload.clock, payload.section, payload.span, payload.text)
    return {"day": target.day.isoformat()}


entry("log_note", "create", DayTarget, LogNote, ("section", "span", "text"), _no_base, _log_touched, _log_apply, compares_base=False)


# checkpoint.update ---------------------------------------------------------------------------------------------------

async def _stream_row(ctx: Ctx, target: CheckpointTarget, lock=False) -> dict | None:
    refs = await snapshot.read_where(ctx.db, STREAMS, QuarterStream.user_id == ctx.user_id,
                                     QuarterStream.quarter == quarter_for(ctx.today), QuarterStream.slug == target.stream,
                                     QuarterStream.in_note.is_(True), lock=lock)  # as planner_work.update_stream finds it
    return next(iter((await snapshot.read_rows(ctx.db, refs[:1])).values()), None)


async def _checkpoint_base(ctx, target: CheckpointTarget, payload, lock=False):
    row = await _stream_row(ctx, target, lock)
    if row is None:
        return None
    month = next((c for c in row["checkpoints"] or [] if c["month"] == target.month), {})
    return {"checklist": month.get("checklist") or checklist_from_text(month.get("text", ""))}


async def _checkpoint_touched(ctx, target: CheckpointTarget, payload, lock=False):
    return await snapshot.read_where(ctx.db, STREAMS, QuarterStream.user_id == ctx.user_id,
                                     QuarterStream.quarter == quarter_for(ctx.today), QuarterStream.slug == target.stream, lock=lock) + \
        await snapshot.read_where(ctx.db, QUARTERS, Quarter.user_id == ctx.user_id, Quarter.label == quarter_for(ctx.today), lock=lock)


async def _checkpoint_apply(ctx: Ctx, target: CheckpointTarget, payload: CheckpointUpdate):
    label = quarter_for(ctx.today)
    if target.month not in quarter_months(label):
        raise ValueError(f"'{target.month}' is not a month of this quarter")
    await planner_work.update_stream(ctx.db, ctx.user_id, label, target.stream, {}, None,
                                     {target.month: [line.model_dump() for line in payload.checklist]})
    return None


entry("checkpoint", "update", CheckpointTarget, CheckpointUpdate, ("checklist",), _checkpoint_base, _checkpoint_touched,
      _checkpoint_apply, needs_row=True)


# quarter_objective.update --------------------------------------------------------------------------------------------

async def _quarter_row(ctx: Ctx, target: QuarterTarget, lock=False) -> dict | None:
    refs = await snapshot.read_where(ctx.db, QUARTERS, Quarter.user_id == ctx.user_id, Quarter.label == target.quarter, lock=lock)
    return next(iter((await snapshot.read_rows(ctx.db, refs[:1])).values()), None)


async def _quarter_base(ctx, target: QuarterTarget, payload, lock=False):
    if target.quarter != quarter_for(ctx.today):  # checked when the line is made, as the screen only edits this quarter
        raise ValueError("only this quarter's objective can be changed")
    row = await _quarter_row(ctx, target, lock)
    return {"objective": None, "objective_ar": None} if row is None else {"objective": row["objective"], "objective_ar": row["objective_ar"]}


async def _quarter_touched(ctx, target: QuarterTarget, payload, lock=False):
    return await snapshot.read_where(ctx.db, QUARTERS, Quarter.user_id == ctx.user_id, Quarter.label == target.quarter, lock=lock)


async def _quarter_apply(ctx: Ctx, target: QuarterTarget, payload: QuarterObjective):
    await planner_work.set_super_objective(ctx.db, ctx.user_id, target.quarter, payload.text, payload.arabic)
    return None


entry("quarter_objective", "update", QuarterTarget, QuarterObjective, ("text", "arabic"), _quarter_base, _quarter_touched, _quarter_apply)


# compass.update ------------------------------------------------------------------------------------------------------

async def _compass_base(ctx, target, payload: CompassUpdate, lock=False):
    refs = await snapshot.read_where(ctx.db, COMPASS, Compass.user_id == ctx.user_id, lock=lock)
    row = next(iter((await snapshot.read_rows(ctx.db, refs[:1])).values()), None)
    return {k: (row[k] if row else "") for k in payload.model_fields_set if getattr(payload, k) is not None}


async def _compass_touched(ctx, target, payload, lock=False):
    return await snapshot.read_where(ctx.db, COMPASS, Compass.user_id == ctx.user_id, lock=lock)


async def _compass_apply(ctx: Ctx, target, payload: CompassUpdate):
    await compass_service.update(ctx.db, ctx.user_id, {k: v for k, v in _fields(payload).items() if v is not None})
    return None


entry("compass", "update", NoTarget, CompassUpdate, ("mission", "vision"), _compass_base, _compass_touched, _compass_apply)


# --- Things that point at an item, for the undo guard --------------------------------------------------------------

async def streams_in_quarter(db, user_id: int, label: str, own: set[int]) -> bool:
    """Does the user have a stream of this quarter that the line being undone did not make itself?"""
    from sqlalchemy import select

    rows = (await db.execute(select(QuarterStream.id).where(QuarterStream.user_id == user_id, QuarterStream.quarter == label))).scalars().all()
    return any(pk not in own for pk in rows)


async def pointers_at_task(db, user_id: int, task_id: int) -> bool:
    """Is a row of this user still pointing at the item: a piece (parent_id), a board node (ref_key, parent_key) or edge end."""
    from sqlalchemy import select

    from app.models.board import Board

    key = f"task:{task_id}"
    if (await db.execute(select(Task.id).where(Task.user_id == user_id, Task.parent_id == task_id).limit(1))).first():
        return True
    boards = select(Board.id).where(Board.user_id == user_id)
    if (await db.execute(select(BoardNode.id).where(BoardNode.board_id.in_(boards), or_(BoardNode.ref_key == key, BoardNode.parent_key == key)).limit(1))).first():
        return True
    return (await db.execute(select(BoardEdge.id).where(BoardEdge.board_id.in_(boards), or_(BoardEdge.from_id == key, BoardEdge.to_id == key)).limit(1))).first() is not None
