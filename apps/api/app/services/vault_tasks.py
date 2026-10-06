"""Obsidian Tasks lines for one day: find them across the vault and tick them off.

The vault's daily-note query is: not done, not a ⭐ vote line, due (📅) or scheduled (⏳) that day.
This mirrors it, but keeps done tasks too so a ticked task stays visible on the page.
A task is identified by file, line number and a hash of the line, so a task that moved or changed
since the page loaded is refused instead of ticking the wrong line.
"""
import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

_TASK = re.compile(r"^(\s*(?:[-*]|\d+\.)\s*\[)([ xX])(\]\s*)(.*)$")
_DATE_MARK = re.compile(r"[📅⏳🛫]\s*(\d{4}-\d{2}-\d{2})")
_DONE_MARK = re.compile(r"\s*✅\s*\d{4}-\d{2}-\d{2}")
_TAIL_MARK = re.compile(r"[📅⏳🛫✅]")
_SKIP_DIRS = {".git", ".obsidian", ".trash", "Templates"}


@dataclass
class VaultTask:
    path: str
    line: int  # 1-based
    hash: str
    text: str
    done: bool


def line_hash(line: str) -> str:
    return hashlib.sha1(line.encode("utf-8")).hexdigest()[:10]


def _label(body: str) -> str:
    cleaned = _DONE_MARK.sub("", _DATE_MARK.sub("", body))
    return " ".join(cleaned.split())


def _markdown_files(root: Path):
    for path in sorted(root.rglob("*.md")):
        if not _SKIP_DIRS.intersection(path.relative_to(root).parts):
            yield path


def find_tasks(root: Path, day: str) -> list[VaultTask]:
    """Tasks due or scheduled on `day` ("YYYY-MM-DD"), skipping ⭐ vote lines."""
    found: list[VaultTask] = []
    for path in _markdown_files(root):
        for number, line in enumerate(path.read_text(encoding="utf-8").split("\n"), start=1):
            m = _TASK.match(line)
            if not m or "⭐" in line:
                continue
            if day not in _DATE_MARK.findall(m.group(4)):
                continue
            found.append(VaultTask(
                path=path.relative_to(root).as_posix(), line=number, hash=line_hash(line),
                text=_label(m.group(4)), done=m.group(2) != " ",
            ))
    return found


def set_task_done(content: str, line: int, expected_hash: str, done: bool, today: str) -> str:
    """Tick (adding '✅ today') or untick (dropping the ✅ date) the task on 1-based `line`."""
    lines = content.split("\n")
    if not 1 <= line <= len(lines) or line_hash(lines[line - 1]) != expected_hash:
        raise ValueError("this task changed in the vault; reload and try again")
    m = _TASK.match(lines[line - 1])
    if not m:
        raise ValueError("this line is no longer a task")
    body = _DONE_MARK.sub("", m.group(4))
    if done:
        lines[line - 1] = f"{m.group(1)}x{m.group(3)}{body} ✅ {today}"
    else:
        lines[line - 1] = f"{m.group(1)} {m.group(3)}{body}"
    return "\n".join(lines)


def _task_line(content: str, line: int, expected_hash: str) -> tuple[list[str], "re.Match[str]"]:
    lines = content.split("\n")
    if not 1 <= line <= len(lines) or line_hash(lines[line - 1]) != expected_hash:
        raise ValueError("this task changed in the vault; reload and try again")
    m = _TASK.match(lines[line - 1])
    if not m:
        raise ValueError("this line is no longer a task")
    return lines, m


def set_task_text(content: str, line: int, expected_hash: str, text: str) -> str:
    """Rename the task on 1-based `line`, keeping its date marks, ✅ date and anything after them."""
    label = " ".join(text.split())
    if not label or len(label) > 300:
        raise ValueError("task must be 1-300 characters")
    lines, m = _task_line(content, line, expected_hash)
    body = m.group(4)
    mark = _TAIL_MARK.search(body)
    tail = f" {body[mark.start():]}" if mark else ""
    lines[line - 1] = f"{m.group(1)}{m.group(2)}{m.group(3)}{label}{tail}"
    return "\n".join(lines)


def remove_task(content: str, line: int, expected_hash: str) -> str:
    """Delete the task on 1-based `line`."""
    lines, _ = _task_line(content, line, expected_hash)
    del lines[line - 1]
    return "\n".join(lines)


def task_file(root: Path, rel: str) -> Path:
    """Resolve a vault-relative markdown path, refusing anything outside the vault or in hidden folders."""
    path = (root / rel).resolve()
    inside = path.is_relative_to(root.resolve()) and path.suffix == ".md" and path.is_file()
    if not inside or _SKIP_DIRS.intersection(path.relative_to(root.resolve()).parts):
        raise ValueError("not a vault note")
    return path


def add_task(content: str, text: str, day: str) -> str:
    """Add '- [ ] text ⏳ day' at the end of the note's '## Tasks' section (after its query block)."""
    label = " ".join(text.split())
    if not label or len(label) > 300:
        raise ValueError("task must be 1-300 characters")
    entry = f"- [ ] {label} ⏳ {day}"
    lines = content.split("\n")
    at = next((i for i, l in enumerate(lines) if l.strip() == "## Tasks"), None)
    if at is None:
        return content.rstrip("\n") + f"\n\n## Tasks\n{entry}\n"
    end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
    body = lines[at + 1:end]
    while body and not body[-1].strip():
        body.pop()
    return "\n".join([*lines[:at + 1], *body, entry, "", *lines[end:]])
