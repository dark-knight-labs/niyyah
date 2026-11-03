from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, Field, field_validator

StreamSlug = Annotated[str, Field(pattern=r"^[a-z][a-z0-9-]{1,23}$")]


def _blank_is_none(value):
    return None if isinstance(value, str) and value == "" else value


class PersonaCreate(BaseModel):
    name: str
    arabic_name: str = ""
    domain: str
    eventually: str = ""
    icon: str = "star"
    color: str = "#e11d48"
    one_thing: str | None = None
    ritual: str | None = None
    guardrail: str | None = None
    points: list[str] = []
    stream: StreamSlug | None = None

    _stream = field_validator("stream", mode="before")(_blank_is_none)


class PersonaUpdate(BaseModel):
    name: str | None = None
    arabic_name: str | None = None
    domain: str | None = None
    eventually: str | None = None
    icon: str | None = None
    color: str | None = None
    one_thing: str | None = None
    ritual: str | None = None
    guardrail: str | None = None
    points: list[str] | None = None
    order: int | None = None
    stream: StreamSlug | None = None

    _stream = field_validator("stream", mode="before")(_blank_is_none)


class PersonaResponse(BaseModel):
    id: int
    name: str
    arabic_name: str
    domain: str
    eventually: str
    icon: str
    color: str
    one_thing: str | None
    ritual: str | None
    guardrail: str | None
    points: list
    order: int
    stream: str | None = None
    milestones: list["MilestoneResponse"] = []
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MilestoneCreate(BaseModel):
    target_date: str | None = None
    goal: str


class MilestoneResponse(BaseModel):
    id: int
    persona_id: int
    target_date: date | None
    goal: str
    is_completed: bool

    model_config = {"from_attributes": True}


class ReorderRequest(BaseModel):
    ids: list[int]
