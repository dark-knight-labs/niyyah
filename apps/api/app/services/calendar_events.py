"""One day's calendar events, read from the user's iCal feeds (Settings > Calendars).

The feed URLs are private links: they never leave the server, and errors name only the calendar.
When Google is connected, the feed for the connected account is read through the Calendar API instead: Google's
iCal export lags by hours, so a freshly added event would not show.
"""
import ipaddress
import re
import socket
import time
from collections.abc import Callable
from datetime import date, datetime, time as clock, timedelta
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import icalendar
import recurring_ical_events

CACHE_SECONDS = 300
FETCH_TIMEOUT = 10.0

_cache: dict[str, tuple[float, bytes]] = {}

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


def _download(url: str) -> bytes:
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


def _minutes(moment: datetime, day_start: datetime) -> int:
    return max(0, min(1440, round((moment - day_start).total_seconds() / 60)))


def _google_entry(item: dict, source: dict, zone: ZoneInfo, day_start: datetime) -> dict | None:
    """A Calendar API event as an entry; None when cancelled."""
    if item.get("status") == "cancelled":
        return None
    start, end = item.get("start", {}), item.get("end", {})
    all_day = "dateTime" not in start
    entry = {
        "title": str(item.get("summary", "")).strip() or "(no title)",
        "calendar": source["name"],
        "color": source["color"],
        "all_day": all_day,
        "location": str(item.get("location", "")).strip() or None,
        "meeting_url": meeting_url(
            item.get("hangoutLink"),
            *(p.get("uri") for p in item.get("conferenceData", {}).get("entryPoints", []) if p.get("entryPointType") == "video"),
            item.get("location"), item.get("description"),
        ),
        "start_min": None,
        "end_min": None,
    }
    if not all_day:
        begin = datetime.fromisoformat(start["dateTime"]).astimezone(zone)
        finish = datetime.fromisoformat(end.get("dateTime", start["dateTime"])).astimezone(zone)
        entry["start_min"] = _minutes(begin, day_start)
        entry["end_min"] = _minutes(finish, day_start)
    return entry


def events_for_day(
    day: date,
    tz: str,
    feeds: list[dict],
    google: tuple[str, Callable[[datetime, datetime], list[dict]]] | None = None,
) -> tuple[list[dict], list[str]]:
    """(events, errors) for `day` in `tz`. A calendar that cannot be read is reported, the others still show.

    `google` = (connected account's email, lister(day_start, day_end) -> Calendar API events): the feed
    with that email is read through it instead of its iCal link.
    `feeds` = [{name, url, color, email}] from the user's settings.
    """
    zone = ZoneInfo(tz)
    day_start = datetime.combine(day, clock.min, zone)
    day_end = day_start + timedelta(days=1)
    events: list[dict] = []
    errors: list[str] = []
    for source in feeds:
        if google and source["email"] and source["email"].lower() == google[0].lower():
            try:
                items = google[1](day_start, day_end)
                entries = [e for e in (_google_entry(i, source, zone, day_start) for i in items) if e]
            except Exception as exc:  # name the calendar, never Google's response
                errors.append(f"{source['name']}: {type(exc).__name__}")
                continue
            events.extend(entries)
            continue
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
                "meeting_url": meeting_url(item.get("X-GOOGLE-CONFERENCE"), item.get("URL"), item.get("LOCATION"), item.get("DESCRIPTION")),
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
