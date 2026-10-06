"""Streams: the blocks of life the planner pages organise work by.

A stream owns one quarter goal, one pipeline and one weekly objective. Streams are data: every
`## <id>` section of the quarter note is a stream, so a new block (Errands, a second business) is
just a new section. The built-ins below only supply defaults for sections that omit name, colour,
icon or slot. Streams are not time blocks: the OT block serves Kahf on Sun-Thu and Alisha Noor on Fri-Sat.
"""
import re
from dataclasses import dataclass

COLORS = ("emerald", "amber", "violet", "fuchsia", "cyan", "rose", "slate", "teal", "orange", "indigo", "lime", "sky")
ICONS = (
    "moon", "dumbbell", "server", "shopping-bag", "clapperboard", "users", "landmark", "bed",
    "briefcase", "book-open", "heart", "home", "car", "wrench", "plane", "shopping-cart",
    "graduation-cap", "wallet", "target", "circle-dot",
)
STATUSES = ("active", "committed", "paused", "archived")
MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
MONTH_TAG = re.compile(r"(?:^|\s)#(" + "|".join(MONTHS) + r")\b", re.IGNORECASE)
SLUG = re.compile(r"^[a-z][a-z0-9-]{1,23}$")

DEFAULTS: dict[str, dict] = {
    "soul": {"name": "Soul", "color": "emerald", "icon": "moon", "slot": "Soul · every day"},
    "body": {"name": "Body", "color": "amber", "icon": "dumbbell", "slot": "Body · Fajr and Maghrib"},
    "kahf": {"name": "Kahf", "color": "violet", "icon": "server", "slot": "OT · Sun to Thu"},
    "alisha": {"name": "Alisha Noor", "color": "fuchsia", "icon": "shopping-bag", "slot": "OT · Fri and Sat"},
    "distribution": {"name": "Distribution", "color": "cyan", "icon": "clapperboard", "slot": "Asr to Maghrib"},
    "fnf": {"name": "FnF", "color": "rose", "icon": "users", "slot": "Family and friends"},
    "finance": {"name": "Finance", "color": "slate", "icon": "landmark", "slot": "Passive", "weekly": False},
    "sleep": {"name": "Sleep", "color": "slate", "icon": "bed", "slot": "After Isha", "goal": False},
}
# Weekly objective lines written before streams had names used these labels.
LEGACY_LABELS = {"alisha": "Alisha", "kahf": "OT"}


@dataclass
class Stream:
    id: str
    name: str
    color: str
    icon: str
    slot: str
    weekly: bool  # has a one-line weekly objective
    goal: bool  # has a quarter goal and a pipeline
    status: str

    @property
    def archived(self) -> bool:
        return self.status == "archived"


def make_stream(stream_id: str, fields: dict[str, str] | None = None, goal: bool = True) -> Stream:
    """A stream from the keys of its quarter section, falling back to the built-in defaults, then to plain ones."""
    fields = fields or {}
    base = DEFAULTS.get(stream_id, {})
    color = fields.get("color") or base.get("color", "slate")
    icon = fields.get("icon") or base.get("icon", "circle-dot")
    weekly = fields.get("weekly")
    return Stream(
        id=stream_id,
        name=fields.get("name") or base.get("name") or stream_id.replace("-", " ").title(),
        color=color if color in COLORS else "slate",
        icon=icon if icon in ICONS else "circle-dot",
        slot=fields.get("slot", base.get("slot", "")),
        weekly=base.get("weekly", True) if weekly is None else weekly.strip().lower() not in ("no", "false", "0"),
        goal=goal and base.get("goal", True),
        status=fields.get("status") or "committed",
    )


def default_streams() -> list[Stream]:
    """Used while the quarter note does not exist yet."""
    return [make_stream(s, goal=DEFAULTS[s].get("goal", True)) for s in DEFAULTS]


def split_month_tag(text: str) -> tuple[str, str | None]:
    """('Ship it #nov') -> ('Ship it', 'nov'); the last month tag wins, text is whitespace-normalised."""
    found = MONTH_TAG.findall(text)
    month = found[-1].lower() if found else None
    return " ".join(MONTH_TAG.sub("", text).split()), month
