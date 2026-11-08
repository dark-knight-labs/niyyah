"""Synthetic planning rows for the item-tree tests. Nothing here comes from a real account."""
import datetime as dt

from app.models.planner import Quarter, QuarterStream, Task

FIXED_NOW = dt.datetime(2026, 11, 10, 9, 0, tzinfo=dt.timezone.utc)  # inside 2026-Q4


def line(line_id: str, text: str, done: bool = False) -> dict:
    return {"id": line_id, "text": text, "done": done}


def _stream(user_id: int, quarter: str, slug: str, position: int, **kw) -> QuarterStream:
    base = dict(name=slug.title(), color="violet", icon="server", slot="", weekly=True, has_pipeline=True, in_note=True,
                goal="", goal_checklist=[], status="committed", checkpoints=[])
    base.update(kw)
    return QuarterStream(user_id=user_id, quarter=quarter, slug=slug, position=position, **base)


def seed_planning(user_id: int) -> list:
    """Two quarters and every shape the shadow tree has to carry. Returns unsaved ORM rows."""
    q4_goal = [line("g1a2b3c4", "Draft the outline", True), line("g5d6e7f8", "Review with a friend")]
    rows: list = [
        Quarter(user_id=user_id, label="2026-Q4", starts=dt.date(2026, 10, 1), ends=dt.date(2026, 12, 31),
                objective="Finish the sample plan", objective_ar="خطة تجريبية"),
        Quarter(user_id=user_id, label="2026-Q3", starts=dt.date(2026, 7, 1), ends=dt.date(2026, 9, 30),
                objective="Prepare the sample plan", objective_ar=""),
        # active, with goal lines (done + open) and three checkpoints: lines, empty text and no checklist, a single plain line
        _stream(user_id, "2026-Q4", "alpha", 0, name="Alpha", slot="Mon 09:00-11:00", status="active", goal="Draft the outline · Review with a friend",
                goal_checklist=q4_goal, checkpoints=[
                    {"month": "oct", "text": "Outline · Sketch", "checklist": [line("c1000001", "Outline", True), line("c1000002", "Sketch")]},
                    {"month": "nov", "text": "", "checklist": []},
                    {"month": "dec", "text": "Publish", "checklist": [line("c3000001", "Publish")]},
                ]),
        # committed, no checkpoints at all, no goal
        _stream(user_id, "2026-Q4", "beta", 1, name="Beta", color="teal", icon="book", weekly=False),
        # paused, goal text without a checklist (older rows), a checkpoint month outside the quarter, text without checklist key
        _stream(user_id, "2026-Q4", "gamma", 2, name="Gamma", color="amber", icon="heart", status="paused", has_pipeline=False,
                goal="Plain goal text", goal_checklist=[], checkpoints=[
                    {"month": "jan", "text": "Out of quarter", "checklist": [line("c9000001", "Out of quarter")]},
                    {"month": "oct", "text": "Plain month text"},
                ]),
        _stream(user_id, "2026-Q4", "delta", 3, name="Delta", color="rose", icon="moon", status="archived", goal="Done long ago",
                goal_checklist=[line("d1000001", "Done long ago", True)]),
        # a built-in the note does not define: hidden from /vault/quarter
        _stream(user_id, "2026-Q4", "extra", 4, name="Extra", in_note=False),
        # the older quarter defines alpha differently (display fields differ) and has its own goals
        _stream(user_id, "2026-Q3", "alpha", 0, name="Alpha (old)", color="blue", icon="book", slot="Tue 14:00-16:00", status="committed",
                goal="Collect notes", goal_checklist=[line("q3a00001", "Collect notes")],
                checkpoints=[{"month": "aug", "text": "Collect", "checklist": [line("q3c00001", "Collect")]}]),
        _stream(user_id, "2026-Q3", "beta", 1, name="Beta (old)", color="teal", icon="book", status="active", goal="Warm up"),
        # pipeline rows so /pipelines and /objectives have content
        Task(user_id=user_id, text="Write the first page", done=False, stream="alpha", lane="now", lane_position=0, position=0,
             added_on=dt.date(2026, 11, 1), checkpoint="nov"),
        Task(user_id=user_id, text="Collect sources", done=False, stream="alpha", lane="next", lane_position=1, position=1,
             added_on=dt.date(2026, 10, 1)),
        Task(user_id=user_id, text="Name the project", done=True, stream="beta", lane="done", lane_position=0, position=2,
             added_on=dt.date(2026, 10, 20), done_on=dt.date(2026, 10, 25)),
        Task(user_id=user_id, text="Finish the outline", done=False, stream="alpha", focus_week="2026-W46", objective_text="Finish the outline",
             objective_done=False, focus_checkpoint="nov", position=3),
    ]
    return rows
