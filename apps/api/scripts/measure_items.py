"""Latency of GET /vault/items (14 days, fixture feeds) and of the existing task tick (PUT /vault/tasks), in process.

    cd apps/api && APP_ENV=development PYTHONPATH=. .venv/bin/python scripts/measure_items.py [--n 50] [--task-put-only]

Runs the app against a throwaway SQLite file with the sample account (tests/sample_snapshot.py) and two feeds served from
memory: tests/fixtures/calendar.ics and a generated busy calendar (600 one-off events and 25 weekly series over the year).
"Cold" clears the parsed-feed cache before every request (a feed's first read in its 5-minute cache window); "warm" keeps it.
--task-put-only measures only the task tick, so the same script also runs against an older checkout (PYTHONPATH=<old apps/api>).
Budget: items p95 <= 800 ms; task tick p95 within +10% of the older checkout.
"""
import argparse
import asyncio
import os
import statistics
import sys
import tempfile
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

os.environ.setdefault("APP_ENV", "development")

FIXTURE = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "calendar.ics"


def busy_calendar(today: date) -> bytes:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//niyyah//measure//EN"]
    start = datetime.combine(today - timedelta(days=180), datetime.min.time(), timezone.utc)
    for n in range(600):
        at = start + timedelta(hours=14 * n)
        lines += ["BEGIN:VEVENT", f"UID:busy-{n}@measure", f"DTSTART:{at:%Y%m%dT%H%M%SZ}", f"DTEND:{at + timedelta(minutes=45):%Y%m%dT%H%M%SZ}",
                  f"SUMMARY:Meeting {n}", f"DESCRIPTION:https://zoom.us/j/{n}", "END:VEVENT"]
    for n in range(25):
        at = start + timedelta(days=n % 7, hours=8 + n % 9)
        lines += ["BEGIN:VEVENT", f"UID:series-{n}@measure", f"DTSTART:{at:%Y%m%dT%H%M%SZ}", f"DTEND:{at + timedelta(hours=1):%Y%m%dT%H%M%SZ}",
                  "RRULE:FREQ=WEEKLY", f"SUMMARY:Series {n}", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return ("\r\n".join(lines) + "\r\n").encode()


def p95(samples: list[float]) -> float:
    return statistics.quantiles(samples, n=20, method="inclusive")[18]


def report(name: str, samples: list[float]) -> None:
    print(f"{name:<34} n={len(samples):<3} p50={statistics.median(samples):7.1f} ms  p95={p95(samples):7.1f} ms  max={max(samples):7.1f} ms")


async def measure(n: int, task_put_only: bool, workdir: str) -> None:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from app.api.v1.vault import _local_now
    from app.core.database import Base, get_db
    from app.main import app
    from app.services import calendar_events

    engine = create_async_engine(f"sqlite+aiosqlite:///{workdir}/measure.db")
    sessions = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async def db_override():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = db_override
    today = _local_now().date()
    feeds = {"fixture.ics": FIXTURE.read_bytes(), "busy.ics": busy_calendar(today)}
    calendar_events._download = lambda url: next(body for part, body in feeds.items() if part in url)

    try:
        await _run(n, task_put_only, today, sessions)
    finally:
        await engine.dispose()


async def _run(n: int, task_put_only: bool, today: date, sessions) -> None:
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy import select

    from app.main import app
    from app.models.planner import PlannerCalendarFeed
    from app.models.user import User
    from app.schemas.snapshot import Snapshot
    from app.services import calendar_events
    from app.services.planner_import import import_snapshot
    from tests.sample_snapshot import sample_snapshot

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://measure") as client:
        await client.post("/api/v1/auth/register", json={"email": "m@niyyah.app", "password": "measurepass123"})
        token = (await client.post("/api/v1/auth/login", json={"email": "m@niyyah.app", "password": "measurepass123"})).json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
        async with sessions() as db:
            user_id = (await db.execute(select(User.id))).scalar_one()
            await import_snapshot(db, user_id, Snapshot.model_validate(sample_snapshot(today)))
            db.add_all([PlannerCalendarFeed(user_id=user_id, name="Fixture", url="https://example.test/fixture.ics", position=0),
                        PlannerCalendarFeed(user_id=user_id, name="Busy", url="https://example.test/busy.ics", position=1)])
            await db.commit()
        task_id = (await client.get(f"/api/v1/vault/day/{today}/tasks")).json()[0]["line"]

        async def timed(call) -> float:
            began = time.perf_counter()
            res = await call()
            elapsed = (time.perf_counter() - began) * 1000
            assert res.status_code == 200, res.text
            return elapsed

        print(f"python {sys.version.split()[0]}, app from {Path(sys.modules['app'].__file__ or '').parent.parent}, today {today}")
        puts = []
        for i in range(n + 5):
            ms = await timed(lambda: client.put("/api/v1/vault/tasks", json={"line": task_id, "done": i % 2 == 0}))
            if i >= 5:  # warm-up
                puts.append(ms)
        report("PUT /vault/tasks", puts)
        if task_put_only:
            return

        params = {"from": today.isoformat(), "to": (today + timedelta(days=13)).isoformat()}
        body = (await client.get("/api/v1/vault/items", params=params)).json()
        print(f"items in 14 days: {len(body['items'])} ({sum(i['kind'] == 'event' for i in body['items'])} events), errors={body['errors']}")
        for label, cold in (("GET /vault/items 14d (cold parse)", True), ("GET /vault/items 14d (warm)", False)):
            samples = []
            for i in range(n + 3):
                if cold:
                    calendar_events._parsed.clear()
                ms = await timed(lambda: client.get("/api/v1/vault/items", params=params))
                if i >= 3:
                    samples.append(ms)
            report(label, samples)


async def main(n: int, task_put_only: bool) -> None:
    with tempfile.TemporaryDirectory(prefix="niyyah-measure-") as workdir:
        await measure(n, task_put_only, workdir)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=50)
    parser.add_argument("--task-put-only", action="store_true")
    args = parser.parse_args()
    asyncio.run(main(args.n, args.task_put_only))
