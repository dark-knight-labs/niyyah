"""One day's calendar events, read from the iCal feeds already set up in Obsidian's Day Planner plugin.

The feed URLs live in the vault (.obsidian/plugins/obsidian-day-planner/data.json), so Niyyah needs no
credentials of its own. They are private links: they never leave the server, and errors name only the calendar.
"""
import json
import time
from datetime import date, datetime, time as clock, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

SETTINGS_PATH = ".obsidian/plugins/obsidian-day-planner/data.json"
CACHE_SECONDS = 300
FETCH_TIMEOUT = 10.0

_cache: dict[str, tuple[float, bytes]] = {}


def sources(root: Path) -> list[dict]:
    """The calendars configured in Day Planner: [{name, url, color}]."""
    path = root / SETTINGS_PATH
    if not path.is_file():
        return []
    icals = json.loads(path.read_text(encoding="utf-8")).get("icals", [])
    return [{"name": c.get("name") or "Calendar", "url": c["url"], "color": c.get("color")} for c in icals if c.get("url")]


def _download(url: str) -> bytes:
    hit = _cache.get(url)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    res = httpx.get(url, timeout=FETCH_TIMEOUT, follow_redirects=True)
    res.raise_for_status()
    _cache[url] = (time.monotonic(), res.content)
    return res.content


def _minutes(moment: datetime, day_start: datetime) -> int:
    return max(0, min(1440, round((moment - day_start).total_seconds() / 60)))


def events_for_day(root: Path, day: date, tz: str) -> tuple[list[dict], list[str]]:
    """(events, errors) for `day` in `tz`. A calendar that cannot be read is reported, the others still show."""
    zone = ZoneInfo(tz)
    day_start = datetime.combine(day, clock.min, zone)
    day_end = day_start + timedelta(days=1)
    events: list[dict] = []
    errors: list[str] = []
    for source in sources(root):
        try:
            calendar = icalendar.Calendar.from_ical(_download(source["url"]))
            found = recurring_ical_events.of(calendar).between(day_start, day_end)
        except Exception as exc:  # network, bad feed or parse failure: say which calendar, never the URL
            errors.append(f"{source['name']}: {type(exc).__name__}")
            continue
        for item in found:
            if str(item.get("STATUS", "")).upper() == "CANCELLED":
                continue
            start = item.decoded("DTSTART")
            all_day = not isinstance(start, datetime)
            entry = {
                "title": str(item.get("SUMMARY", "")).strip() or "(no title)",
                "calendar": source["name"],
                "color": source["color"],
                "all_day": all_day,
                "location": str(item.get("LOCATION", "")).strip() or None,
                "start_min": None,
                "end_min": None,
            }
            if not all_day:
                end = item.decoded("DTEND") if "DTEND" in item else start
                entry["start_min"] = _minutes(start.astimezone(zone), day_start)
                entry["end_min"] = _minutes(end.astimezone(zone), day_start)
            events.append(entry)
    events.sort(key=lambda e: (not e["all_day"], e["start_min"] or 0, e["title"]))
    return events, errors
