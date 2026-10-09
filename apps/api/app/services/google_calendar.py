"""Google Calendar over plain HTTPS (no SDK): one-time OAuth consent, then insert and list events on the primary calendar.

The refresh token is stored by the caller and only ever sent to Google. Errors raise GoogleCalendarError with a clean
message: never a token, a URL or Google's response body.
"""
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwt

from app.core.config import settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
SCOPES = "https://www.googleapis.com/auth/calendar.events openid email"
TIMEOUT = 10.0
STATE_MINUTES = 10
STATE_PURPOSE = "google-calendar"
EXPIRY_MARGIN = 60  # seconds: refresh the access token this long before Google would reject it

_access: dict[str, tuple[float, str]] = {}  # refresh token -> (monotonic expiry, access token)


class GoogleCalendarError(Exception):
    """Google refused or could not be reached. str() is safe to show the owner."""


def configured() -> bool:
    return bool(settings.google_client_id and settings.google_client_secret)


def redirect_uri() -> str:
    return f"{settings.api_public_url.rstrip('/')}/api/v1/vault/calendar/google/callback"


def make_state(user_id: int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=STATE_MINUTES)
    return jwt.encode({"sub": str(user_id), "purpose": STATE_PURPOSE, "exp": expire}, settings.secret_key, algorithm="HS256")


def read_state(state: str) -> int | None:
    """The user id a valid, unexpired state was issued for, else None."""
    try:
        claims = jwt.decode(state, settings.secret_key, algorithms=["HS256"])
        if claims.get("purpose") != STATE_PURPOSE:
            return None
        return int(claims["sub"])
    except (JWTError, KeyError, ValueError):
        return None


def build_auth_url(state: str) -> str:
    query = urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",  # always hand out a refresh token, even on re-connect
        "state": state,
    })
    return f"{AUTH_URL}?{query}"


def _token_request(data: dict) -> dict:
    try:
        res = httpx.post(TOKEN_URL, data={"client_id": settings.google_client_id, "client_secret": settings.google_client_secret, **data}, timeout=TIMEOUT)
        res.raise_for_status()
        return res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleCalendarError(f"Google sign-in failed ({type(exc).__name__})") from None


def exchange_code(code: str) -> tuple[str, str]:
    """(refresh_token, email) for the one-time consent code."""
    body = _token_request({"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri()})
    refresh = body.get("refresh_token")
    email = jwt.get_unverified_claims(body["id_token"]).get("email") if body.get("id_token") else None  # straight from Google over TLS
    if not refresh or not email:
        raise GoogleCalendarError("Google did not return a refresh token and email")
    return refresh, email


def access_token(refresh_token: str) -> str:
    hit = _access.get(refresh_token)
    if hit and time.monotonic() < hit[0]:
        return hit[1]
    body = _token_request({"refresh_token": refresh_token, "grant_type": "refresh_token"})
    token = body.get("access_token")
    if not token:
        raise GoogleCalendarError("Google did not return an access token")
    _access[refresh_token] = (time.monotonic() + int(body.get("expires_in", 3600)) - EXPIRY_MARGIN, token)
    return token


def _api(method: str, token: str, **kwargs) -> dict:
    try:
        res = httpx.request(method, EVENTS_URL, headers={"Authorization": f"Bearer {token}"}, timeout=TIMEOUT, **kwargs)
        res.raise_for_status()
        return res.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GoogleCalendarError(f"Google Calendar request failed ({type(exc).__name__})") from None


def insert_event(token: str, title: str, start: datetime, end: datetime, tz: str, location: str | None) -> dict:
    """Create the event on the primary calendar; start and end are timezone-aware."""
    body: dict = {
        "summary": title,
        "start": {"dateTime": start.isoformat(), "timeZone": tz},
        "end": {"dateTime": end.isoformat(), "timeZone": tz},
    }
    if location:
        body["location"] = location
    return _api("POST", token, json=body)


def list_events(token: str, day_start: datetime, day_end: datetime) -> list[dict]:
    """Events overlapping [day_start, day_end), recurrences expanded, in start order."""
    params = {"timeMin": day_start.isoformat(), "timeMax": day_end.isoformat(), "singleEvents": "true", "orderBy": "startTime", "maxResults": "250"}
    return _api("GET", token, params=params).get("items", [])
