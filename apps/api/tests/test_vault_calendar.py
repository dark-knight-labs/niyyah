import json
from datetime import date

from app.services import vault_calendar

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


def _vault(tmp_path, *icals):
    path = tmp_path / vault_calendar.SETTINGS_PATH
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps({"icals": list(icals)}))
    return tmp_path


def test_events_for_day_expands_recurrence_and_skips_cancelled(tmp_path, monkeypatch):
    root = _vault(tmp_path, {"name": "Personal", "url": "https://example.test/a.ics", "color": "#1100ff"})
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS)
    events, errors = vault_calendar.events_for_day(root, date(2026, 10, 6), "Asia/Dhaka")
    assert errors == []
    assert [(e["title"], e["all_day"], e["start_min"], e["end_min"]) for e in events] == [
        ("Holiday", True, None, None),
        ("Team sync", False, 9 * 60 + 30, 10 * 60),
        ("Weekly review", False, 14 * 60, 15 * 60),  # 08:00Z = 14:00 in Dhaka
    ]
    assert events[1]["calendar"] == "Personal" and events[1]["color"] == "#1100ff"


def test_one_broken_calendar_is_reported_without_its_url(tmp_path, monkeypatch):
    root = _vault(tmp_path,
                  {"name": "Broken", "url": "https://secret.test/private-token/basic.ics"},
                  {"name": "Personal", "url": "https://example.test/a.ics"})

    def download(url):
        if "secret" in url:
            raise ConnectionError("boom")
        return ICS

    monkeypatch.setattr(vault_calendar, "_download", download)
    events, errors = vault_calendar.events_for_day(root, date(2026, 10, 6), "Asia/Dhaka")
    assert errors == ["Broken: ConnectionError"]
    assert len(events) == 3


def test_no_day_planner_settings_means_no_calendars(tmp_path):
    assert vault_calendar.events_for_day(tmp_path, date(2026, 10, 6), "Asia/Dhaka") == ([], [])
