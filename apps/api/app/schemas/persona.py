from datetime import date, datetime
from pydantic import BaseModel


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
