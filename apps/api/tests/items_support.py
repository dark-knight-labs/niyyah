"""Shared bits for the items tests: a feed built around a given day, and helpers to add feeds and read items."""
from datetime import date, timedelta

from app.models.planner import PlannerCalendarFeed
from app.services import calendar_events
from tests.conftest import TestSession

V = "/api/v1/vault"


def ics(today: date, *, moved: bool = False, one_off_day: date | None = None, drop_one_off: bool = False, uid_suffix: str = "") -> bytes:
    """A weekly 09:00 UTC series starting on `today`, a one-off on today+1 at 13:00 UTC, an all-day event on today.

    `moved` moves the series' second occurrence to the next day at 15:00; `one_off_day` moves the one-off."""
    d = lambda day: day.strftime("%Y%m%d")  # noqa: E731
    second = today + timedelta(days=7)
    one_off = one_off_day or today + timedelta(days=1)
    parts = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN",
        "BEGIN:VEVENT", f"UID:weekly{uid_suffix}@test", f"DTSTART:{d(today)}T090000Z", f"DTEND:{d(today)}T100000Z", "RRULE:FREQ=WEEKLY",
        "SUMMARY:Weekly review", "END:VEVENT",
        "BEGIN:VEVENT", f"UID:allday{uid_suffix}@test", f"DTSTART;VALUE=DATE:{d(today)}", f"DTEND;VALUE=DATE:{d(today + timedelta(days=1))}",
        "SUMMARY:Holiday", "END:VEVENT",
    ]
    if moved:
        parts += ["BEGIN:VEVENT", f"UID:weekly{uid_suffix}@test", f"RECURRENCE-ID:{d(second)}T090000Z",
                  f"DTSTART:{d(second + timedelta(days=1))}T150000Z", f"DTEND:{d(second + timedelta(days=1))}T160000Z",
                  "SUMMARY:Weekly review (moved)", "END:VEVENT"]
    if not drop_one_off:
        parts += ["BEGIN:VEVENT", f"UID:once{uid_suffix}@test", f"DTSTART:{d(one_off)}T130000Z", f"DTEND:{d(one_off)}T140000Z",
                  "SUMMARY:Dentist", "END:VEVENT"]
    parts.append("END:VCALENDAR")
    return ("\r\n".join(parts) + "\r\n").encode()


def serve(monkeypatch, bodies: dict[str, bytes | Exception]) -> None:
    """Make each feed URL (matched by substring) answer with a body, or fail with an exception."""
    calendar_events._parsed.clear()

    def download(url):
        for part, body in bodies.items():
            if part in url:
                if isinstance(body, Exception):
                    raise body
                return body
        raise AssertionError(f"unexpected feed {url}")

    monkeypatch.setattr(calendar_events, "_download", download)


async def add_feed(user_id: int, name: str, url: str, email: str | None = None) -> None:
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=user_id, name=name, url=url, color="#123456", email=email, position=0))
        await db.commit()


async def items(client, first: date, last: date | None = None, headers=None) -> dict:
    res = await client.get(f"{V}/items", params={"from": first.isoformat(), "to": (last or first).isoformat()}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def events(body: dict, title: str | None = None) -> list[dict]:
    return [i for i in body["items"] if i["kind"] == "event" and (title is None or i["title"] == title)]


def tasks(body: dict, title: str | None = None) -> list[dict]:
    return [i for i in body["items"] if i["kind"] == "task" and (title is None or i["title"] == title)]
