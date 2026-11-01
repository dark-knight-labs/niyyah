"""Event keys (what an overlay is matched by) and the range reader: one parse per feed, one Google listing per range."""
from datetime import date

import pytest

from app.services import calendar_events, google_calendar

TZ = "Asia/Dhaka"
MON = date(2026, 10, 5)
SUN = date(2026, 10, 18)

FEED = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:weekly@x
DTSTART;TZID=Asia/Dhaka:20261005T090000
DTEND;TZID=Asia/Dhaka:20261005T100000
RRULE:FREQ=WEEKLY
SUMMARY:Weekly review
END:VEVENT
BEGIN:VEVENT
UID:weekly@x
RECURRENCE-ID;TZID=Asia/Dhaka:20261012T090000
DTSTART;TZID=Asia/Dhaka:20261013T150000
DTEND;TZID=Asia/Dhaka:20261013T160000
SUMMARY:Weekly review (moved)
END:VEVENT
BEGIN:VEVENT
UID:once@x
DTSTART:20261006T030000Z
DTEND:20261006T040000Z
SUMMARY:Dentist
END:VEVENT
BEGIN:VEVENT
UID:fast@x
DTSTART;VALUE=DATE:20261005
DTEND;VALUE=DATE:20261006
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Fasting
END:VEVENT
BEGIN:VEVENT
UID:float@x
DTSTART:20261007T090000
DTEND:20261007T100000
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Floating
END:VEVENT
BEGIN:VEVENT
DTSTART:20261006T110000Z
DTEND:20261006T113000Z
SUMMARY:No uid
END:VEVENT
BEGIN:VEVENT
UID:trip@x
DTSTART;TZID=Asia/Dhaka:20261008T200000
DTEND;TZID=Asia/Dhaka:20261010T080000
SUMMARY:Trip
END:VEVENT
END:VCALENDAR
"""

# The same calendar after the user moved the one-off Dentist to the next day.
MOVED_ONE_OFF = FEED.replace(b"DTSTART:20261006T030000Z\nDTEND:20261006T040000Z", b"DTSTART:20261007T030000Z\nDTEND:20261007T040000Z")


def _feed(name="Personal", url="https://example.test/p.ics", email=None):
    return {"name": name, "url": url, "color": None, "email": email}


@pytest.fixture(autouse=True)
def fresh_cache():
    calendar_events._parsed.clear()
    yield
    calendar_events._parsed.clear()


def _read(monkeypatch, body=FEED, feeds=None, google=None, first=MON, last=SUN):
    monkeypatch.setattr(calendar_events, "_download", lambda url: body)
    return calendar_events.events_for_range(first, last, TZ, feeds or [_feed()], google)


def _by_title(read, title):
    return [e for e in read.events if e["title"] == title]


def test_weekly_occurrences_have_distinct_stable_keys(monkeypatch):
    first = _read(monkeypatch)
    weekly = _by_title(first, "Weekly review")
    assert [(e["day"], e["key"]) for e in weekly] == [(MON, "weekly@x|20261005T030000Z")]  # 09:00 Dhaka = 03:00Z
    calendar_events._parsed.clear()
    again = _read(monkeypatch)
    assert [e["key"] for e in _by_title(again, "Weekly review")] == [e["key"] for e in weekly]
    assert weekly[0]["uid"] == "weekly@x" and weekly[0]["instance"] == "20261005T030000Z"


def test_a_moved_occurrence_keeps_the_key_of_its_original_start(monkeypatch):
    moved = _by_title(_read(monkeypatch), "Weekly review (moved)")
    assert [(e["day"], e["start_min"], e["key"]) for e in moved] == [(date(2026, 10, 13), 900, "weekly@x|20261012T030000Z")]


def test_a_one_off_is_keyed_by_uid_only_and_keeps_it_when_moved(monkeypatch):
    before = _by_title(_read(monkeypatch), "Dentist")
    calendar_events._parsed.clear()
    after = _by_title(_read(monkeypatch, MOVED_ONE_OFF), "Dentist")
    assert [(e["day"], e["key"], e["instance"]) for e in before] == [(date(2026, 10, 6), "once@x", None)]
    assert [(e["day"], e["key"]) for e in after] == [(date(2026, 10, 7), "once@x")]


def test_all_day_and_floating_occurrences(monkeypatch):
    read = _read(monkeypatch)
    assert [e["key"] for e in _by_title(read, "Fasting")] == ["fast@x|20261005", "fast@x|20261006", "fast@x|20261007"]
    floating = _by_title(read, "Floating")
    assert [(e["key"], e["start_min"]) for e in floating] == [("float@x|20261007T090000", 540), ("float@x|20261008T090000", 540)]


def test_an_event_without_uid_gets_the_weaker_title_key(monkeypatch):
    (entry,) = _by_title(_read(monkeypatch), "No uid")
    assert entry["uid"] is None and entry["key"] == "t|No uid|2026-10-06|1020"  # 11:00Z = 17:00 Dhaka


def test_a_multi_day_event_is_one_entry_per_day_with_one_key(monkeypatch):
    trip = _by_title(_read(monkeypatch), "Trip")
    assert [(e["day"], e["start_min"], e["end_min"]) for e in trip] == [
        (date(2026, 10, 8), 1200, 1440), (date(2026, 10, 9), 0, 1440), (date(2026, 10, 10), 0, 480)]
    assert {e["key"] for e in trip} == {"trip@x"}


def test_events_for_day_is_the_range_reader_for_one_day(monkeypatch):
    monkeypatch.setattr(calendar_events, "_download", lambda url: FEED)
    day = date(2026, 10, 9)
    events, errors = calendar_events.events_for_day(day, TZ, [_feed()])
    calendar_events._parsed.clear()
    ranged = [e for e in _read(monkeypatch).events if e["day"] == day]
    assert errors == [] and events == ranged and [e["title"] for e in events] == ["Trip"]


def test_the_same_occurrence_has_the_same_key_through_ical_and_google(monkeypatch):
    """Google's export of a series and its Calendar API listing must meet on one key, whatever offset each one writes."""
    google_item = {"id": "abc_20261005T030000Z", "iCalUID": "weekly@x", "recurringEventId": "abc", "summary": "Weekly review",
                   "originalStartTime": {"dateTime": "2026-10-05T09:00:00+06:00", "timeZone": "Asia/Dhaka"},
                   "start": {"dateTime": "2026-10-05T09:00:00+06:00"}, "end": {"dateTime": "2026-10-05T10:00:00+06:00"}}
    google_allday = {"id": "f_20261006", "iCalUID": "fast@x", "recurringEventId": "f", "summary": "Fasting",
                     "originalStartTime": {"date": "2026-10-06"}, "start": {"date": "2026-10-06"}, "end": {"date": "2026-10-07"}}
    google_once = {"id": "o", "iCalUID": "once@x", "summary": "Dentist",
                   "start": {"dateTime": "2026-10-06T03:00:00Z"}, "end": {"dateTime": "2026-10-06T04:00:00Z"}}
    via_google = calendar_events.events_for_range(MON, SUN, TZ, [_feed(email="me@gmail.com")],
                                                  ("me@gmail.com", lambda s, e: [google_item, google_allday, google_once]))
    via_ical = _read(monkeypatch)
    google_keys = {e["key"] for e in via_google.events}
    assert google_keys == {"weekly@x|20261005T030000Z", "fast@x|20261006", "once@x"}
    assert google_keys <= {e["key"] for e in via_ical.events}
    assert next(e for e in via_google.events if e["title"] == "Weekly review")["id"] == "abc_20261005T030000Z"


def test_each_feed_is_parsed_once_per_range_and_a_broken_one_is_isolated(monkeypatch):
    parsed = []
    real = calendar_events.icalendar.Calendar.from_ical
    monkeypatch.setattr(calendar_events.icalendar.Calendar, "from_ical", lambda body: parsed.append(1) or real(body))

    def download(url):
        if "broken" in url:
            raise ConnectionError("private detail")
        return FEED if "a.ics" in url else FEED.replace(b"@x", b"@y")

    monkeypatch.setattr(calendar_events, "_download", download)
    feeds = [_feed("A", "https://example.test/a.ics"), _feed("Broken", "https://secret.test/broken.ics"), _feed("B", "https://example.test/b.ics")]
    read = calendar_events.events_for_range(MON, SUN, TZ, feeds)
    assert len(parsed) == 2  # A and B, once each, for all 14 days
    assert read.errors == ["Broken: ConnectionError"]
    assert {e["calendar"] for e in read.events} == {"A", "B"}
    assert "weekly@x" in read.uids and "weekly@y" in read.uids


def test_google_is_listed_once_for_the_whole_range():
    calls = []
    calendar_events.events_for_range(MON, SUN, TZ, [_feed(email="me@gmail.com")], ("me@gmail.com", lambda s, e: calls.append((s, e)) or []))
    assert len(calls) == 1
    start, end = calls[0]
    assert start.isoformat() == "2026-10-05T00:00:00+06:00" and end.isoformat() == "2026-10-19T00:00:00+06:00"


def test_list_events_follows_page_tokens_up_to_the_cap(monkeypatch):
    sent = []

    def api(method, token, event_id=None, **kw):
        sent.append(kw["params"].get("pageToken"))
        n = len(sent)
        return {"items": [{"id": f"e{n}"}], "nextPageToken": f"p{n}"}

    monkeypatch.setattr(google_calendar, "_api", api)
    from datetime import datetime
    items = google_calendar.list_events("tok", datetime(2026, 10, 5), datetime(2026, 10, 19))
    assert sent == [None, "p1", "p2", "p3", "p4"] and len(items) == google_calendar.MAX_PAGES

    sent.clear()
    monkeypatch.setattr(google_calendar, "_api", lambda method, token, event_id=None, **kw: sent.append(1) or {"items": [{"id": "x"}]})
    assert google_calendar.list_events("tok", datetime(2026, 10, 5), datetime(2026, 10, 19)) == [{"id": "x"}] and sent == [1]
