"""The one place that turns the old planning tables into planner_tasks rows.

Used by the migration (planner_pipeline_items + planner_week_objectives -> planner_tasks) and by the import of a
version 1 export that has no `planning_rows` section. Pure Python on plain dicts: no database, no ORM, so a migration
can import it without dragging the app in.

A pipeline item becomes a row with a `lane`. A week objective is stored on the row that is its week's small domino
(`focus_week` = the week), in `objective_text` / `objective_done` / `focus_checkpoint`; the two stay separate fields, so
both old views read back byte for byte. An objective no pipeline item points at becomes a row with no lane
(`lane` NULL, `focus_week` set): it shows in the objectives view only.
"""

ORIGIN_PIPELINE = "pipeline"
ORIGIN_OBJECTIVE = "objective"


def origin_for(pipeline_id: int | None, objective_id: int | None) -> str | None:
    """'pipeline:7', 'objective:3' or 'pipeline:7+objective:3' (the row an objective was merged into)."""
    parts = []
    if pipeline_id is not None:
        parts.append(f"{ORIGIN_PIPELINE}:{pipeline_id}")
    if objective_id is not None:
        parts.append(f"{ORIGIN_OBJECTIVE}:{objective_id}")
    return "+".join(parts) or None


def parse_origin(origin: str | None) -> dict[str, int]:
    """{'pipeline': 7, 'objective': 3} for the parts an origin names."""
    out: dict[str, int] = {}
    for part in (origin or "").split("+"):
        kind, _, number = part.partition(":")
        if kind in (ORIGIN_PIPELINE, ORIGIN_OBJECTIVE) and number.isdigit():
            out[kind] = int(number)
    return out


def _base() -> dict:
    """Every planner_tasks column a mapped row sets (the ones the old image also knows are filled for it)."""
    return {
        "due_on": None, "scheduled_on": None, "start_on": None, "source_path": None, "position": 0, "start_min": None,
        "end_min": None, "weight": 0, "checklist": [], "parent_id": None,
    }


def pipeline_row(item: dict) -> dict:
    """One pipeline item -> a planner_tasks row. `position` of the item is kept as `lane_position`, unchanged."""
    done = bool(item["done"])
    return {
        **_base(),
        "user_id": item["user_id"], "stream": item["stream"], "lane": item["lane"], "lane_position": item["position"],
        "text": item["text"], "description": item.get("description") or "", "products": list(item.get("products") or []),
        "checkpoint": item.get("checkpoint"), "added_on": item.get("added_on"), "done": done, "done_on": item.get("done_on"),
        "status": "done" if done else "open", "focus_week": item.get("focus_week"), "blocked_by": list(item.get("blocked_by") or []),
        "objective_text": None, "objective_done": None, "focus_checkpoint": None,
        "origin": origin_for(item.get("id"), None),
    }


def objective_only_row(obj: dict) -> dict:
    """An objective no pipeline item carries -> a row with no lane. It never shows in pipelines or the undated list."""
    done = bool(obj["done"])
    return {
        **_base(),
        "user_id": obj["user_id"], "stream": obj["stream"], "lane": None, "lane_position": None, "text": obj["text"],
        "description": "", "products": [], "checkpoint": None, "added_on": None, "done": done, "done_on": None,
        "status": "done" if done else "open", "focus_week": obj["week"], "blocked_by": [],
        "objective_text": obj["text"], "objective_done": done, "focus_checkpoint": obj.get("checkpoint"),
        "origin": origin_for(None, obj.get("id")),
    }


def map_planning(pipeline: list[dict], objectives: list[dict]) -> tuple[list[dict], list[str]]:
    """Old pipeline items + objectives -> (planner_tasks rows, notes about what was dropped).

    pipeline: {id, user_id, stream, lane, text, description, products, checkpoint, added_on, done_on, focus_week, done,
               blocked_by, position}, in the order their rows should be created.
    objectives: {id, user_id, week, stream, text, done, checkpoint}.

    Rows come out pipeline items first (input order), then the objectives nothing points at (input order).
    Duplicate focus (several items of one stream with the same focus_week; the old code allowed it and read the first by
    position): the lowest position keeps the marker, the others lose it. An item is a domino for an objective when it has the
    same user, stream and focus_week = the objective's week.
    """
    notes: list[str] = []
    rows = [pipeline_row(p) for p in pipeline]
    holders: dict[tuple, int] = {}  # (user, stream, week) -> index of the row that keeps the marker
    for index, p in enumerate(pipeline):
        if not p.get("focus_week"):
            continue
        key = (p["user_id"], p["stream"], p["focus_week"])
        kept = holders.get(key)
        if kept is None:
            holders[key] = index
            continue
        winner = index if (p["position"], p.get("id") or 0) < (pipeline[kept]["position"], pipeline[kept].get("id") or 0) else kept
        loser = kept if winner == index else index
        holders[key] = winner
        rows[loser]["focus_week"] = None
        notes.append(f"duplicate focus {key[2]} in {key[1]}: pipeline:{pipeline[loser].get('id')} lost the marker, "
                     f"pipeline:{pipeline[winner].get('id')} keeps it")
    for obj in objectives:
        at = holders.get((obj["user_id"], obj["stream"], obj["week"]))
        if at is None:
            rows.append(objective_only_row(obj))
            continue
        rows[at]["objective_text"] = obj["text"]
        rows[at]["objective_done"] = bool(obj["done"])
        rows[at]["focus_checkpoint"] = obj.get("checkpoint")
        rows[at]["origin"] = origin_for(pipeline[at].get("id"), obj.get("id"))
    return rows, notes
