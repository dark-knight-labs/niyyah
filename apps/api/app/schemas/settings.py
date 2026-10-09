from pydantic import BaseModel


class UserSettingsUpdate(BaseModel):
    super_objective: str | None = None
    prayer_calculation_method: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    theme: str | None = None


class UserSettingsResponse(BaseModel):
    super_objective: str
    prayer_calculation_method: str
    latitude: float | None
    longitude: float | None
    theme: str

    model_config = {"from_attributes": True}
