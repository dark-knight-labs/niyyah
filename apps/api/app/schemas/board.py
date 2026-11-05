import json
import re
from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

MAX_TEXT = 4000
MAX_TITLE = 200
MAX_NOTES = 10000
REF_KEY = re.compile(r"^(stream|cp|week|task|quarter):[A-Za-z0-9:_-]{1,72}$")

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_TITLE)]
NodeKind = Literal["mind", "ref", "sticky", "text", "shape", "frame"]


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; they are UTC. Every timestamp leaves the API as UTC-aware, so one row always prints the same."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _small_json(value: dict, limit: int, what: str) -> dict:
    if len(json.dumps(value)) > limit:
        raise ValueError(f"{what} is too large")
    return value


class BoardCreate(BaseModel):
    title: Title


class BoardUpdate(BaseModel):
    """Only the fields present change."""
    title: Title | None = None
    viewport: dict[str, Any] | None = None

    @field_validator("viewport")
    @classmethod
    def _viewport(cls, v):
        return v if v is None else _small_json(v, 1000, "viewport")


class NodeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=36)
    kind: NodeKind
    parent_id: str | None = Field(default=None, max_length=36)
    parent_key: str | None = Field(default=None, max_length=80)
    position: int = 0
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    text: str = Field(default="", max_length=MAX_TEXT)
    notes: str = Field(default="", max_length=MAX_NOTES)
    style: dict[str, Any] = Field(default_factory=dict)
    collapsed: bool = False
    hidden: bool = False
    ref_key: str | None = Field(default=None, max_length=80)
    frame_id: str | None = Field(default=None, max_length=36)

    @field_validator("style")
    @classmethod
    def _style(cls, v):
        return _small_json(v, 2000, "style")

    @model_validator(mode="after")
    def _ref(self):
        if self.ref_key is not None and not REF_KEY.match(self.ref_key):
            raise ValueError("ref_key must look like task:12, stream:studio, cp:studio:nov, week:studio:2026-W45 or quarter:2026-Q4")
        if (self.kind == "ref") != (self.ref_key is not None):
            raise ValueError("a ref node needs a ref_key, and only a ref node has one")
        return self


class NodeOut(NodeIn):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    updated_at: datetime

    _utc = field_validator("updated_at")(lambda cls, v: _aware(v))


class EdgeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=36)
    from_id: str = Field(min_length=1, max_length=80)
    to_id: str = Field(min_length=1, max_length=80)
    label: str = Field(default="", max_length=200)
    style: dict[str, Any] = Field(default_factory=dict)

    @field_validator("style")
    @classmethod
    def _style(cls, v):
        return _small_json(v, 2000, "style")


class EdgeOut(EdgeIn):
    model_config = ConfigDict(extra="ignore", from_attributes=True)
    updated_at: datetime

    _utc = field_validator("updated_at")(lambda cls, v: _aware(v))


class Counts(BaseModel):
    nodes: int
    edges: int


class BoardSummary(BaseModel):
    id: int
    title: str
    kind: str
    revision: int
    updated_at: datetime
    counts: Counts


class BoardOut(BaseModel):
    id: int
    title: str
    kind: str
    viewport: dict[str, Any]
    revision: int
    nodes: list[NodeOut]
    edges: list[EdgeOut]


class UpsertNodeOp(BaseModel):
    op: Literal["upsert_node"]
    node: NodeIn
    base_updated_at: datetime | None = None  # the row's updated_at this client last saw; null for a new row


class DeleteNodeOp(BaseModel):
    op: Literal["delete_node"]
    id: str = Field(min_length=1, max_length=36)
    base_updated_at: datetime | None = None


class UpsertEdgeOp(BaseModel):
    op: Literal["upsert_edge"]
    edge: EdgeIn
    base_updated_at: datetime | None = None


class DeleteEdgeOp(BaseModel):
    op: Literal["delete_edge"]
    id: str = Field(min_length=1, max_length=36)
    base_updated_at: datetime | None = None


Op = Annotated[UpsertNodeOp | DeleteNodeOp | UpsertEdgeOp | DeleteEdgeOp, Field(discriminator="op")]


class OpsIn(BaseModel):
    """`ops` are validated one by one by the service, so a bad one is reported by id (`bad_ops`) instead of as a generic body error.
    Each is one of: upsert_node {node, base_updated_at?}, delete_node {id, base_updated_at?}, upsert_edge {edge, base_updated_at?},
    delete_edge {id, base_updated_at?}. A null base_updated_at skips the staleness check."""
    ops: list[dict[str, Any]]


class OpsResult(BaseModel):
    revision: int
    updated: dict[str, datetime] = {}  # id -> updated_at of every node and edge this batch wrote: the client's next base_updated_at
    bad_ops: list[str] = []
    stale_ops: list[str] = []  # ids whose op was skipped because the stored row is newer than the op's base_updated_at

    _utc = field_validator("updated")(lambda cls, v: {k: _aware(t) for k, t in v.items()})


class PromoteIn(BaseModel):
    stream: str
    lane: Literal["now", "next", "backlog"] = "next"
    checkpoint: Literal["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] | None = None


class PromoteOut(BaseModel):
    task_id: int
    revision: int
    node: NodeOut
