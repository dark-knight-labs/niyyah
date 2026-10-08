from datetime import date

import pytest
from sqlalchemy import select

from app.models.planner import PlannerCalendarFeed
from app.services import vault_calendar
from tests.conftest import TestSession

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1
DTSTART:20261007T060000Z
DTEND:20261007T070000Z
SUMMARY:Standup
LOCATION:https://meet.google.com/abc-defg-hij
END:VEVENT
END:VCALENDAR
"""


def test_events_for_day_uses_the_given_feeds_instead_of_the_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS)
    feeds = [{"name": "Work", "url": "https://example.com/a.ics", "color": "#00f", "email": None}]
    events, errors = vault_calendar.events_for_day(tmp_path, date(2026, 10, 7), "UTC", None, feeds)
    assert errors == [] and [e["title"] for e in events] == ["Standup"]
    assert events[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"


@pytest.mark.asyncio
async def test_events_endpoint_reads_the_users_feeds_in_db_mode(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS)
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=1, name="Work", url="https://example.com/a.ics", color=None, email=None, position=0))
        await db.commit()
    res = await client.get("/api/v1/vault/day/2026-10-07/events")
    assert res.status_code == 200 and [e["title"] for e in res.json()["events"]] == ["Standup"]


@pytest.mark.asyncio
async def test_google_status_is_open_to_any_user_in_db_mode(db_client):
    client, today = db_client
    res = await client.get("/api/v1/vault/calendar/google/status")
    assert res.status_code == 200 and res.json()["connected"] is False
