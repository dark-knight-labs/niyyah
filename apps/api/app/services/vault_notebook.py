"""Stream notebooks: one note per stream, Efforts/Streams/<stream>.md, for what the pipeline lanes cannot hold.

    ## Sync with Hamza on SSO scope
    [kind:: meeting] [date:: 2026-10-07]
    Agreed: Google + Microsoft first.
    - [ ] Send the spec

An entry is a `##` heading, one Dataview-style inline-field line (kind, date, and status for blockers),
then free markdown. Every entry carries a stable `[id:: 3fa9c21b]` (assigned on creation, backfilled on any write)
so other notes, like a pipeline item's `blocked-by::`, can point at it and survive a rename. Kinds: idea (thinking, links, rough plans), meeting, blocker (status:: open or cleared).
Newest entries sit first. An entry is identified by its heading line number plus a hash of its whole text,
so a moved or changed entry is refused instead of mis-edited. Pure functions (string in, string out);
vault_git.py does the committing.
"""
import re
import uuid
from datetime import date

from app.services.vault_streams import SLUG
from app.services.vault_tasks import line_hash

KINDS = ("idea", "meeting", "blocker")  # brainstorms and links are ideas; an older kind in a note reads as idea
LABELS = {"idea": "Idea", "meeting": "Meeting", "blocker": "Blocker"}
MAX_TITLE_CHARS = 200
MAX_BODY_CHARS = 8000
_FIELD = re.compile(r"\[(\w+):: ([^\]]*)\]")
_URL = re.compile(r"https?://[^\s<>)\]]+")
_TOP_HEADING = re.compile(r"^#{1,2} ")


def notebook_path(stream: str) -> str:
    if not SLUG.match(stream):
        raise ValueError(f"unknown stream '{stream}'")
    return f"Efforts/Streams/{stream}.md"


def _skeleton(stream: str, name: str | None) -> list[str]:
    return ["---", "type: stream-notes", f"stream: {stream}", "---", f"# {name or stream.title()} notebook", ""]


def _blocks(lines: list[str]) -> list[tuple[int, int]]:
    """(start, end) line indexes of every entry; end is just past the last non-blank line."""
    starts = [i for i, l in enumerate(lines) if l.startswith("## ")]
    out = []
    for n, s in enumerate(starts):
        stop = starts[n + 1] if n + 1 < len(starts) else len(lines)
        end = s + 1
        for j in range(s + 1, stop):
            if lines[j].strip():
                end = j + 1
        out.append((s, end))
    return out


def parse_notebook(content: str | None) -> list[dict]:
    """Entries in file order: {line, hash, id, kind, title, date, body, open, url}. `open` is None unless kind is blocker."""
    lines = (content or "").split("\n")
    entries = []
    for s, end in _blocks(lines):
        fields = {}
        body_from = s + 1
        if body_from < end and _FIELD.match(lines[body_from]):
            fields = dict(_FIELD.findall(lines[body_from]))
            body_from += 1
        kind = fields.get("kind", "idea")
        body = "\n".join(lines[body_from:end])
        url = _URL.search(body)
        entries.append({
            "line": s + 1, "id": fields.get("id"), "hash": line_hash("\n".join(lines[s:end])), "kind": kind if kind in KINDS else "idea",
            "title": lines[s][3:].strip(), "date": fields.get("date"), "body": body,
            "open": (fields.get("status") != "cleared") if kind == "blocker" else None,
            "url": url.group(0) if url else None,
        })
    return entries


def _clean(kind: str, title: str, body: str) -> tuple[str, str]:
    """(title, body) ready to write: headings in the body are demoted, a blank title is derived."""
    if kind not in KINDS:
        raise ValueError(f"unknown kind '{kind}'")
    title = " ".join(title.split())
    body = body.strip("\n").rstrip()
    if len(title) > MAX_TITLE_CHARS:
        raise ValueError(f"title is longer than {MAX_TITLE_CHARS} characters")
    if len(body) > MAX_BODY_CHARS:
        raise ValueError(f"entry is longer than {MAX_BODY_CHARS} characters")
    body = "\n".join(_TOP_HEADING.sub("### ", l) for l in body.split("\n"))
    if not title:
        first = next((l.strip() for l in body.split("\n") if l.strip()), "")
        title = first[:80] or LABELS[kind]
    return title, body


def _render(kind: str, title: str, body: str, day: str, status: str | None, entry_id: str) -> list[str]:
    meta = f"[kind:: {kind}] [date:: {day}] [id:: {entry_id}]" + (f" [status:: {status}]" if status else "")
    return [f"## {title}", meta, *([body] if body else []), ""]


def add_entry(content: str | None, stream: str, name: str | None, kind: str, title: str, body: str, today: date) -> str:
    """Put a new entry first (file and heading created if needed). Blockers start open."""
    title, body = _clean(kind, title, body)
    lines = (content or "\n".join(_skeleton(stream, name))).split("\n")
    first = next((s for s, _ in _blocks(lines)), None)
    at = first if first is not None else len(lines)
    if first is None and lines and lines[-1] != "":
        lines.append("")
        at = len(lines)
    lines[at:at] = _render(kind, title, body, today.isoformat(), "open" if kind == "blocker" else None, _new_id())
    return _with_ids("\n".join(lines))


def _new_id() -> str:
    return uuid.uuid4().hex[:8]


def _with_ids(content: str) -> str:
    """Give every entry that lacks an id one (hand-written or older entries), keeping all else as is."""
    lines = content.split("\n")
    for s, end in reversed(_blocks(lines)):
        has_meta = s + 1 < end and _FIELD.match(lines[s + 1])
        if has_meta and "[id:: " in lines[s + 1]:
            continue
        if has_meta:
            lines[s + 1] += f" [id:: {_new_id()}]"
        else:
            lines.insert(s + 1, f"[kind:: idea] [id:: {_new_id()}]")
    return "\n".join(lines)


def _find(lines: list[str], line: int, expected_hash: str) -> tuple[int, int]:
    for s, end in _blocks(lines):
        if s + 1 == line and line_hash("\n".join(lines[s:end])) == expected_hash:
            return s, end
    raise ValueError("that entry changed or moved; reload and try again")


def set_entry(content: str, line: int, expected_hash: str, title: str, body: str) -> str:
    """Replace an entry's title and body; its kind, date and blocker status stay."""
    lines = content.split("\n")
    s, end = _find(lines, line, expected_hash)
    entry = next(e for e in parse_notebook(content) if e["line"] == line)
    title, body = _clean(entry["kind"], title, body)
    status = None if entry["open"] is None else ("open" if entry["open"] else "cleared")
    lines[s:end] = _render(entry["kind"], title, body, entry["date"] or "", status, entry["id"] or _new_id())[:-1]
    return _with_ids("\n".join(lines))


def set_blocker(content: str, line: int, expected_hash: str, open_: bool) -> str:
    lines = content.split("\n")
    s, end = _find(lines, line, expected_hash)
    entry = next(e for e in parse_notebook(content) if e["line"] == line)
    if entry["kind"] != "blocker":
        raise ValueError("only a blocker can be opened or cleared")
    lines[s:end] = _render("blocker", entry["title"], entry["body"], entry["date"] or "", "open" if open_ else "cleared", entry["id"] or _new_id())[:-1]
    return _with_ids("\n".join(lines))


def remove_entry(content: str, line: int, expected_hash: str) -> str:
    lines = content.split("\n")
    s, end = _find(lines, line, expected_hash)
    del lines[s:end]
    if s < len(lines) and lines[s] == "" and (s == 0 or lines[s - 1] == ""):
        del lines[s]
    return _with_ids("\n".join(lines))
