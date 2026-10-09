"""The planner's vocabulary and validation rules: streams, quarters and weeks, pipeline lanes, notebook kinds, day modes, time strings.

Pure data and functions, no I/O. Everything the planner services check input against lives here.
"""
import hashlib
import re
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

# --- Streams and the vocabulary around them --------------------------------

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

def split_month_tag(text: str) -> tuple[str, str | None]:
    """('Ship it #nov') -> ('Ship it', 'nov'); the last month tag wins, text is whitespace-normalised."""
    found = MONTH_TAG.findall(text)
    month = found[-1].lower() if found else None
    return " ".join(MONTH_TAG.sub("", text).split()), month

def make_stream(stream_id: str, fields: dict[str, str] | None = None) -> Stream:
    """A stream from the fields a user gave it, with plain defaults for whatever they left out."""
    fields = fields or {}
    color, icon, weekly = fields.get("color") or "slate", fields.get("icon") or "circle-dot", fields.get("weekly")
    return Stream(
        id=stream_id,
        name=fields.get("name") or stream_id.replace("-", " ").title(),
        color=color if color in COLORS else "slate",
        icon=icon if icon in ICONS else "circle-dot",
        slot=fields.get("slot", ""),
        weekly=True if weekly is None else weekly.strip().lower() not in ("no", "false", "0"),
        goal=True,
        status=fields.get("status") or "committed",
    )


# --- Quarters and weeks ----------------------------------------------------

FIELD_KEYS = ("name", "color", "icon", "slot", "weekly", "goal", "status")

MAX_FIELD_CHARS = 400

def quarter_for(day: date) -> str:
    return f"{day.year}-Q{(day.month - 1) // 3 + 1}"

def quarter_months(label: str) -> list[str]:
    """The three month keys of '2026-Q4' -> ['oct', 'nov', 'dec']."""
    first = 3 * (int(label[-1]) - 1)
    return list(MONTHS[first:first + 3])

def one_line_field(value: str, what: str) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) > MAX_FIELD_CHARS:
        raise ValueError(f"{what} is longer than {MAX_FIELD_CHARS} characters")
    return cleaned

def validate_field(key: str, value: str) -> str:
    value = one_line_field(value, key)
    if key == "color" and value not in COLORS:
        raise ValueError(f"unknown colour '{value}'")
    if key == "icon" and value not in ICONS:
        raise ValueError(f"unknown icon '{value}'")
    if key == "status" and value not in STATUSES:
        raise ValueError(f"unknown status '{value}'")
    if key == "weekly" and value.lower() not in ("yes", "no"):
        raise ValueError("weekly must be yes or no")
    if key == "name" and not value:
        raise ValueError("name is empty")
    return value

MAX_OBJECTIVE_CHARS = 200

def week_for(day: date) -> tuple[date, date, str]:
    """(Sunday, Saturday, 'YYYY-Www') of the week holding `day`; numbered by the ISO week of its Tuesday."""
    start = day - timedelta(days=(day.weekday() + 1) % 7)
    year, number, _ = (start + timedelta(days=2)).isocalendar()
    return start, start + timedelta(days=6), f"{year}-W{number:02d}"

def weekly_streams(streams: list[Stream]) -> list[Stream]:
    return [s for s in streams if s.weekly and not s.archived]

# --- Pipelines -------------------------------------------------------------

LANES = ("now", "next", "backlog", "done")

NOW_LIMIT = 3

STALE_DAYS = 14

MAX_TEXT_CHARS = 300

MAX_DESCRIPTION_CHARS = 4000

BLOCKER_ID = re.compile(r"^[a-z0-9]{4,16}$")

PRODUCT = re.compile(r"\s*\[product::\s*([^\]]*?)\s*\]")

BRACKET_MONTH = re.compile(r"\s*\[(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\]\s*$", re.IGNORECASE)

def clean_item(text: str) -> tuple[str, str | None]:
    """One line of user text -> (text, month): a trailing [Nov] counts as #nov."""
    bracket = BRACKET_MONTH.search(text)
    if bracket:
        text = BRACKET_MONTH.sub("", text) + f" #{bracket.group(1).lower()}"
    cleaned, month = split_month_tag(text)
    if not cleaned:
        raise ValueError("item text is empty")
    if len(cleaned) > MAX_TEXT_CHARS:
        raise ValueError(f"item is longer than {MAX_TEXT_CHARS} characters")
    return cleaned, month

# --- Notebooks -------------------------------------------------------------

KINDS = ("idea", "meeting", "blocker")

LABELS = {"idea": "Idea", "meeting": "Meeting", "blocker": "Blocker"}

MAX_TITLE_CHARS = 200

MAX_BODY_CHARS = 8000

URL = re.compile(r"https?://[^\s<>)\]]+")

TOP_HEADING = re.compile(r"^#{1,2} ")

def clean_entry(kind: str, title: str, body: str) -> tuple[str, str]:
    """(title, body) ready to write: headings in the body are demoted, a blank title is derived."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind '{kind}'")
    title = " ".join(title.split())
    body = body.strip("\n").rstrip()
    if len(title) > MAX_TITLE_CHARS:
        raise ValueError(f"title is longer than {MAX_TITLE_CHARS} characters")
    if len(body) > MAX_BODY_CHARS:
        raise ValueError(f"entry is longer than {MAX_BODY_CHARS} characters")
    body = "\n".join(TOP_HEADING.sub("### ", l) for l in body.split("\n"))
    if not title:
        first = next((l.strip() for l in body.split("\n") if l.strip()), "")
        title = first[:80] or LABELS[kind]
    return title, body

def new_id() -> str:
    return uuid.uuid4().hex[:8]

# --- Tasks, goals, notes, modes, times -------------------------------------

def line_hash(line: str) -> str:
    return hashlib.sha1(line.encode("utf-8")).hexdigest()[:10]

MAX_GOALS = 6

MAX_NOTE_CHARS = 500

def one_line_note(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ValueError("note is empty")
    if len(cleaned) > MAX_NOTE_CHARS:
        raise ValueError(f"note is longer than {MAX_NOTE_CHARS} characters")
    return cleaned

MODE_META = {
    "full":       {"possible": 21, "color": "#10b981"},
    "yellow":     {"possible": 14, "color": "#f59e0b"},
    "compressed": {"possible": 21, "color": "#3b82f6"},
    "minimal":    {"possible": 12, "color": "#8b5cf6"},
    "off":        {"possible": 2,  "color": "#ef4444"},
    "ramadan":    {"possible": 14, "color": "#06b6d4"},
    "fasting":    {"possible": 21, "color": "#f59e0b"},
}

def possible_for_count(mode: str, count: int) -> int:
    """Star ceiling for `count` counted blocks: the mode's table value is for seven blocks."""
    return round(MODE_META.get(mode, MODE_META["full"])["possible"] * count / 7)

ANCHORS = ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha")  # prayer times a schedule row can start or end at
TIME_RE = re.compile(rf"^(?:(\d{{1,2}}):(\d{{2}})|({'|'.join(ANCHORS)})(?:([+-])(\d+))?)$")

def valid_time(value: str) -> bool:
    match = TIME_RE.match(value)
    if not match:
        return False
    if match.group(1) is not None:
        return int(match.group(1)) < 24 and int(match.group(2)) < 60
    return True
