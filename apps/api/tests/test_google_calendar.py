import json
from datetime import date, datetime, timedelta
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import pytest
from httpx import AsyncClient
from jose import jwt

from app.core.config import settings
from app.services import google_calendar, vault_calendar

API = "/api/v1/vault"
TZ = ZoneInfo("Asia/Dhaka")


@pytest.fixture(autouse=True)
def google_env(monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "csecret")
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
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
    assert q["redirect_uri"] == ["https://niyyah-api.alamin.rocks/api/v1/vault/calendar/google/callback"]
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
async def test_unconfigured_and_non_owner(auth_client: AsyncClient, monkeypatch):
    monkeypatch.setattr(settings, "google_client_secret", "")
    assert (await auth_client.get(f"{API}/calendar/google/status")).json()["configured"] is False
    assert (await auth_client.get(f"{API}/calendar/google/connect")).status_code == 409
    monkeypatch.setattr(settings, "vault_write_emails", "")
    assert (await auth_client.get(f"{API}/calendar/google/status")).status_code == 403


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
    assert r.json() == {"title": "Dentist", "calendar": "Google Calendar", "color": None, "all_day": False, "location": "Clinic", "meeting_url": None, "start_min": 840, "end_min": 930}
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
async def test_get_events_reads_google_for_the_connected_email(auth_client: AsyncClient, monkeypatch, tmp_path):
    await _connect(auth_client, monkeypatch)
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))
    monkeypatch.setattr(google_calendar, "access_token", lambda refresh: "at")
    monkeypatch.setattr(google_calendar, "list_events", lambda token, s, e: [{"summary": "Fresh", "start": {"dateTime": "2026-10-06T09:00:00+06:00"}, "end": {"dateTime": "2026-10-06T10:00:00+06:00"}}])
    _vault(tmp_path, {"name": "Me", "url": "https://example.test/me.ics", "email": "ME@gmail.com", "color": "#123456"})
    monkeypatch.setattr(vault_calendar, "_download", lambda url: pytest.fail("ICS must not be read"))
    body = (await auth_client.get(f"{API}/day/2026-10-06/events")).json()
    assert body["errors"] == [] and [(e["title"], e["color"], e["start_min"]) for e in body["events"]] == [("Fresh", "#123456", 540)]


# --- events_for_day seam ---------------------------------------------------------------------------------------

def _vault(tmp_path, *icals):
    path = tmp_path / vault_calendar.SETTINGS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"icals": list(icals)}))
    return tmp_path


ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:k
DTSTART;TZID=Asia/Dhaka:20261006T120000
DTEND;TZID=Asia/Dhaka:20261006T130000
SUMMARY:Kahf standup
END:VEVENT
END:VCALENDAR
"""


def test_events_for_day_uses_google_for_matching_email_and_ics_for_others(tmp_path, monkeypatch):
    root = _vault(tmp_path,
                  {"name": "Personal", "url": "https://example.test/p.ics", "email": "me@gmail.com", "color": "#111111"},
                  {"name": "Kahf", "url": "https://example.test/k.ics", "email": "me@kahf.co", "color": "#222222"})
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS if "k.ics" in url else pytest.fail("Personal must not use ICS"))
    items = [
        {"summary": "Dentist", "location": "Clinic", "start": {"dateTime": "2026-10-06T14:00:00+06:00"}, "end": {"dateTime": "2026-10-06T15:00:00+06:00"}},
        {"summary": "Eid", "start": {"date": "2026-10-06"}, "end": {"date": "2026-10-07"}},
        {"summary": "Dropped", "status": "cancelled", "start": {"dateTime": "2026-10-06T16:00:00+06:00"}, "end": {"dateTime": "2026-10-06T17:00:00+06:00"}},
    ]
    events, errors = vault_calendar.events_for_day(root, date(2026, 10, 6), "Asia/Dhaka", ("Me@Gmail.com", lambda s, e: items))
    assert errors == []
    assert [(e["title"], e["calendar"], e["all_day"], e["start_min"], e["end_min"], e["location"]) for e in events] == [
        ("Eid", "Personal", True, None, None, None),
        ("Kahf standup", "Kahf", False, 720, 780, None),
        ("Dentist", "Personal", False, 840, 900, "Clinic"),
    ]


def test_google_listing_failure_names_only_the_calendar(tmp_path):
    root = _vault(tmp_path, {"name": "Personal", "url": "https://example.test/p.ics", "email": "me@gmail.com"})

    def boom(s, e):
        raise google_calendar.GoogleCalendarError("secret detail")

    assert vault_calendar.events_for_day(root, date(2026, 10, 6), "Asia/Dhaka", ("me@gmail.com", boom)) == ([], ["Personal: GoogleCalendarError"])
