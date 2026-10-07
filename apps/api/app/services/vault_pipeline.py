"""Pipelines: one note per stream, Efforts/Pipeline/<stream>.md, four lanes as '##' headings.

    ## Now / ## Next / ## Backlog / ## Done
    - [ ] Ship the DNS dashboard #nov ➕ 2026-10-02
    - [x] Draft the incident template #oct ➕ 2026-09-28 ✅ 2026-10-05

An item may carry a description: the indented lines right under it (Obsidian shows them as the task's notes).
A `🎯 2026-W41` marker makes an item that week's small domino (the weekly objective): one per stream per week.
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
MAX_DESCRIPTION_CHARS = 4000
BLOCKED_BY = "blocked-by:: "  # a note line naming a notebook blocker by its id; kept out of the description
_BLOCKER_ID = re.compile(r"^[a-z0-9]{4,16}$")
_ITEM = re.compile(r"^- \[([ xX])\] (.*)$")
_ADDED = re.compile(r"\s*➕\s*(\d{4}-\d{2}-\d{2})")
_DONE = re.compile(r"\s*✅\s*(\d{4}-\d{2}-\d{2})")
_FOCUS = re.compile(r"\s*🎯\s*(\d{4}-W\d{2})")
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


def _note_end(lines: list[str], at: int) -> int:
    """Index just past the item at `at` and its description (the indented lines below it, trailing blanks excluded)."""
    end = at + 1
    for j in range(at + 1, len(lines)):
        if lines[j].startswith(("  ", "\t")):
            if lines[j].strip():
                end = j + 1
        else:
            break
    return end


def _note_lines(lines: list[str], at: int) -> list[str]:
    return [l[2:] if l.startswith("  ") else l.lstrip("\t") for l in lines[at + 1:_note_end(lines, at)]]


def _description(lines: list[str], at: int) -> str:
    return "\n".join(l for l in _note_lines(lines, at) if not l.startswith(BLOCKED_BY))


def _blocked_by(lines: list[str], at: int) -> list[str]:
    return [l[len(BLOCKED_BY):].strip() for l in _note_lines(lines, at) if l.startswith(BLOCKED_BY) and l[len(BLOCKED_BY):].strip()]


def parse_pipeline(content: str | None, today: date) -> list[dict]:
    """Items in file order: {line, hash, text, description, lane, checkpoint, added, done_on, done, age_days, stale}."""
    items: list[dict] = []
    lane = None
    all_lines = (content or "").split("\n")
    for number, line in enumerate(all_lines, start=1):
        if line.startswith("## "):
            lane = _lane_of(line)
            continue
        m = _ITEM.match(line)
        if not m or lane is None:
            continue
        body = m.group(2)
        added = _ADDED.search(body)
        done_on = _DONE.search(body)
        focus = _FOCUS.search(body)
        text, checkpoint = split_month_tag(_FOCUS.sub("", _DONE.sub("", _ADDED.sub("", body))))
        age = (today - date.fromisoformat(added.group(1))).days if added else 0
        items.append({
            "line": number, "hash": line_hash(line), "text": text, "lane": lane, "checkpoint": checkpoint,
            "added": added.group(1) if added else None, "done_on": done_on.group(1) if done_on else None,
            "focus": focus.group(1) if focus else None, "done": m.group(1) != " ", "age_days": age,
            "description": _description(all_lines, number - 1), "blocked_by": _blocked_by(all_lines, number - 1),
            "stale": lane in ("next", "backlog") and checkpoint is None and age >= STALE_DAYS,
        })
    return items


def _render(text: str, checkpoint: str | None, done: bool, added: str | None, done_on: str | None, focus: str | None = None) -> str:
    tail = f" #{checkpoint}" if checkpoint else ""
    tail += f" 🎯 {focus}" if focus else ""
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


def add_items(content: str | None, stream: str, texts: list[str], lane: str, today: date, name: str | None = None,
              descriptions: list[str] | None = None) -> str:
    """Append one task line per entry of `texts` to the end of `lane` (file and headings created if needed).

    `descriptions[i]` (optional) becomes item i's notes, the indented lines under its task line.
    """
    if lane not in LANES or lane == "done":
        raise ValueError(f"cannot add to lane '{lane}'")
    if descriptions is not None and len(descriptions) != len(texts):
        raise ValueError("descriptions must line up with texts")
    notes = descriptions or [""] * len(texts)
    cleaned = [(*_clean(t), d.strip("\n").rstrip()) for t, d in zip(texts, notes) if t.strip()]
    if not cleaned:
        raise ValueError("nothing to add")
    if any(len(d) > MAX_DESCRIPTION_CHARS for _, _, d in cleaned):
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    lines = _lines(content, stream, name)
    at = _section_end(lines, lane)
    new: list[str] = []
    for t, m, d in cleaned:
        new.append(_render(t, m, False, today.isoformat(), None))
        if d.strip():
            new += [f"  {l}".rstrip() if l.strip() else "  " for l in d.split("\n")]
    lines[at:at] = new
    return "\n".join(lines)


def _find(lines: list[str], line: int, expected_hash: str) -> re.Match:
    if not 1 <= line <= len(lines) or line_hash(lines[line - 1]) != expected_hash:
        raise ValueError("that item changed or moved; reload and try again")
    m = _ITEM.match(lines[line - 1])
    if not m:
        raise ValueError("that line is not an item")
    return m


def _parts(body: str) -> tuple[str, str | None, str | None, str | None, str | None]:
    """(text, month, added, done_on, focus) of an item body."""
    added = _ADDED.search(body)
    done_on = _DONE.search(body)
    focus = _FOCUS.search(body)
    text, month = split_month_tag(_FOCUS.sub("", _DONE.sub("", _ADDED.sub("", body))))
    return text, month, added.group(1) if added else None, done_on.group(1) if done_on else None, focus.group(1) if focus else None


def move_item(content: str, line: int, expected_hash: str, lane: str, today: date) -> str:
    """Move an item to the end of `lane`; Done ticks it and stamps ✅, any other lane reopens it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    text, month, added, done_on, focus = _parts(m.group(2))
    notes = lines[line:_note_end(lines, line - 1)]
    del lines[line - 1:line + len(notes)]
    done = lane == "done"
    new = _render(text, month, done, added, (done_on or today.isoformat()) if done else None, focus)
    at = _section_end(lines, lane)
    lines[at:at] = [new, *notes]
    return "\n".join(lines)


def set_checkpoint(content: str, line: int, expected_hash: str, checkpoint: str | None) -> str:
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    text, month, added, done_on, focus = _parts(m.group(2))
    if checkpoint:
        _, month = _clean(f"x #{checkpoint}")
    else:
        month = None
    lines[line - 1] = _render(text, month, m.group(1) != " ", added, done_on, focus)
    return "\n".join(lines)


def remove_item(content: str, line: int, expected_hash: str) -> str:
    lines = content.split("\n")
    _find(lines, line, expected_hash)
    del lines[line - 1:_note_end(lines, line - 1)]
    return "\n".join(lines)


def set_description(content: str, line: int, expected_hash: str, text: str) -> str:
    """Replace an item's description (indented lines under it); blank text clears it."""
    lines = content.split("\n")
    _find(lines, line, expected_hash)
    text = text.strip("\n").rstrip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    kept = [f"{BLOCKED_BY}{t}" for t in _blocked_by(lines, line - 1)]
    notes = [f"  {l}".rstrip() if l.strip() else "  " for l in [*kept, *text.split("\n")]] if text.strip() or kept else []
    lines[line:_note_end(lines, line - 1)] = notes
    return "\n".join(lines)


def set_blocked_by(content: str, line: int, expected_hash: str, ids: list[str]) -> str:
    """Replace the notebook blockers (by entry id) an item waits on; the description stays."""
    lines = content.split("\n")
    _find(lines, line, expected_hash)
    clean: list[str] = []
    for i in ids:
        if not _BLOCKER_ID.match(i):
            raise ValueError(f"'{i}' is not a blocker id")
        if i not in clean:
            clean.append(i)
    desc = _description(lines, line - 1)
    notes = [f"  {BLOCKED_BY}{i}" for i in clean] + ([f"  {l}".rstrip() if l.strip() else "  " for l in desc.split("\n")] if desc.strip() else [])
    lines[line:_note_end(lines, line - 1)] = notes
    return "\n".join(lines)


def set_text(content: str, line: int, expected_hash: str, text: str) -> str:
    """Rename an item in place, keeping its lane, month tag and dates; a #month typed in `text` replaces the tag."""
    lines = content.split("\n")
    m = _find(lines, line, expected_hash)
    _, month, added, done_on, focus = _parts(m.group(2))
    cleaned, typed = _clean(text)
    lines[line - 1] = _render(cleaned, typed or month, m.group(1) != " ", added, done_on, focus)
    return "\n".join(lines)


# --- the week's small domino ------------------------------------------------------------------------------------

def find_focus(content: str | None, week: str, today: date) -> dict | None:
    """The item marked as `week`'s small domino, if any (items carry the parsed fields of parse_pipeline)."""
    return next((i for i in parse_pipeline(content, today) if i["focus"] == week), None)


def _unfocus(lines: list[str], week: str) -> None:
    for n, line in enumerate(lines):
        m = _ITEM.match(line)
        if m and (f := _FOCUS.search(m.group(2))) and f.group(1) == week:
            text, month, added, done_on, _ = _parts(m.group(2))
            lines[n] = _render(text, month, m.group(1) != " ", added, done_on, None)


def set_focus(content: str, line: int, expected_hash: str, week: str, today: date) -> str:
    """Make this item `week`'s small domino: the marker moves off any other item and the item goes to Now (reopened if done)."""
    lines = content.split("\n")
    _find(lines, line, expected_hash)
    _unfocus(lines, week)
    m = _ITEM.match(lines[line - 1])
    text, month, added, _, _ = _parts(m.group(2))
    lines[line - 1] = _render(text, month, False, added, None, week)
    return move_item("\n".join(lines), line, line_hash(lines[line - 1]), "now", today)


def sync_focus(content: str | None, stream: str, name: str | None, week: str, today: date, *,
               text: str | None = None, done: bool | None = None) -> str | None:
    """Keep the week's small-domino item in step with its objective line.

    text "" unlinks (the item stays), other text renames the linked item, links an open item with that text, or creates one in Now;
    done moves the linked item to Done or back to Now. Returns None when there is nothing to change.
    """
    item = find_focus(content, week, today)
    if text is not None:
        if text.strip() == "":
            if not item:
                return None
            lines = _lines(content, stream, name)
            _unfocus(lines, week)
            return "\n".join(lines)
        if item:
            return set_text(content or "", item["line"], item["hash"], text)
        wanted = _clean(text)[0].lower()
        same = next((i for i in parse_pipeline(content, today) if not i["done"] and i["text"].lower() == wanted), None)
        if same:  # the objective names an item already in the pipeline: link it instead of adding a twin
            return set_focus(content or "", same["line"], same["hash"], week, today)
        out = add_items(content, stream, [text], "now", today, name)
        added = parse_pipeline(out, today)
        new = next(i for i in reversed(added) if i["lane"] == "now" and i["focus"] is None and i["text"] == _clean(text)[0])
        return set_focus(out, new["line"], new["hash"], week, today)
    if done is not None and item:
        return move_item(content or "", item["line"], item["hash"], "done" if done else "now", today)
    return None
