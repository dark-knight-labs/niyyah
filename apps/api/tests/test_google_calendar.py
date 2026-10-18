from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from jose import jwt

from app.core.config import settings
from app.services import google_calendar, calendar_events

API = "/api/v1/vault"
TZ = ZoneInfo("Asia/Dhaka")


@pytest.fixture(autouse=True)
def google_env(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "csecret")
    monkeypatch.setattr(settings, "app_timezone", "Asia/Dhaka")
    monkeypatch.setattr(settings, "api_public_url", "https://api.example.com")
    monkeypatch.setattr(settings, "web_public_url", "https://app.example.com")
    google_calendar._access.clear()


def _today() -> str:
    return datetime.now(TZ).date().isoformat()


async def _connect(auth_client: AsyncClient, monkeypatch, email="me@gmail.com"):
    user_id = (await auth_client.get("/api/v1/auth/me")).json()["id"]
    monkeypatch.setattr(google_calendar, "exchange_code", lambda code: ("refresh-1", email))
    r = await auth_client.get(f"{API}/calendar/google/callback", params={"code": "c", "state": google_calendar.make_state(user_id)}, follow_redirects=False)
    assert r.headers["location"].endswith("/?calendar=connected")


# --- status / connect / callback -------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_status_connect_and_callback(auth_client: AsyncClient, monkeypatch):
    assert (await auth_client.get(f"{API}/calendar/google/status")).json() == {"configured": True, "connected": False, "email": None}

    url = (await auth_client.get(f"{API}/calendar/google/connect")).json()["url"]
    q = parse_qs(urlparse(url).query)
    assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"] and q["client_id"] == ["cid"]
    assert q["scope"] == ["https://www.googleapis.com/auth/calendar.events openid email"]
    assert q["redirect_uri"] == ["https://api.example.com/api/v1/vault/calendar/google/callback"]
    assert jwt.decode(q["state"][0], settings.secret_key, algorithms=["HS256"])["purpose"] == "google-calendar"

    await _connect(auth_client, monkeypatch)
    assert (await auth_client.get(f"{API}/calendar/google/status")).json() == {"configured": True, "connected": True, "email": "me@gmail.com"}
    await _connect(auth_client, monkeypatch, email="new@gmail.com")  # replaces, does not duplicate
    assert (await auth_client.get(f"{API}/calendar/google/status")).json()["email"] == "new@gmail.com"


@pytest.mark.asyncio
async def test_callback_rejects_bad_state_and_failed_exchange(auth_client: AsyncClient, monkeypatch):
    def fail(code):
        raise google_calendar.GoogleCalendarError("nope")

    monkeypatch.setattr(google_calendar, "exchange_code", fail)
    user_id = (await auth_client.get("/api/v1/auth/me")).json()["id"]
    for params in (
        {"code": "c", "state": "garbage"},
        {"code": "c", "state": jwt.encode({"sub": str(user_id), "purpose": "other"}, settings.secret_key, algorithm="HS256")},
        {"code": "c", "state": google_calendar.make_state(user_id)},  # valid state, Google refuses
        {"state": google_calendar.make_state(user_id)},  # user denied: no code
    ):
        r = await auth_client.get(f"{API}/calendar/google/callback", params=params, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"].endswith("/?calendar=error")
    assert (await auth_client.get(f"{API}/calendar/google/status")).json()["connected"] is False


@pytest.mark.asyncio
async def test_unconfigured(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "google_client_secret", "")
    assert (await auth_client.get(f"{API}/calendar/google/status")).json()["configured"] is False
    assert (await auth_client.get(f"{API}/calendar/google/connect")).status_code == 409


# --- insert_event / access_token -------------------------------------------------------------------------------

def test_insert_event_payload(monkeypatch):
    sent = {}

    def fake(method, token, **kwargs):
        sent.update(method=method, token=token, **kwargs)
        return {"id": "x"}

    monkeypatch.setattr(google_calendar, "_api", fake)
    start = datetime(2026, 10, 7, 14, 0, tzinfo=TZ)
    google_calendar.insert_event("tok", "Dentist", start, start + timedelta(hours=1), "Asia/Dhaka", "Clinic")
    assert sent["method"] == "POST" and sent["token"] == "tok"
    assert sent["json"] == {
        "summary": "Dentist",
        "start": {"dateTime": "2026-10-07T14:00:00+06:00", "timeZone": "Asia/Dhaka"},
        "end": {"dateTime": "2026-10-07T15:00:00+06:00", "timeZone": "Asia/Dhaka"},
        "location": "Clinic",
    }


def test_access_token_is_cached(monkeypatch):
    calls = []

    def fake(data):
        calls.append(data)
        return {"access_token": "at", "expires_in": 3600}

    monkeypatch.setattr(google_calendar, "_token_request", fake)
    assert google_calendar.access_token("r") == "at" and google_calendar.access_token("r") == "at"
    assert len(calls) == 1 and calls[0]["grant_type"] == "refresh_token"


# --- POST /day/{day}/events ------------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_post_event_validation_and_not_connected(auth_client: AsyncClient):
    today = _today()
    url = f"{API}/day/{today}/events"
    ok = {"title": "Dentist", "start": "14:00", "end": "15:00"}
    assert (await auth_client.post(url, json={**ok, "end": "14:00"})).status_code == 422
    assert (await auth_client.post(url, json={**ok, "end": "13:00"})).status_code == 422
    assert (await auth_client.post(url, json={**ok, "title": ""})).status_code == 422
    assert (await auth_client.post(url, json={**ok, "start": "9:00"})).status_code == 422
    assert (await auth_client.post(url, json={**ok, "location": "x" * 201})).status_code == 422
    yesterday = (datetime.now(TZ).date() - timedelta(days=1)).isoformat()
    assert (await auth_client.post(f"{API}/day/{yesterday}/events", json=ok)).status_code == 422
    far = (datetime.now(TZ).date() + timedelta(days=61)).isoformat()
    assert (await auth_client.post(f"{API}/day/{far}/events", json=ok)).status_code == 422
    r = await auth_client.post(url, json=ok)
    assert r.status_code == 409 and "Connect Google Calendar" in r.json()["detail"]


@pytest.mark.asyncio
async def test_post_event_creates_and_returns_entry(auth_client: AsyncClient, monkeypatch):
    await _connect(auth_client, monkeypatch)
    seen = {}
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")
    monkeypatch.setattr(google_calendar, "insert_event", lambda *a: seen.setdefault("args", a))
    r = await auth_client.post(f"{API}/day/{_today()}/events", json={"title": " Dentist ", "start": "14:00", "end": "15:30", "location": "Clinic"})
    assert r.status_code == 200, r.text
    assert r.json() == {"id": None, "title": "Dentist", "calendar": "Google Calendar", "color": None, "all_day": False, "location": "Clinic", "meeting_url": None, "start_min": 840, "end_min": 930}
    token, title, start, end, tz, location = seen["args"]
    assert (token, title, tz, location) == ("at", "Dentist", "Asia/Dhaka", "Clinic")
    assert start.hour == 14 and end.minute == 30 and start.tzinfo is not None


@pytest.mark.asyncio
async def test_post_event_google_failure_is_a_clean_502(auth_client: AsyncClient, monkeypatch):
    await _connect(auth_client, monkeypatch)
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")

    def boom(*a):
        raise google_calendar.GoogleCalendarError("Google Calendar request failed (HTTPStatusError)")

    monkeypatch.setattr(google_calendar, "insert_event", boom)
    r = await auth_client.post(f"{API}/day/{_today()}/events", json={"title": "x", "start": "14:00", "end": "15:00"})
    assert r.status_code == 502 and "refresh-1" not in r.text


@pytest.mark.asyncio
async def test_get_events_reads_google_for_the_connected_email(auth_client: AsyncClient, monkeypatch):
    await _connect(auth_client, monkeypatch)
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")
    monkeypatch.setattr(google_calendar, "list_events", lambda token, s, e: [{"summary": "Fresh", "start": {"dateTime": "2026-10-06T09:00:00+06:00"}, "end": {"dateTime": "2026-10-06T10:00:00+06:00"}}])
    from app.models.planner import PlannerCalendarFeed
    from tests.conftest import TestSession
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=(await auth_client.get("/api/v1/auth/me")).json()["id"], name="Me", url="https://example.test/me.ics",
                                   email="ME@gmail.com", color="#123456", position=0))
        await db.commit()
    monkeypatch.setattr(calendar_events, "_download", lambda url: pytest.fail("ICS must not be read"))
    body = (await auth_client.get(f"{API}/day/2026-10-06/events")).json()
    assert body["errors"] == [] and [(e["title"], e["color"], e["start_min"]) for e in body["events"]] == [("Fresh", "#123456", 540)]


# --- events_for_day seam ---------------------------------------------------------------------------------------

def _feeds(*icals):
    return [{"name": c.get("name") or "Calendar", "url": c["url"], "color": c.get("color"), "email": c.get("email")} for c in icals]


ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:k
DTSTART;TZID=Asia/Dhaka:20261006T120000
DTEND;TZID=Asia/Dhaka:20261006T130000
SUMMARY:Studio standup
END:VEVENT
END:VCALENDAR
"""


def test_events_for_day_uses_google_for_matching_email_and_ics_for_others(monkeypatch):
    feeds = _feeds(
                  {"name": "Personal", "url": "https://example.test/p.ics", "email": "me@gmail.com", "color": "#111111"},
                  {"name": "Studio", "url": "https://example.test/k.ics", "email": "me@studio.co", "color": "#222222"})
    monkeypatch.setattr(calendar_events, "_download", lambda url: ICS if "k.ics" in url else pytest.fail("Personal must not use ICS"))
    items = [
        {"summary": "Dentist", "location": "Clinic", "start": {"dateTime": "2026-10-06T14:00:00+06:00"}, "end": {"dateTime": "2026-10-06T15:00:00+06:00"}},
        {"summary": "Eid", "start": {"date": "2026-10-06"}, "end": {"date": "2026-10-07"}},
        {"summary": "Dropped", "status": "cancelled", "start": {"dateTime": "2026-10-06T16:00:00+06:00"}, "end": {"dateTime": "2026-10-06T17:00:00+06:00"}},
    ]
    events, errors = calendar_events.events_for_day(date(2026, 10, 6), "Asia/Dhaka", feeds, ("Me@Gmail.com", lambda s, e: items))
    assert errors == []
    assert [(e["title"], e["calendar"], e["all_day"], e["start_min"], e["end_min"], e["location"]) for e in events] == [
        ("Eid", "Personal", True, None, None, None),
        ("Studio standup", "Studio", False, 720, 780, None),
        ("Dentist", "Personal", False, 840, 900, "Clinic"),
    ]


def test_google_listing_failure_names_only_the_calendar():
    feeds = _feeds({"name": "Personal", "url": "https://example.test/p.ics", "email": "me@gmail.com"})

    def boom(s, e):
        raise google_calendar.GoogleCalendarError("secret detail")

    assert calendar_events.events_for_day(date(2026, 10, 6), "Asia/Dhaka", feeds, ("me@gmail.com", boom)) == ([], ["Personal: GoogleCalendarError"])


# --- expired consent, move and delete ----------------------------------------------------------------------------

class _Res:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body

    def json(self):
        return self._body

    def raise_for_status(self):
        raise AssertionError("a handled status must not reach raise_for_status")


def test_revoked_refresh_token_is_reported_as_expired(monkeypatch):
    monkeypatch.setattr(google_calendar.httpx, "post", lambda *a, **k: _Res(400, {"error": "invalid_grant", "error_description": "Token has been expired or revoked."}))
    with pytest.raises(google_calendar.GoogleAuthExpired) as err:
        google_calendar.access_token("dead")
    assert "Reconnect" in str(err.value) and "dead" not in str(err.value)


def test_expired_google_feed_shows_reconnect_in_errors(monkeypatch):
    def dead(start, end):
        raise google_calendar.GoogleAuthExpired()

    feeds = [{"name": "Personal", "url": "https://x", "color": None, "email": "me@gmail.com"}]
    events, errors = calendar_events.events_for_day(date(2026, 10, 18), "Asia/Dhaka", feeds, ("me@gmail.com", dead))
    assert events == [] and errors == ["Personal: Google connection expired. Reconnect Google Calendar."]


def test_google_entry_carries_the_event_id():
    zone = ZoneInfo("Asia/Dhaka")
    item = {"id": "abc123", "summary": "Dentist", "start": {"dateTime": "2026-10-18T14:00:00+06:00"}, "end": {"dateTime": "2026-10-18T15:00:00+06:00"}}
    entry = calendar_events._google_entry(item, {"name": "Personal", "color": None}, zone, datetime(2026, 10, 18, tzinfo=zone))
    assert entry["id"] == "abc123" and entry["start_min"] == 840


def test_move_event_payloads(monkeypatch):
    sent = []
    monkeypatch.setattr(google_calendar, "_api", lambda method, token, event_id=None, **kw: sent.append((method, token, event_id, kw)) or {})
    start = datetime(2026, 10, 20, 9, 30, tzinfo=TZ)
    google_calendar.move_event("tok", "ev/1", start, start + timedelta(hours=1), "Asia/Dhaka")
    google_calendar.move_event("tok", "ev2", date(2026, 10, 21), date(2026, 10, 22), "Asia/Dhaka")
    google_calendar.delete_event("tok", "ev3")
    assert sent[0] == ("PATCH", "tok", "ev/1", {"json": {"start": {"dateTime": "2026-10-20T09:30:00+06:00", "timeZone": "Asia/Dhaka"}, "end": {"dateTime": "2026-10-20T10:30:00+06:00", "timeZone": "Asia/Dhaka"}}})
    assert sent[1][3]["json"] == {"start": {"date": "2026-10-21"}, "end": {"date": "2026-10-22"}}
    assert sent[2] == ("DELETE", "tok", "ev3", {})


@pytest.mark.asyncio
async def test_move_and_delete_routes(auth_client: AsyncClient, monkeypatch):
    url = f"{API}/events/ev1"
    body = {"day": "2026-10-20", "start": "09:30", "end": "10:30"}
    assert (await auth_client.put(url, json=body)).status_code == 409  # not connected
    await _connect(auth_client, monkeypatch)
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")
    seen = []
    monkeypatch.setattr(google_calendar, "move_event", lambda *a: seen.append(("move", a)))
    monkeypatch.setattr(google_calendar, "delete_event", lambda *a: seen.append(("delete", a)))

    assert (await auth_client.put(url, json={**body, "end": "09:30"})).status_code == 422
    assert (await auth_client.put(url, json={"day": "2026-10-20", "start": "09:30"})).status_code == 422
    assert (await auth_client.put(url, json=body)).json() == {"ok": True}
    assert (await auth_client.put(url, json={"day": "2026-10-21"})).json() == {"ok": True}
    assert (await auth_client.delete(url)).json() == {"ok": True}
    kinds = [k for k, _ in seen]
    assert kinds == ["move", "move", "delete"]
    timed, allday = seen[0][1], seen[1][1]
    assert timed[1] == "ev1" and timed[2] == datetime(2026, 10, 20, 9, 30, tzinfo=TZ) and timed[3] == datetime(2026, 10, 20, 10, 30, tzinfo=TZ)
    assert allday[2] == date(2026, 10, 21) and allday[3] == date(2026, 10, 22)


@pytest.mark.asyncio
async def test_move_reports_expired_consent(auth_client: AsyncClient, monkeypatch):
    await _connect(auth_client, monkeypatch)

    def dead(refresh):
        raise google_calendar.GoogleAuthExpired()

    monkeypatch.setattr(google_calendar, "access_token", dead)
    r = await auth_client.put(f"{API}/events/ev1", json={"day": "2026-10-20", "start": "09:30", "end": "10:30"})
    assert r.status_code == 502 and "Reconnect" in r.json()["detail"]
