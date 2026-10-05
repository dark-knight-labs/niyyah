"""Edit a vault daily note as text: mode, vote checkboxes and Log notes.

Pure functions (string in, string out) so they are easy to test; vault_git.py
does the committing. A daily note keeps its own layout: only the touched lines change.
"""
import re
from datetime import date

from app.services.vault_parser import BLOCK_ALIASES, CANONICAL_BLOCKS, MODE_META

MAX_NOTE_CHARS = 500
_FM_END = re.compile(r"^---\s*$", re.M)
_CALLOUT = re.compile(r"^>\s*\[!(\w+)\]")
_STAR_LINE = re.compile(r"^(>\s*-\s*\[)( |x)(\]\s*)(⭐+)(.*)$")
_LOG_PLACEHOLDER = re.compile(r"^\s*[-*]\s*$")


def _frontmatter_bounds(content: str) -> tuple[int, int]:
    """(start, end) offsets of the text between the two --- lines."""
    if not content.startswith("---"):
        raise ValueError("daily note has no frontmatter")
    closing = _FM_END.search(content, 3)
    if not closing:
        raise ValueError("daily note frontmatter is not closed")
    return 3, closing.start()


def _set_frontmatter_key(content: str, key: str, value: str) -> str:
    start, end = _frontmatter_bounds(content)
    head = content[start:end]
    line = re.compile(rf"^{re.escape(key)}:.*$", re.M)
    if line.search(head):
        head = line.sub(f"{key}: {value}", head, count=1)
    else:
        head = head.rstrip("\n") + f"\n{key}: {value}\n"
    return content[:start] + head + content[end:]


def set_mode(content: str, mode: str) -> str:
    if mode not in MODE_META:
        raise ValueError(f"unknown mode '{mode}'")
    return _set_frontmatter_key(content, "mode", mode)


def set_vote(content: str, block: str, stars: int) -> str:
    """Make `stars` (0-3) the vote for `block`: tick that level, untick the others."""
    block = BLOCK_ALIASES.get(block.lower(), block.lower())
    if block not in CANONICAL_BLOCKS:
        raise ValueError(f"unknown block '{block}'")
    if not 0 <= stars <= 3:
        raise ValueError("stars must be 0-3")

    out: list[str] = []
    current: str | None = None
    found = False
    for line in content.split("\n"):
        callout = _CALLOUT.match(line)
        if callout:
            name = BLOCK_ALIASES.get(callout.group(1).lower(), callout.group(1).lower())
            current = name if name in CANONICAL_BLOCKS else None
        elif current == block:
            m = _STAR_LINE.match(line)
            if m:
                found = True
                tick = "x" if len(m.group(4)) == stars else " "
                line = f"{m.group(1)}{tick}{m.group(3)}{m.group(4)}{m.group(5)}"
        out.append(line)
    if not found:
        raise ValueError(f"no vote lines for '{block}' in this note")
    return "\n".join(out)


def _one_line(text: str) -> str:
    cleaned = " ".join(text.split())
    if not cleaned:
        raise ValueError("note is empty")
    if len(cleaned) > MAX_NOTE_CHARS:
        raise ValueError(f"note is longer than {MAX_NOTE_CHARS} characters")
    return cleaned


def add_log_note(content: str, clock: str, section: str, span: str, text: str) -> str:
    """Append '- 14:05 · OT (06:00–16:03): text' under '## Log', dropping the empty placeholder bullet."""
    entry = f"- {clock} · {_one_line(section)} ({_one_line(span)}): {_one_line(text)}"
    lines = content.split("\n")
    try:
        at = next(i for i, l in enumerate(lines) if l.strip() == "## Log")
    except StopIteration:
        return content.rstrip("\n") + f"\n\n## Log\n{entry}\n"
    end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    body = [l for l in lines[at + 1:end] if not _LOG_PLACEHOLDER.match(l)]
    while body and not body[-1].strip():
        body.pop()
    block = [*body, entry, ""]
    return "\n".join([*lines[:at + 1], *block, *lines[end:]])


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def new_daily_note(template: str, template_date: date, target: date) -> str:
    """A fresh note for `target` that keeps `template`'s layout (including its Today's Shape block) but none of its content."""
    old_iso, new_iso = template_date.isoformat(), target.isoformat()
    s = template.replace(old_iso, new_iso)
    s = s.replace(template_date.strftime("%Y%m%d") + "-daily", target.strftime("%Y%m%d") + "-daily")
    s = re.sub(r"^title:.*$", f"title: {target.strftime('%A, %B')} {target.day} {target.year}", s, count=1, flags=re.M)
    s = re.sub(r"^# .*$", f"# {target.strftime('%A')}, {_ordinal(target.day)} {target.strftime('%B')}, {target.year}", s, count=1, flags=re.M)
    s = re.sub(r"^(>\s*-\s*\[)x(\]\s*⭐)", r"\1 \2", s, flags=re.M)  # untick every vote
    s = re.sub(r"^backfilled:.*\n", "", s, flags=re.M)
    s = re.sub(r"^stars:.*$", "stars: 0", s, count=1, flags=re.M)
    s = re.sub(r"^mode:.*$", "mode: full", s, count=1, flags=re.M)
    for heading in ("Log", "Captured (triage later → Knowledge/Projects)"):
        s = _blank_section(s, heading, "-" if heading == "Log" else "*")
    return _blank_section(s, "Reflection", None, ["- Win:", "- Friction:", "- Tomorrow:"])


def _blank_section(content: str, heading: str, bullet: str | None, body: list[str] | None = None) -> str:
    lines = content.split("\n")
    try:
        at = next(i for i, l in enumerate(lines) if l.strip() == f"## {heading}")
    except StopIteration:
        return content
    end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    fresh = body if body is not None else [bullet or ""]
    return "\n".join([*lines[:at + 1], *fresh, "", *lines[end:]])
