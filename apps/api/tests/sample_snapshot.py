"""A small but realistic account as an import payload: two days of votes, goals, a quarter with two streams, a pipeline, a notebook, tasks and a schedule."""
from datetime import date, timedelta

from app.services.rules import MONTHS, quarter_for, week_for

BLOCKER_ID = "b10c4e01"


def sample_snapshot(today: date) -> dict:
    iso = lambda d: d.isoformat()  # noqa: E731
    month = MONTHS[today.month - 1]
    first = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)
    week = week_for(today)[2]
    votes = {"soul": 2, "body": 1, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}

    def block(key, label, ring, color, stars=True):
        return {"key": key, "label": label, "ring_name": ring, "color": color, "counts_for_stars": stars, "archived": False}

    return {
        "version": 1,
        "blocks": [block("soul", "Soul", "SOUL", "emerald"), block("body", "Body", "BODY", "amber"), block("ot", "OT", "OT", "violet"),
                   block("planning", "Planning", "PLAN", "sky", stars=False), block("distribution", "Distribution", "DIST", "cyan"),
                   block("fnf", "FnF", "FNF", "rose"), block("sleep", "Sleep", "SLEEP", "slate")],
        "schedule": {
            "meta": {"city": "Dhaka", "lat": 23.8, "lon": 90.4, "tz": "Asia/Dhaka", "method": "ISNA", "madhab": "hanafi", "weekend_days": ["fri", "sat"]},
            "days": {
                "weekday": [{"block": "soul", "start": "fajr", "end": "sunrise", "what": "Quran", "stream": None},
                            {"block": "ot", "start": "08:00", "end": "16:00", "what": "Deep work", "stream": "studio"}],
                "weekend": [{"block": "soul", "start": "fajr", "end": "sunrise", "what": "Quran", "stream": None},
                            {"block": "planning", "start": "09:00", "end": "10:30", "what": "Planning", "stream": None}],
            },
        },
        "feeds": [],
        "goals": [{"title": "Zero debt", "value": "62% paid", "caption": "what it is for", "progress": 62},
                  {"title": "Life simple", "value": "Fewer things", "caption": "", "progress": None}],
        "quarters": [{
            "label": quarter_for(today), "starts": iso(first), "ends": iso(first + timedelta(days=90)),
            "objective": "Allah SWT's satisfaction", "objective_ar": "رضا الله",
            "streams": [
                {"slug": "studio", "name": "Studio", "color": "violet", "icon": "server", "slot": "OT · Sun to Thu", "weekly": True,
                 "has_pipeline": True, "in_note": True, "goal": "Ship DNS", "status": "committed",
                 "checkpoints": [{"month": month, "text": "Router live"}]},
                {"slug": "shop", "name": "Shop", "color": "fuchsia", "icon": "shopping-bag", "slot": "OT · Fri and Sat",
                 "weekly": True, "has_pipeline": True, "in_note": True, "goal": "Launch the store", "status": "committed", "checkpoints": []},
            ],
        }],
        "week_objectives": [
            {"week": week, "stream": "studio", "text": "Wire the router", "done": False, "checkpoint": month},
            {"week": week, "stream": "shop", "text": "Launch page", "done": True, "checkpoint": None},
        ],
        "pipeline_items": [
            {"stream": "studio", "lane": "now", "text": "Wire the router", "description": "Check the SFP module first.", "product": "Router",
             "checkpoint": month, "added_on": iso(today - timedelta(days=2)), "done_on": None, "focus_week": week, "done": False,
             "blocked_by": [BLOCKER_ID]},
            {"stream": "studio", "lane": "next", "text": "Plan the DNS cutover", "description": "", "product": None, "checkpoint": None,
             "added_on": iso(today - timedelta(days=30)), "done_on": None, "focus_week": None, "done": False, "blocked_by": []},
            {"stream": "studio", "lane": "backlog", "text": "Replace the switch", "description": "", "product": None, "checkpoint": None,
             "added_on": None, "done_on": None, "focus_week": None, "done": False, "blocked_by": []},
            {"stream": "studio", "lane": "done", "text": "Order the modem", "description": "", "product": None, "checkpoint": None,
             "added_on": iso(today - timedelta(days=30)), "done_on": iso(today), "focus_week": None, "done": True, "blocked_by": []},
        ],
        "notebook_entries": [
            {"stream": "studio", "id": "a1b2c3d4", "kind": "idea", "title": "Passkeys", "body": "cheaper than SSO", "date": iso(today), "open": None},
            {"stream": "studio", "id": BLOCKER_ID, "kind": "blocker", "title": "Waiting on legal", "body": "owner: legal https://example.com/doc",
             "date": iso(today), "open": True},
        ],
        "days": [{"date": iso(d), "mode": "full", "possible": 18, "total": 3, "focus": None, "votes": dict(votes),
                  "log": ["06:10 Fixed the router", "Second entry"]} for d in (today - timedelta(days=1), today)],
        "tasks": [
            {"text": "Pay invoice", "done": False, "due_on": iso(today), "scheduled_on": None, "start_on": None, "done_on": None, "source_path": "Efforts/todo.md"},
            {"text": "Renew domain", "done": True, "due_on": None, "scheduled_on": iso(today), "start_on": None, "done_on": iso(today), "source_path": "Efforts/todo.md"},
            {"text": "Future thing", "done": False, "due_on": iso(today + timedelta(days=9)), "scheduled_on": None, "start_on": None, "done_on": None,
             "source_path": "Efforts/todo.md"},
        ],
    }
