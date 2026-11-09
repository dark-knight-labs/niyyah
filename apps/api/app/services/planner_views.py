"""Response builders for the quarter, objectives, pipelines and notebooks pages."""
from datetime import date, timedelta

from app.schemas.vault import NotebooksResponse, ObjectivesResponse, PipelinesResponse, QuarterResponse
from app.services import plan_v2
from app.services.rules import COLORS, ICONS, MONTHS, NOW_LIMIT, STALE_DAYS, quarter_for, quarter_months, week_for


def stream_info(s) -> dict:
    return {"stream": s.id, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly, "status": s.status}


def quarter_response(data: dict, label: str, today: date) -> QuarterResponse:
    year, number = int(label[:4]), int(label[-1])
    first = date(year, 3 * number - 2, 1)
    try:
        start = date.fromisoformat(data["starts"]) if data["starts"] else first
        end = date.fromisoformat(data["ends"]) if data["ends"] else first + timedelta(days=90)
    except ValueError:
        start, end = first, first + timedelta(days=90)
    streams = [{**stream_info(s["info"]), "goal": s["goal"], "goal_checklist": s["goal_checklist"], "checkpoints": s["checkpoints"]} for s in data["streams"]]
    return QuarterResponse(
        quarter=data["quarter"] or label, starts=start.isoformat(), ends=end.isoformat(),
        objective=data["objective"], objective_ar=data["objective_ar"],
        week_of_quarter=max(1, (today - start).days // 7 + 1), weeks_in_quarter=((end - start).days + 7) // 7,
        current_month=MONTHS[today.month - 1], months=quarter_months(label), colors=list(COLORS), icons=list(ICONS),
        streams=streams,
    )


def objectives_response(parsed: list[dict], streams, today: date) -> ObjectivesResponse:
    start, end, label = week_for(today)
    by_id = {s.id: s for s in streams}
    items = [{**i, "name": by_id[i["stream"]].name, "color": by_id[i["stream"]].color, "icon": by_id[i["stream"]].icon}
             for i in parsed]
    return ObjectivesResponse(week=label, period=f"{start.isoformat()}/{end.isoformat()}", items=items)


def tab_quarters(today: date, goals: dict[str, list[dict]]) -> list[str]:
    """The quarter tabs: this quarter, the next, and any later quarter in which some block has a goal."""
    this = quarter_for(today)
    have = {q["quarter"] for rows in goals.values() for q in rows if q["goals"] and q["quarter"] > this}
    return sorted({this, plan_v2.next_quarter(this), *have})


def pipelines_response(streams, items_by_stream: dict[str, list[dict]], today: date,
                       ended: dict[str, list[dict]] | None = None, products: dict[str, list[dict]] | None = None,
                       goals: dict[str, list[dict]] | None = None) -> PipelinesResponse:
    out = [{**stream_info(s), "items": items_by_stream.get(s.id, []), "ended_goals": (ended or {}).get(s.id, []),
            "products": (products or {}).get(s.id, []), "quarter_goals": (goals or {}).get(s.id, [])}
           for s in streams if s.goal and not s.archived]
    return PipelinesResponse(week=week_for(today)[2], now_limit=NOW_LIMIT, stale_days=STALE_DAYS, streams=out,
                             quarters=tab_quarters(today, goals or {}))


def notebooks_response(streams, entries_by_stream: dict[str, list[dict]]) -> NotebooksResponse:
    out = [{**stream_info(s), "entries": entries_by_stream.get(s.id, [])}
           for s in streams if s.goal and not s.archived]
    return NotebooksResponse(streams=out)
