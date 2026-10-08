"""Goals shown as cards on the Overview: one line each in Calendar/Goals.md, edited in Obsidian.

    - **Zero debt**: 62% paid | what it is for, shown small | 62

The value is the big text on the card. The caption and the 0-100 progress are optional.
Read only: a missing file reads as no goals.
"""
import re

GOALS_PATH = "Calendar/Goals.md"
MAX_GOALS = 6
_ITEM = re.compile(r"^- \*\*([^*]+)\*\*:[ \t]*(.*)$")


def parse_goals(content: str | None) -> list[dict]:
    """Up to MAX_GOALS {title, value, caption, progress} in file order; lines that are not goals are skipped."""
    goals: list[dict] = []
    for line in (content or "").split("\n"):
        m = _ITEM.match(line)
        if not m:
            continue
        parts = [p.strip() for p in m.group(2).split("|")]
        progress = None
        if len(parts) > 2 and re.fullmatch(r"\d{1,3}", parts[2]):
            progress = min(int(parts[2]), 100)
        goals.append({
            "title": m.group(1).strip(),
            "value": parts[0],
            "caption": parts[1] if len(parts) > 1 else "",
            "progress": progress,
        })
    return goals[:MAX_GOALS]
