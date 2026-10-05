"""Parse the vault's Calendar/Schedule.md into a typed day-shape schedule.

The note is the single source of truth for the daily routine. Anchors
(fajr, asr, ...) are kept symbolic here; prayer times are resolved per date
by the client, so this module needs no astronomy.
"""
import re
from dataclasses import dataclass, field

from app.services.vault_parser import _split_frontmatter

# Scheduling blocks, not vote blocks: ONE Thing and OPS are merged into "ot".
SCHEDULE_BLOCKS = ("soul", "body", "ot", "planning", "distribution", "fnf", "sleep")
DAY_TYPES = ("weekday", "weekend")
ANCHORS = ("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha")

_TIME_RE = re.compile(rf"^(?:(\d{{1,2}}):(\d{{2}})|({'|'.join(ANCHORS)})(?:([+-])(\d+))?)$")
_HEADING_RE = re.compile(r"^##\s+(\w+)\s*$")
_REQUIRED_META = ("lat", "lon", "tz", "method", "madhab")


@dataclass
class ScheduleBlock:
    block: str
    start: str
    end: str
    what: str


@dataclass
class ParsedSchedule:
    meta: dict
    days: dict[str, list[ScheduleBlock]] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _valid_time(value: str) -> bool:
    match = _TIME_RE.match(value)
    if not match:
        return False
    if match.group(1) is not None:
        return int(match.group(1)) < 24 and int(match.group(2)) < 60
    return True


def _split_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def parse_schedule(content: str) -> ParsedSchedule:
    frontmatter, body = _split_frontmatter(content)
    result = ParsedSchedule(meta={key: frontmatter.get(key) for key in ("city", *_REQUIRED_META)})

    for key in _REQUIRED_META:
        if frontmatter.get(key) in (None, ""):
            result.errors.append(f"frontmatter: missing '{key}'")

    section: str | None = None
    for line in body.splitlines():
        heading = _HEADING_RE.match(line)
        if heading:
            name = heading.group(1).lower()
            section = name if name in DAY_TYPES else None
            if section:
                result.days.setdefault(section, [])
            continue

        if section is None or not line.lstrip().startswith("|"):
            continue

        cells = _split_row(line)
        if cells[0].lower() == "block" or set(cells[0]) <= {"-", ":", " "}:
            continue  # header or separator row
        if len(cells) != 4:
            result.errors.append(f"{section}: expected 4 columns, got {len(cells)}: {line.strip()}")
            continue

        block, start, end, what = cells
        block = block.lower()
        if block not in SCHEDULE_BLOCKS:
            result.errors.append(f"{section}: unknown block '{block}'")
            continue
        bad = [v for v in (start, end) if not _valid_time(v.lower())]
        if bad:
            result.errors.append(f"{section}/{block}: invalid time {bad}")
            continue
        result.days[section].append(ScheduleBlock(block, start.lower(), end.lower(), what))

    if "weekday" not in result.days or not result.days["weekday"]:
        result.errors.append("missing or empty '## weekday' section")

    return result
