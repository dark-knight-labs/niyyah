from datetime import datetime
from pydantic import BaseModel


class PrincipleCreate(BaseModel):
    name: str
    arabic: str = ""
    meaning: str
    verse: str | None = None
    icon: str = "heart"


class PrincipleUpdate(BaseModel):
    name: str | None = None
    arabic: str | None = None
    meaning: str | None = None
    verse: str | None = None
    icon: str | None = None
    order: int | None = None


class PrincipleResponse(BaseModel):
    id: int
    name: str
    arabic: str
    meaning: str
    verse: str | None
    icon: str
    order: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
