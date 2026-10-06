"""Weekly objectives: one line per block, one file per week (Saturday to Friday).

Calendar/Weekly/Objectives/2026-W41.md. Pure functions (string in, string out);
vault_git.py does the committing. A missing file reads as six empty objectives.
"""
import re
from datetime import date, timedelta

BLOCKS = ("soul", "body", "ot", "distribution", "fnf", "sleep")
LABELS = {"soul": "Soul", "body": "Body", "ot": "OT", "distribution": "Distribution", "fnf": "FnF", "sleep": "Sleep"}
MAX_OBJECTIVE_CHARS = 200
_ITEM = re.compile(r"^- \*\*(\w+)\*\*( ✓)?:[ \t]*(.*)$")


def week_for(day: date) -> tuple[date, date, str]:
    """(Saturday, Friday, 'YYYY-Www') of the week holding `day`; numbered by the ISO week of its Tuesday."""
    start = day - timedelta(days=(day.weekday() - 5) % 7)
    year, number, _ = (start + timedelta(days=3)).isocalendar()
    return start, start + timedelta(days=6), f"{year}-W{number:02d}"


def objectives_path(label: str) -> str:
    return f"Calendar/Weekly/Objectives/{label}.md"


def parse_objectives(content: str | None) -> list[dict]:
    """The six blocks in order as {block, text, done}; blocks missing from the file come back empty."""
    found: dict[str, dict] = {}
    for line in (content or "").split("\n"):
        m = _ITEM.match(line)
        block = m and next((b for b in BLOCKS if LABELS[b].lower() == m.group(1).lower()), None)
        if block:
            found[block] = {"block": block, "text": m.group(3).strip(), "done": bool(m.group(2))}
    return [found.get(b, {"block": b, "text": "", "done": False}) for b in BLOCKS]


def update_objective(content: str | None, day: date, block: str, text: str | None, done: bool | None) -> str:
    """Set the text and/or done flag of one block (creating the file) and render the whole note."""
    if block not in BLOCKS:
        raise ValueError(f"unknown block '{block}'")
    if text is None and done is None:
        raise ValueError("nothing to change")
    items = parse_objectives(content)
    item = items[BLOCKS.index(block)]
    if text is not None:
        cleaned = " ".join(text.split())
        if len(cleaned) > MAX_OBJECTIVE_CHARS:
            raise ValueError(f"objective is longer than {MAX_OBJECTIVE_CHARS} characters")
        item["text"] = cleaned
    if done is not None:
        item["done"] = done
    start, end, label = week_for(day)
    number = label.split("-W")[1]
    rows = [f"- **{LABELS[i['block']]}**{' ✓' if i['done'] else ''}:{' ' + i['text'] if i['text'] else ''}" for i in items]
    head = [
        "---", "type: weekly-objectives", f"week: {int(number)}", f"period: {start.isoformat()}/{end.isoformat()}", "---",
        f"# Objectives — W{number}", "",
    ]
    return "\n".join([*head, *rows, ""])
