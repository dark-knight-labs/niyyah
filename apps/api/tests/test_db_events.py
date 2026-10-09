from datetime import date

import pytest
from sqlalchemy import select

from app.models.planner import PlannerCalendarFeed
from app.services import calendar_events
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


def test_events_for_day_reads_the_given_feeds(monkeypatch):
    monkeypatch.setattr(calendar_events, "_download", lambda url: ICS)
    feeds = [{"name": "Work", "url": "https://example.com/a.ics", "color": "#00f", "email": None}]
    events, errors = calendar_events.events_for_day(date(2026, 10, 7), "UTC", feeds)
    assert errors == [] and [e["title"] for e in events] == ["Standup"]
    assert events[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"


@pytest.mark.asyncio
async def test_events_endpoint_reads_the_users_feeds(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(calendar_events, "_download", lambda url: ICS)
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
