"""Saving a user's schedule settings; validation mirrors what the web app can resolve."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select

from app.models.planner import PlannerBlock, PlannerScheduleBlock, PlannerScheduleSetting
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
