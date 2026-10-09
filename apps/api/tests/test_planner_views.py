from datetime import date

from app.services.planner_views import pipelines_response, quarter_response
from app.services.rules import make_stream

TODAY = date(2026, 10, 7)
DATA = {"quarter": "2026-Q4", "starts": "2026-10-01", "ends": "2026-12-31", "objective": "Obj", "objective_ar": "ar",
        "streams": [{"stream": "studio", "info": make_stream("studio", {"name": "Studio"}), "goal": "Ship DNS", "status": "committed",
                     "goal_checklist": [{"id": "a1b2c3d4", "text": "Ship DNS", "done": False}],
                     "checkpoints": [{"month": "oct", "text": "Router live", "checklist": [{"id": "e5f6a7b8", "text": "Router live", "done": True}]}]}]}


def test_quarter_response_from_stored_data():
    res = quarter_response(DATA, "2026-Q4", TODAY)
    assert res.quarter == "2026-Q4" and res.objective == "Obj" and res.streams[0].stream == "studio"
    assert res.streams[0].checkpoints[0].month == "oct"
    assert res.streams[0].goal_checklist[0].text == "Ship DNS" and res.streams[0].checkpoints[0].checklist[0].done is True


def test_pipelines_response_skips_streams_without_a_pipeline():
    streams = [make_stream("studio"), make_stream("passive")]
    streams[1].goal = False  # a stream with no quarter goal and no pipeline
    items = {"studio": [{"product": None, "line": 1, "hash": "", "text": "One", "lane": "now", "checkpoint": None, "added": None, "done_on": None,
                       "focus": None, "done": False, "age_days": 0, "description": "", "blocked_by": [], "stale": False}]}
    res = pipelines_response(streams, items, TODAY)
    assert [s.stream for s in res.streams] == ["studio"]
    assert res.streams[0].items[0].text == "One"
