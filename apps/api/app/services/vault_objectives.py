"""Weekly objectives: one line per stream, one file per week (Sunday to Saturday).

Calendar/Weekly/Objectives/2026-W41.md. Pure functions (string in, string out);
vault_git.py does the committing. The streams come from the quarter note, so a block added
there gets an objective line here; a missing file reads as empty objectives.
A line may end in a month tag (#nov): the checkpoint this objective topples.
"""
import re
from datetime import date, timedelta

from app.services.vault_streams import LEGACY_LABELS, MONTHS, Stream, split_month_tag

MAX_OBJECTIVE_CHARS = 200
_ITEM = re.compile(r"^- \*\*([^*]+)\*\*( ✓)?:[ \t]*(.*)$")


def week_for(day: date) -> tuple[date, date, str]:
    """(Sunday, Saturday, 'YYYY-Www') of the week holding `day`; numbered by the ISO week of its Tuesday."""
    start = day - timedelta(days=(day.weekday() + 1) % 7)
    year, number, _ = (start + timedelta(days=2)).isocalendar()
    return start, start + timedelta(days=6), f"{year}-W{number:02d}"


def objectives_path(label: str) -> str:
    return f"Calendar/Weekly/Objectives/{label}.md"


def weekly_streams(streams: list[Stream]) -> list[Stream]:
    return [s for s in streams if s.weekly and not s.archived]


def _lookup(streams: list[Stream]) -> dict[str, str]:
    """Names a line may carry (display name, id, old label) -> stream id; real names beat legacy labels."""
    names = {LEGACY_LABELS[s.id].lower(): s.id for s in streams if s.id in LEGACY_LABELS}
    for s in streams:
        names[s.id] = s.id
        names[s.name.lower()] = s.id
    return names


def parse_objectives(content: str | None, streams: list[Stream]) -> list[dict]:
    """One {stream, text, done, checkpoint} per weekly stream in order; streams missing from the file come back empty."""
    wanted = weekly_streams(streams)
    names = _lookup(wanted)
    found: dict[str, dict] = {}
    for line in (content or "").split("\n"):
        m = _ITEM.match(line)
        if not m:
            continue
        label = m.group(1).strip().lower()
        stream = names.get(label)
        if stream and (stream not in found or label == next(s.name for s in wanted if s.id == stream).lower()):
            text, checkpoint = split_month_tag(m.group(3))
            found[stream] = {"stream": stream, "text": text, "done": bool(m.group(2)), "checkpoint": checkpoint}
    return [found.get(s.id, {"stream": s.id, "text": "", "done": False, "checkpoint": None}) for s in wanted]


def update_objective(content: str | None, day: date, stream: str, text: str | None, done: bool | None,
                     checkpoint: str | None, streams: list[Stream]) -> str:
    """Set the text, done flag and/or checkpoint of one stream ('' clears the checkpoint); render the whole note."""
    wanted = weekly_streams(streams)
    ids = [s.id for s in wanted]
    if stream not in ids:
        raise ValueError(f"unknown stream '{stream}'")
    if text is None and done is None and checkpoint is None:
        raise ValueError("nothing to change")
    if checkpoint and checkpoint not in MONTHS:
        raise ValueError(f"unknown month '{checkpoint}'")
    items = parse_objectives(content, streams)
    item = items[ids.index(stream)]
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
    names = {s.id: s.name for s in wanted}
    rows = []
    for i in items:
        tail = f" {i['text']}" if i["text"] else ""
        if i["text"] and i["checkpoint"]:
            tail += f" #{i['checkpoint']}"
        rows.append(f"- **{names[i['stream']]}**{' ✓' if i['done'] else ''}:{tail}")
    head = [
        "---", "type: weekly-objectives", f"week: {int(number)}", f"period: {start.isoformat()}/{end.isoformat()}", "---",
        f"# Objectives — W{number}", "",
    ]
    return "\n".join([*head, *rows, ""])
