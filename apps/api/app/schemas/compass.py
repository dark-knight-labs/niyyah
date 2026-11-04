from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

Mission = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Horizon = Annotated[str, StringConstraints(strip_whitespace=True, max_length=10)]


class CompassUpdate(BaseModel):
    """Only the fields present in the body change; an empty string clears one."""
    mission: Mission = ""
    vision: Mission = ""
    vision_horizon: Horizon = ""


class CompassResponse(BaseModel):
    mission: str
    vision: str
    vision_horizon: str
    updated_at: datetime | None
