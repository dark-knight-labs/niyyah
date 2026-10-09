"""Saving a user's schedule settings; validation mirrors what the web app can resolve."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncio
from urllib.parse import urlparse

from sqlalchemy import delete, func, select

from app.models.planner import Goal, PlannerBlock, PlannerCalendarFeed, PlannerScheduleBlock, PlannerScheduleSetting
from app.services.vault_calendar import check_public_url
from app.services.planner_defaults import STARTER_BLOCKS, STARTER_META, STARTER_WEEKDAY, STARTER_WEEKEND
from app.services.vault_schedule import _valid_time

METHODS = {"karachi", "mwl", "isna", "egyptian", "ummalqura", "dubai", "qatar", "kuwait", "singapore", "turkey", "tehran", "moonsighting"}
MADHABS = {"hanafi", "shafi"}
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _meta(meta: dict) -> dict:
    lat, lon = meta.get("lat"), meta.get("lon")
    if (lat is None) != (lon is None):
        raise ValueError("give both latitude and longitude, or neither")
    if lat is not None and not (-90 <= lat <= 90):
        raise ValueError("latitude must be between -90 and 90")
    if lon is not None and not (-180 <= lon <= 180):
        raise ValueError("longitude must be between -180 and 180")
    try:
        ZoneInfo(meta["tz"])
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError(f"unknown time zone '{meta.get('tz')}'")
    method = meta["method"].lower()
    if method not in METHODS:
        raise ValueError(f"unknown calculation method '{meta['method']}'")
    madhab = meta["madhab"].lower()
    if madhab not in MADHABS:
        raise ValueError(f"unknown madhab '{meta['madhab']}'")
    days = list(dict.fromkeys(meta["weekend_days"]))
    if any(d not in WEEKDAYS for d in days):
        raise ValueError("weekend days must be mon, tue, wed, thu, fri, sat or sun")
    if len(days) >= 7:
        raise ValueError("keep at least one weekday: not every day can be a weekend day")
    return {"city": (meta.get("city") or "").strip() or None, "lat": lat, "lon": lon, "tz": meta["tz"], "method": method,
            "madhab": madhab, "weekend_days": days}


def _rows(rows: list[dict], label: str, blocks: dict[str, bool], stream_ids: set[str]) -> list[dict]:
    if not rows:
        raise ValueError(f"the {label} schedule needs at least one row")
    out = []
    for n, r in enumerate(rows, start=1):
        for field in ("start", "end"):
            if not _valid_time(r[field].strip().lower()):
                raise ValueError(f"{label} row {n}: '{r[field]}' is not a time (use HH:MM or a prayer like fajr+10)")
        if r["block"] not in blocks:
            raise ValueError(f"{label} row {n}: unknown block '{r['block']}'")
        if blocks[r["block"]]:
            raise ValueError(f"{label} row {n}: '{r['block']}' is archived")
        stream = (r.get("stream") or "").strip() or None
        if stream and stream not in stream_ids:
            raise ValueError(f"{label} row {n}: unknown stream '{stream}'")
        out.append({"block": r["block"], "start": r["start"].strip().lower(), "end": r["end"].strip().lower(),
                    "what": " ".join((r.get("what") or "").split()), "stream": stream})
    return out


async def replace_schedule(db, user_id: int, meta: dict, weekday: list[dict], weekend: list[dict], stream_ids: set[str]) -> None:
    clean_meta = _meta(meta)
    blocks = {r.key: r.archived for r in (await db.execute(select(PlannerBlock).where(PlannerBlock.user_id == user_id))).scalars().all()}
    days = {"weekday": _rows(weekday, "weekday", blocks, stream_ids), "weekend": _rows(weekend, "weekend", blocks, stream_ids)}
    setting = (await db.execute(select(PlannerScheduleSetting).where(PlannerScheduleSetting.user_id == user_id))).scalar_one_or_none()
    if setting is None:
        db.add(PlannerScheduleSetting(user_id=user_id, meta=clean_meta))
    else:
        setting.meta = clean_meta
    await db.execute(delete(PlannerScheduleBlock).where(PlannerScheduleBlock.user_id == user_id))
    for day_type, rows in days.items():
        for position, r in enumerate(rows):
            db.add(PlannerScheduleBlock(user_id=user_id, day_type=day_type, position=position, **r))
    await db.flush()


def _host(url: str) -> str:
    return urlparse(url).hostname or ""


async def list_feeds(db, user_id: int) -> list[dict]:
    rows = (await db.execute(select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id)
                             .order_by(PlannerCalendarFeed.position))).scalars().all()
    return [{"id": r.id, "name": r.name, "host": _host(r.url), "color": r.color, "email": r.email} for r in rows]


async def add_feed(db, user_id: int, name: str, url: str) -> None:
    name, url = " ".join(name.split()), url.strip()
    if not name or len(name) > 120:
        raise ValueError("give the calendar a name of 1-120 characters")
    await asyncio.to_thread(check_public_url, url)  # never store an address the server must not fetch
    top = (await db.execute(select(func.max(PlannerCalendarFeed.position)).where(PlannerCalendarFeed.user_id == user_id))).scalar()
    db.add(PlannerCalendarFeed(user_id=user_id, name=name, url=url, color=None, email=None, position=0 if top is None else top + 1))
    await db.flush()


async def remove_feed(db, user_id: int, feed_id: int) -> bool:
    row = (await db.execute(select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id,
                                                              PlannerCalendarFeed.id == feed_id))).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def seed_new_user(db, user_id: int) -> None:
    """The starter template: blocks, settings (no location yet) and a prayer-anchored weekday and weekend."""
    for position, b in enumerate(STARTER_BLOCKS):
        db.add(PlannerBlock(user_id=user_id, position=position, **b))
    db.add(PlannerScheduleSetting(user_id=user_id, meta=dict(STARTER_META)))
    for day_type, rows in (("weekday", STARTER_WEEKDAY), ("weekend", STARTER_WEEKEND)):
        for position, r in enumerate(rows):
            db.add(PlannerScheduleBlock(user_id=user_id, day_type=day_type, position=position, **r))
    await db.flush()


MAX_GOALS = 6


def _goal_text(value: str, what: str, limit: int, required: bool) -> str:
    text = " ".join(value.split())
    if "|" in value:
        raise ValueError(f"the {what} cannot contain |")
    if required and not text:
        raise ValueError(f"a goal needs a {what}")
    if len(text) > limit:
        raise ValueError(f"the {what} is longer than {limit} characters")
    return text


async def replace_goals(db, user_id: int, items: list[dict]) -> None:
    """Replace the user's goals (the cards at the top of the Overview) with `items`, in order."""
    if len(items) > MAX_GOALS:
        raise ValueError(f"at most {MAX_GOALS} goals")
    clean = []
    for g in items:
        if "\n" in g["caption"] or "\n" in g["title"] or "\n" in g["value"]:
            raise ValueError("a goal is one line")
        progress = g.get("progress")
        if progress is not None and not 0 <= progress <= 100:
            raise ValueError("progress is 0 to 100")
        clean.append({"title": _goal_text(g["title"], "title", 60, True), "value": _goal_text(g["value"], "value", 80, True),
                      "caption": _goal_text(g.get("caption") or "", "caption", 120, False), "progress": progress})
    await db.execute(delete(Goal).where(Goal.user_id == user_id))
    for position, g in enumerate(clean):
        db.add(Goal(user_id=user_id, position=position, **g))
    await db.flush()
