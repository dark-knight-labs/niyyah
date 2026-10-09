from datetime import date

from app.services import calendar_events

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:one
DTSTART;TZID=Asia/Dhaka:20261006T093000
DTEND;TZID=Asia/Dhaka:20261006T100000
SUMMARY:Team sync
END:VEVENT
BEGIN:VEVENT
UID:weekly
DTSTART:20260929T080000Z
DTEND:20260929T090000Z
RRULE:FREQ=WEEKLY
SUMMARY:Weekly review
END:VEVENT
BEGIN:VEVENT
UID:allday
DTSTART;VALUE=DATE:20261006
DTEND;VALUE=DATE:20261007
SUMMARY:Holiday
END:VEVENT
BEGIN:VEVENT
UID:gone
DTSTART:20261006T100000Z
DTEND:20261006T110000Z
STATUS:CANCELLED
SUMMARY:Cancelled
END:VEVENT
END:VCALENDAR
"""


def _feeds(*icals):
    return [{"name": c.get("name") or "Calendar", "url": c["url"], "color": c.get("color"), "email": c.get("email")} for c in icals]


def test_events_for_day_expands_recurrence_and_skips_cancelled(tmp_path, monkeypatch):
    feeds = _feeds({"name": "Personal", "url": "https://example.test/a.ics", "color": "#1100ff"})
    monkeypatch.setattr(calendar_events, "_download", lambda url: ICS)
    events, errors = calendar_events.events_for_day(date(2026, 10, 6), "Asia/Dhaka", feeds)
    assert errors == []
    assert [(e["title"], e["all_day"], e["start_min"], e["end_min"]) for e in events] == [
        ("Holiday", True, None, None),
        ("Team sync", False, 9 * 60 + 30, 10 * 60),
        ("Weekly review", False, 14 * 60, 15 * 60),  # 08:00Z = 14:00 in Dhaka
    ]
    assert events[1]["calendar"] == "Personal" and events[1]["color"] == "#1100ff"


def test_one_broken_calendar_is_reported_without_its_url(tmp_path, monkeypatch):
    feeds = _feeds(
                  {"name": "Broken", "url": "https://secret.test/private-token/basic.ics"},
                  {"name": "Personal", "url": "https://example.test/a.ics"})

    def download(url):
        if "secret" in url:
            raise ConnectionError("boom")
        return ICS

    monkeypatch.setattr(calendar_events, "_download", download)
    events, errors = calendar_events.events_for_day(date(2026, 10, 6), "Asia/Dhaka", feeds)
    assert errors == ["Broken: ConnectionError"]
    assert len(events) == 3


def test_no_feeds_means_no_events():
    assert calendar_events.events_for_day(date(2026, 10, 6), "Asia/Dhaka", []) == ([], [])


def test_meeting_url_finds_only_known_https_meeting_hosts():
    assert calendar_events.meeting_url(None, "Join https://us02web.zoom.us/j/123?pwd=abc.") == "https://us02web.zoom.us/j/123?pwd=abc"
    assert calendar_events.meeting_url("https://meet.google.com/abc-defg-hij") == "https://meet.google.com/abc-defg-hij"
    assert calendar_events.meeting_url("http://zoom.us/j/1") is None  # not https
    assert calendar_events.meeting_url("https://evil.example/zoom.us/j/1", "javascript:alert(1)") is None
    assert calendar_events.meeting_url(None, "") is None


def test_google_event_carries_its_meet_link_and_a_zoom_link_from_the_description():
    from datetime import datetime, time as clock
    from zoneinfo import ZoneInfo
    zone = ZoneInfo("Asia/Dhaka")
    day_start = datetime.combine(date(2026, 10, 6), clock.min, zone)
    source = {"name": "Me", "color": None}
    base = {"summary": "Standup", "start": {"dateTime": "2026-10-06T09:30:00+06:00"}, "end": {"dateTime": "2026-10-06T10:00:00+06:00"}}
    meet = calendar_events._google_entry({**base, "hangoutLink": "https://meet.google.com/abc-defg-hij"}, source, zone, day_start)
    assert meet["meeting_url"] == "https://meet.google.com/abc-defg-hij"
    zoom = calendar_events._google_entry({**base, "description": "Link: https://zoom.us/j/99"}, source, zone, day_start)
    assert zoom["meeting_url"] == "https://zoom.us/j/99"
    assert calendar_events._google_entry(base, source, zone, day_start)["meeting_url"] is None
