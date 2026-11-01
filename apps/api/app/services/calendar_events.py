"""Calendar events for a day or a range of days, read from the user's iCal feeds (Settings > Calendars).

The feed URLs are private links: they never leave the server, and errors name only the calendar.
When Google is connected, the feed for the connected account is read through the Calendar API instead: Google's
iCal export lags by hours, so a freshly added event would not show.

Every event carries a `key` that names it across feeds, re-imports and moves (see `event_key`): overlays use it.
"""
import ipaddress
import re
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, time as clock, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

from app.core.config import Settings, settings
from app.services.google_calendar import GoogleAuthExpired

CACHE_SECONDS = 300
FETCH_TIMEOUT = 10.0

_cache: dict[str, tuple[float, bytes]] = {}
_parsed: dict[str, tuple[bytes, "_Feed"]] = {}  # parsing a large feed takes ~1s, so keep the result while its download is cached

# Only https links to the common meeting hosts become a Join link: nothing else from an event is ever made clickable.
_MEETING = re.compile(r"https://(?:[\w-]+\.)*(?:zoom\.us|zoomgov\.com|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)/[^\s<>\"')]+", re.IGNORECASE)


def meeting_url(*candidates: object) -> str | None:
    """The first Zoom / Google Meet / Teams link found in the given texts (a link field, location, description)."""
    for text in candidates:
        found = _MEETING.search(str(text or ""))
        if found:
            return found.group(0).rstrip(".,;")
    return None


MAX_FEED_BYTES = 5_000_000
MAX_REDIRECTS = 3


def check_public_url(url: str) -> None:
    """Refuse an address the server must not fetch: it has to be https, on the default port, and resolve only to public hosts.

    Calendar addresses are typed in by users and fetched from the server, so without this a feed could probe the cluster
    network or a cloud metadata service. Raises ValueError with a message that is safe to show.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("the calendar address must start with https://")
    if parsed.port not in (None, 443):
        raise ValueError("the calendar address must use the standard https port")
    try:
        infos = socket.getaddrinfo(parsed.hostname, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise ValueError("the calendar address does not resolve")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if getattr(ip, "ipv4_mapped", None):
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise ValueError("the calendar address must point to a public host")


# A local .ics file that stands in for every feed, for development and browser tests. Production never reads it.
FIXTURE_URL = "fixture://calendar"
FIXTURE_ENVS = ("development", "test")


def fixture_file(cfg: Settings) -> Path | None:
    """The CALENDAR_FIXTURE_FILE to read instead of the user's feeds, or None (always None in production)."""
    if cfg.app_env in FIXTURE_ENVS and cfg.calendar_fixture_file:
        return Path(cfg.calendar_fixture_file)
    return None


def fixture_feeds(cfg: Settings) -> list[dict] | None:
    return [{"name": "Fixture", "url": FIXTURE_URL, "color": None, "email": None}] if fixture_file(cfg) else None


def _download(url: str) -> bytes:
    if url == FIXTURE_URL:
        path = fixture_file(settings)
        if path is None:
            raise ValueError("no calendar fixture is configured")
        return path.read_bytes()
    hit = _cache.get(url)
    if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
        return hit[1]
    target = url
    for _ in range(MAX_REDIRECTS + 1):
        check_public_url(target)  # every hop, so a public address cannot redirect into the private network
        with httpx.stream("GET", target, timeout=FETCH_TIMEOUT, follow_redirects=False) as res:
            if res.is_redirect:
                target = urljoin(target, res.headers.get("location", ""))
                continue
            res.raise_for_status()
            body = bytearray()
            for chunk in res.iter_bytes():
                body += chunk
                if len(body) > MAX_FEED_BYTES:
                    raise ValueError("the calendar is too large")
        _cache[url] = (time.monotonic(), bytes(body))
        return bytes(body)
    raise ValueError("the calendar address redirects too many times")


@dataclass
class _Feed:
    """A parsed feed and what keys need from all of it: which UIDs it holds and which of them repeat."""
    calendar: icalendar.Calendar
    uids: set[str] = field(default_factory=set)
    recurring: set[str] = field(default_factory=set)


def _calendar(url: str) -> _Feed:
    body = _download(url)
    hit = _parsed.get(url)
    if hit and hit[0] is body:
        return hit[1]
    feed = _Feed(icalendar.Calendar.from_ical(body))
    for vevent in feed.calendar.walk("VEVENT"):
        uid = str(vevent.get("UID", "")).strip()
        if uid:
            feed.uids.add(uid)
            if any(name in vevent for name in ("RRULE", "RDATE", "RECURRENCE-ID")):
                feed.recurring.add(uid)
    _parsed[url] = (body, feed)
    return feed


def _minutes(moment: datetime, day_start: datetime) -> int:
    return max(0, min(1440, round((moment - day_start).total_seconds() / 60)))


def instance_id(value: date | datetime) -> str:
    """An occurrence's original start as key text: UTC for zoned times, wall clock for floating ones, YYYYMMDD for dates."""
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.strftime("%Y%m%dT%H%M%S")
        return value.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return value.strftime("%Y%m%d")


def event_key(uid: str | None, instance: str | None, title: str, day: date, start_min: int | None) -> str:
    """`uid`, `uid|instance` for one occurrence of a repeating event, or (no UID) the weaker `t|title|day|start`."""
    if uid:
        return f"{uid}|{instance}" if instance else uid
    return f"t|{title}|{day.isoformat()}|{'all' if start_min is None else start_min}"


def _local(moment: datetime, zone: ZoneInfo) -> datetime:
    """A floating time is wall clock in the user's zone."""
    return moment.replace(tzinfo=zone) if moment.tzinfo is None else moment.astimezone(zone)


# One occurrence before it is cut into days: (fields, uid, instance, begin, finish). Dates for all-day events, finish exclusive.
_Occurrence = tuple[dict, str | None, str | None, date | datetime, date | datetime]


def _google_occurrence(item: dict, source: dict, zone: ZoneInfo) -> _Occurrence | None:
    """A Calendar API event; None when cancelled."""
    if item.get("status") == "cancelled":
        return None
    start, end = item.get("start", {}), item.get("end", {})
    fields = {
        "id": item.get("id"),  # only events read through the Calendar API have one: they are the ones that can be moved
        "title": str(item.get("summary", "")).strip() or "(no title)",
        "calendar": source["name"],
        "color": source["color"],
        "location": str(item.get("location", "")).strip() or None,
        "meeting_url": meeting_url(
            item.get("hangoutLink"),
            *(p.get("uri") for p in item.get("conferenceData", {}).get("entryPoints", []) if p.get("entryPointType") == "video"),
            item.get("location"), item.get("description"),
        ),
    }
    instance = None
    if item.get("recurringEventId"):
        original = item.get("originalStartTime", {})
        if original.get("dateTime"):
            instance = instance_id(datetime.fromisoformat(original["dateTime"]))
        elif original.get("date"):
            instance = instance_id(date.fromisoformat(original["date"]))
    if "dateTime" not in start:
        begin = date.fromisoformat(start["date"])
        finish = date.fromisoformat(end["date"]) if end.get("date") else begin + timedelta(days=1)
    else:
        begin = datetime.fromisoformat(start["dateTime"]).astimezone(zone)
        finish = datetime.fromisoformat(end.get("dateTime", start["dateTime"])).astimezone(zone)
    return fields, item.get("iCalUID") or None, instance, begin, finish


def _ical_occurrence(item, source: dict, zone: ZoneInfo, feed: _Feed) -> _Occurrence | None:
    """An expanded VEVENT; None when cancelled. Only a repeating UID keys by RECURRENCE-ID: the expander gives one-offs one too."""
    if str(item.get("STATUS", "")).upper() == "CANCELLED":
        return None
    fields = {
        "id": None,
        "title": str(item.get("SUMMARY", "")).strip() or "(no title)",
        "calendar": source["name"],
        "color": source["color"],
        "location": str(item.get("LOCATION", "")).strip() or None,
        "meeting_url": meeting_url(item.get("X-GOOGLE-CONFERENCE"), item.get("URL"), item.get("LOCATION"), item.get("DESCRIPTION")),
    }
    uid = str(item.get("UID", "")).strip() or None
    instance = instance_id(item.decoded("RECURRENCE-ID")) if uid in feed.recurring and "RECURRENCE-ID" in item else None
    start = item.decoded("DTSTART")
    end = item.decoded("DTEND") if "DTEND" in item else None
    if not isinstance(start, datetime):
        return fields, uid, instance, start, end if type(end) is date and end > start else start + timedelta(days=1)
    begin = _local(start, zone)
    return fields, uid, instance, begin, _local(end, zone) if isinstance(end, datetime) else begin


def _slices(occurrence: _Occurrence, days: list[date], zone: ZoneInfo) -> list[dict]:
    """One entry per day of `days` the occurrence touches; a timed one gets that day's minutes. All share one key."""
    fields, uid, instance, begin, finish = occurrence
    all_day = not isinstance(begin, datetime)
    if all_day:
        first, first_min = begin, None
    else:
        first = begin.date()
        first_min = _minutes(begin, datetime.combine(first, clock.min, zone))
    common = {**fields, "uid": uid, "instance": instance, "key": event_key(uid, instance, fields["title"], first, first_min), "all_day": all_day}
    out = []
    for day in days:
        if all_day:
            if begin <= day < finish:
                out.append({**common, "day": day, "start_min": None, "end_min": None})
            continue
        day_start = datetime.combine(day, clock.min, zone)
        day_end = day_start + timedelta(days=1)
        if begin < day_end and (finish > day_start or (finish <= begin and begin >= day_start)):
            out.append({**common, "day": day, "start_min": _minutes(begin, day_start), "end_min": _minutes(finish, day_start)})
    return out


def _google_entry(item: dict, source: dict, zone: ZoneInfo, day_start: datetime) -> dict | None:
    """A Calendar API event as one day's entry; None when cancelled or not on that day."""
    occurrence = _google_occurrence(item, source, zone)
    found = _slices(occurrence, [day_start.date()], zone) if occurrence else []
    return found[0] if found else None


@dataclass
class RangeRead:
    events: list[dict]  # one entry per event per day, sorted by day, all-day first, then start
    errors: list[str]  # "<calendar>: <reason>" for each calendar that could not be read
    uids: set[str]  # every UID the read feeds hold (whole iCal feeds; the Google listing for the range)


def events_for_range(
    first: date,
    last: date,
    tz: str,
    feeds: list[dict],
    google: tuple[str, Callable[[datetime, datetime], list[dict]]] | None = None,
) -> RangeRead:
    """Events from `first` to `last` (inclusive) in `tz`: each iCal feed is parsed once and Google is listed once for the range.

    `google` = (connected account's email, lister(range_start, range_end) -> Calendar API events): the feed
    with that email is read through it instead of its iCal link. A calendar that cannot be read is reported, the others still show.
    `feeds` = [{name, url, color, email}] from the user's settings.
    """
    zone = ZoneInfo(tz)
    days = [first + timedelta(days=n) for n in range((last - first).days + 1)]
    range_start = datetime.combine(first, clock.min, zone)
    range_end = datetime.combine(last + timedelta(days=1), clock.min, zone)
    read = RangeRead([], [], set())
    for source in feeds:
        if google and source["email"] and source["email"].lower() == google[0].lower():
            try:
                found = [o for o in (_google_occurrence(i, source, zone) for i in google[1](range_start, range_end)) if o]
            except Exception as exc:  # name the calendar; only the fixed expired-consent text is shown, anything else is only named
                read.errors.append(f"{source['name']}: {exc if isinstance(exc, GoogleAuthExpired) else type(exc).__name__}")
                continue
        else:
            try:
                feed = _calendar(source["url"])
                found = [o for o in (_ical_occurrence(i, source, zone, feed)
                                     for i in recurring_ical_events.of(feed.calendar).between(range_start, range_end)) if o]
            except Exception as exc:  # network, bad feed or parse failure: say which calendar, never the URL
                read.errors.append(f"{source['name']}: {type(exc).__name__}")
                continue
            read.uids |= feed.uids
        for occurrence in found:
            if occurrence[1]:
                read.uids.add(occurrence[1])
            read.events.extend(_slices(occurrence, days, zone))
    read.events.sort(key=lambda e: (e["day"], not e["all_day"], e["start_min"] or 0, e["title"]))
    return read


def events_for_day(
    day: date,
    tz: str,
    feeds: list[dict],
    google: tuple[str, Callable[[datetime, datetime], list[dict]]] | None = None,
) -> tuple[list[dict], list[str]]:
    """(events, errors) for `day` in `tz`: `events_for_range` for one day."""
    read = events_for_range(day, day, tz, feeds, google)
    return read.events, read.errors
