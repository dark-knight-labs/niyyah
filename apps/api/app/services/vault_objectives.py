"""Weekly objectives: one line per stream, one file per week (Saturday to Friday).

Calendar/Weekly/Objectives/2026-W41.md. Pure functions (string in, string out);
vault_git.py does the committing. A missing file reads as seven empty objectives.
A line may end in a month tag (#nov): the checkpoint this objective topples.
"""
import re
from datetime import date, timedelta

from app.services.vault_streams import LABELS, MONTHS, OBJECTIVE_STREAMS, split_month_tag

STREAMS = OBJECTIVE_STREAMS
MAX_OBJECTIVE_CHARS = 200
_ITEM = re.compile(r"^- \*\*(\w+)\*\*( ✓)?:[ \t]*(.*)$")
_LEGACY = {"ot": "kahf"}  # before streams, Kahf and Alisha shared one OT line


def week_for(day: date) -> tuple[date, date, str]:
    """(Saturday, Friday, 'YYYY-Www') of the week holding `day`; numbered by the ISO week of its Tuesday."""
    start = day - timedelta(days=(day.weekday() - 5) % 7)
    year, number, _ = (start + timedelta(days=3)).isocalendar()
    return start, start + timedelta(days=6), f"{year}-W{number:02d}"


def objectives_path(label: str) -> str:
    return f"Calendar/Weekly/Objectives/{label}.md"


def parse_objectives(content: str | None) -> list[dict]:
    """The seven streams in order as {stream, text, done, checkpoint}; missing streams come back empty."""
    by_label = {LABELS[s].lower(): s for s in STREAMS}
    found: dict[str, dict] = {}
    for line in (content or "").split("\n"):
        m = _ITEM.match(line)
        if not m:
            continue
        name = m.group(1).lower()
        stream = by_label.get(name) or _LEGACY.get(name)
        if stream and (stream not in found or name in by_label):
            text, checkpoint = split_month_tag(m.group(3))
            found[stream] = {"stream": stream, "text": text, "done": bool(m.group(2)), "checkpoint": checkpoint}
    return [found.get(s, {"stream": s, "text": "", "done": False, "checkpoint": None}) for s in STREAMS]


def update_objective(content: str | None, day: date, stream: str, text: str | None, done: bool | None,
                     checkpoint: str | None = None) -> str:
    """Set the text, done flag and/or checkpoint of one stream ('' clears the checkpoint); render the whole note."""
    if stream not in STREAMS:
        raise ValueError(f"unknown stream '{stream}'")
    if text is None and done is None and checkpoint is None:
        raise ValueError("nothing to change")
    if checkpoint and checkpoint not in MONTHS:
        raise ValueError(f"unknown month '{checkpoint}'")
    items = parse_objectives(content)
    item = items[STREAMS.index(stream)]
    if text is not None:
        cleaned = " ".join(text.split())
        if len(cleaned) > MAX_OBJECTIVE_CHARS:
            raise ValueError(f"objective is longer than {MAX_OBJECTIVE_CHARS} characters")
        item["text"] = cleaned
    if done is not None:
        item["done"] = done
    if checkpoint is not None:
        item["checkpoint"] = checkpoint or None
    start, end, label = week_for(day)
    number = label.split("-W")[1]
    rows = []
    for i in items:
        tail = f" {i['text']}" if i["text"] else ""
        if i["text"] and i["checkpoint"]:
            tail += f" #{i['checkpoint']}"
        rows.append(f"- **{LABELS[i['stream']]}**{' ✓' if i['done'] else ''}:{tail}")
    head = [
        "---", "type: weekly-objectives", f"week: {int(number)}", f"period: {start.isoformat()}/{end.isoformat()}", "---",
        f"# Objectives — W{number}", "",
    ]
    return "\n".join([*head, *rows, ""])
