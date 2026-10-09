from pydantic import BaseModel


class ScheduleBlockCreate(BaseModel):
    persona_id: int
    start_time: str
    end_time: str
    activity: str
    day_type: str = "daily"
    is_prayer_block: bool = False


class ScheduleBlockUpdate(BaseModel):
    persona_id: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    activity: str | None = None
    day_type: str | None = None
    is_prayer_block: bool | None = None


class ScheduleBlockResponse(BaseModel):
    id: int
    persona_id: int
    start_time: str
    end_time: str
    activity: str
    day_type: str
    is_prayer_block: bool
    order: int

    model_config = {"from_attributes": True}
