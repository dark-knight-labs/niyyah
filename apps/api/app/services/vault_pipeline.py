"""Pipelines: one note per stream, Efforts/Pipeline/<stream>.md, four lanes as '##' headings.

    ## Now / ## Next / ## Backlog / ## Done
    - [ ] Ship the DNS dashboard #nov ➕ 2026-10-02
    - [x] Draft the incident template #oct ➕ 2026-09-28 ✅ 2026-10-05

Obsidian Tasks lines, so the note reads and queries normally in the vault. An item is identified by
line number plus a hash of the line, so a moved or changed line is refused instead of mis-edited.
Pure functions (string in, string out); vault_git.py does the committing.
"""
import re
from datetime import date

from app.services.vault_streams import SLUG, split_month_tag
from app.services.vault_tasks import line_hash

LANES = ("now", "next", "backlog", "done")
HEADINGS = {"now": "Now", "next": "Next", "backlog": "Backlog", "done": "Done"}
NOW_LIMIT = 3
STALE_DAYS = 14
MAX_TEXT_CHARS = 300
_ITEM = re.compile(r"^- \[([ xX])\] (.*)$")
_ADDED = re.compile(r"\s*➕\s*(\d{4}-\d{2}-\d{2})")
_DONE = re.compile(r"\s*✅\s*(\d{4}-\d{2}-\d{2})")
_BRACKET_MONTH = re.compile(r"\s*\[(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\]\s*$", re.IGNORECASE)


def pipeline_path(stream: str) -> str:
    if not SLUG.match(stream):
        raise ValueError(f"unknown stream '{stream}'")
    return f"Efforts/Pipeline/{stream}.md"


def _skeleton(stream: str, name: str | None) -> list[str]:
    head = ["---", "type: pipeline", f"stream: {stream}", "---", f"# {name or stream.title()} pipeline", ""]
    for lane in LANES:
        head += [f"## {HEADINGS[lane]}", ""]
    return head


def _lane_of(heading: str) -> str | None:
    name = heading[3:].strip().lower()
    return name if name in LANES else None


def parse_pipeline(content: str | None, today: date) -> list[dict]:
    """Items in file order: {line, hash, text, lane, checkpoint, added, done_on, done, age_days, stale}."""
    items: list[dict] = []
    lane = None
    for number, line in enumerate((content or "").split("\n"), start=1):
        if line.startswith("## "):
            lane = _lane_of(line)
            continue
        m = _ITEM.match(line)
        if not m or lane is None:
            continue
        body = m.group(2)
        added = _ADDED.search(body)
        done_on = _DONE.search(body)
        text, checkpoint = split_month_tag(_DONE.sub("", _ADDED.sub("", body)))
        age = (today - date.fromisoformat(added.group(1))).days if added else 0
        items.append({
            "line": number, "hash": line_hash(line), "text": text, "lane": lane, "checkpoint": checkpoint,
            "added": added.group(1) if added else None, "done_on": done_on.group(1) if done_on else None,
            "done": m.group(1) != " ", "age_days": age,
            "stale": lane in ("next", "backlog") and checkpoint is None and age >= STALE_DAYS,
        })
    return items


def _render(text: str, checkpoint: str | None, done: bool, added: str | None, done_on: str | None) -> str:
    tail = f" #{checkpoint}" if checkpoint else ""
    tail += f" ➕ {added}" if added else ""
    tail += f" ✅ {done_on}" if done_on else ""
    return f"- [{'x' if done else ' '}] {text}{tail}"


def _clean(text: str) -> tuple[str, str | None]:
    """One line of user text -> (text, month): a trailing [Nov] counts as #nov."""
    bracket = _BRACKET_MONTH.search(text)
    if bracket:
        text = _BRACKET_MONTH.sub("", text) + f" #{bracket.group(1).lower()}"
    cleaned, month = split_month_tag(text)
    if not cleaned:
        raise ValueError("item text is empty")
    if len(cleaned) > MAX_TEXT_CHARS:
        raise ValueError(f"item is longer than {MAX_TEXT_CHARS} characters")
    return cleaned, month


def _lines(content: str | None, stream: str, name: str | None) -> list[str]:
    return (content or "\n".join(_skeleton(stream, name))).split("\n")


def _section_end(lines: list[str], lane: str) -> int:
    """Index to insert at: just after the lane's last non-blank line (the heading is created if missing)."""
    for i, line in enumerate(lines):
        if line.startswith("## ") and _lane_of(line) == lane:
            end = i + 1
            for j in range(i + 1, len(lines)):
                if lines[j].startswith("## "):
                    break
                if lines[j].strip():
                    end = j + 1
            return end
    if lines and lines[-1] != "":
        lines.append("")
    lines += [f"## {HEADINGS[lane]}", ""]
    return len(lines) - 1


def add_items(content: str | None, stream: str, texts: list[str], lane: str, today: date, name: str | None = None) -> str:
    """Append one task line per entry of `texts` to the end of `lane` (file and headings created if needed)."""
    if lane not in LANES or lane == "done":
        raise ValueError(f"cannot add to lane '{lane}'")
    cleaned = [_clean(t) for t in texts if t.strip()]
    if not cleaned:
        raise ValueError("nothing to add")
    lines = _lines(content, stream, name)
    at = _section_end(lines, lane)
    new = [_render(t, m, False, today.isoformat(), None) for t, m in cleaned]
    lines[at:at] = new
    return "\n".join(lines)


def _find(lines: list[str], line: int, expected_hash: str) -> re.Match:
    if not 1 <= line <= len(lines) or line_hash(lines[line - 1]) != expected_hash:
        raise ValueError("that item changed or moved; reload and try again")
    m = _ITEM.match(lines[line - 1])
    if not m:
        raise ValueError("that line is not an item")
    return m


def _parts(body: str) -> tuple[str, str | None, str | None, str | None]:
    added = _ADDED.search(body)
    done_on = _DONE.search(body)
    text, month = split_month_tag(_DONE.sub("", _ADDED.sub("", body)))
    return text, month, added.group(1) if added else None, done_on.group(1) if done_on else None


def move_item(content: str, line: int, expected_hash: str, lane: str, today: date) -> str:
    """Move an item to the end of `lane`; Done ticks it and stamps ✅, any other lane reopens it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    text, month, added, done_on = _parts(m.group(2))
    del lines[line - 1]
    done = lane == "done"
    new = _render(text, month, done, added, (done_on or today.isoformat()) if done else None)
    lines.insert(_section_end(lines, lane), new)
    return "\n".join(lines)


def set_checkpoint(content: str, line: int, expected_hash: str, checkpoint: str | None) -> str:
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    text, month, added, done_on = _parts(m.group(2))
    if checkpoint:
        _, month = _clean(f"x #{checkpoint}")
    else:
        month = None
    lines[line - 1] = _render(text, month, m.group(1) != " ", added, done_on)
    return "\n".join(lines)


def remove_item(content: str, line: int, expected_hash: str) -> str:
    lines = content.split("\n")
    _find(lines, line, expected_hash)
    del lines[line - 1]
    return "\n".join(lines)


def set_text(content: str, line: int, expected_hash: str, text: str) -> str:
    """Rename an item in place, keeping its lane, month tag and dates; a #month typed in `text` replaces the tag."""
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    _, month, added, done_on = _parts(m.group(2))
    cleaned, typed = _clean(text)
    lines[line - 1] = _render(cleaned, typed or month, m.group(1) != " ", added, done_on)
    return "\n".join(lines)
