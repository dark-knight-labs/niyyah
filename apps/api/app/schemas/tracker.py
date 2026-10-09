from datetime import date
from pydantic import BaseModel


class NonNegotiableCreate(BaseModel):
    title: str
    category: str = "spiritual"


class NonNegotiableUpdate(BaseModel):
    title: str | None = None
    category: str | None = None
    order: int | None = None


class NonNegotiableResponse(BaseModel):
    id: int
    title: str
    category: str
    order: int
    streak: "StreakResponse | None" = None

    model_config = {"from_attributes": True}


class DailyCheckRequest(BaseModel):
    non_negotiable_id: int
    check_date: date | None = None  # defaults to today


class DailyCheckResponse(BaseModel):
    id: int
    non_negotiable_id: int
    check_date: date
    is_completed: bool

    model_config = {"from_attributes": True}


class StreakResponse(BaseModel):
    current_streak: int
    longest_streak: int
    last_check_date: date | None

    model_config = {"from_attributes": True}


class TrackerDayResponse(BaseModel):
    date: date
    checks: list[DailyCheckResponse]
    non_negotiables: list[NonNegotiableResponse]
