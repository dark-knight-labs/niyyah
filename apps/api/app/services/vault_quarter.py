"""The quarter note: Calendar/Quarterly/2026-Q4.md. Read-only in the app (reasoning lives in Doctrine).

    ---
    type: quarter
    quarter: 2026-Q4
    starts: 2026-10-01
    ends: 2026-12-31
    ---
    # Earn Jannah through service and knowledge.
    > رضا الله سبحانه وتعالى          (optional: the same objective in Arabic)

    ## kahf
    - goal: 1,000 subscribers ...
    - status: active
    - oct: 500 subs
    - nov: 750 subs
    - dec: 1,000 subs
"""
import re
from datetime import date

from app.services.vault_streams import (
    COLORS, DEFAULTS, ICONS, MONTHS, SLUG, STATUSES, Stream, default_streams, make_stream,
)

_KEY = re.compile(r"^- (\w+):[ \t]*(.*)$")
FIELD_KEYS = ("name", "color", "icon", "slot", "weekly", "goal", "status")
MAX_FIELD_CHARS = 400


def quarter_for(day: date) -> str:
    return f"{day.year}-Q{(day.month - 1) // 3 + 1}"


def quarter_path(label: str) -> str:
    return f"Calendar/Quarterly/{label}.md"


def quarter_months(label: str) -> list[str]:
    """The three month keys of '2026-Q4' -> ['oct', 'nov', 'dec']."""
    first = 3 * (int(label[-1]) - 1)
    return list(MONTHS[first:first + 3])


def skeleton(label: str) -> str:
    return "\n".join([
        "---", "type: quarter", f"quarter: {label}", "---", "# Set this quarter's Super Objective", "",
    ])


def _split_frontmatter(content: str) -> tuple[dict[str, str], list[str]]:
    """(frontmatter keys, body lines)."""
    lines = content.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, lines
    meta: dict[str, str] = {}
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return meta, lines[i + 1:]
        key, _, value = line.partition(":")
        meta[key.strip()] = value.strip()
    return meta, []


def parse_quarter(content: str) -> dict:
    """{quarter, starts, ends, objective, objective_ar, streams: [{stream, stream_info, goal, status, checkpoints}]}.

    Every '## <slug>' section is a stream; `stream_info` is the resolved Stream (defaults filled in).
    """
    meta, body = _split_frontmatter(content)
    objective, arabic = "", ""
    sections: dict[str, dict] = {}
    current: dict | None = None
    for line in body:
        if line.startswith("# ") and not objective:
            objective = line[2:].strip()
        elif line.startswith("> ") and not arabic and current is None:
            arabic = line[2:].strip()
        elif line.startswith("## "):
            name = line[3:].strip().lower()
            current = sections.setdefault(name, {"fields": {}, "checkpoints": []}) if SLUG.match(name) else None
        elif current is not None:
            m = _KEY.match(line)
            if not m:
                continue
            key, value = m.group(1).lower(), m.group(2).strip()
            if key in FIELD_KEYS:
                current["fields"][key] = value
            elif key in MONTHS:
                current["checkpoints"].append({"month": key, "text": value})
    streams = [
        {"stream": sid, "info": make_stream(sid, sec["fields"]), "goal": sec["fields"].get("goal", ""),
         "status": sec["fields"].get("status", ""), "checkpoints": sec["checkpoints"]}
        for sid, sec in sections.items()
    ]
    return {"quarter": meta.get("quarter", ""), "starts": meta.get("starts"), "ends": meta.get("ends"),
            "objective": objective, "objective_ar": arabic, "streams": streams}


def load_streams(content: str | None) -> list[Stream]:
    """Streams of the quarter note in note order, then the objective-only built-ins (sleep) it does not define.

    Without a quarter note the built-in streams stand in, so weekly objectives keep working.
    """
    if content is None:
        return default_streams()
    found = [s["info"] for s in parse_quarter(content)["streams"]]
    have = {s.id for s in found}
    extra = [make_stream(sid, goal=False) for sid, d in DEFAULTS.items() if d.get("goal") is False and sid not in have]
    return found + extra


# --- edits (pure: string in, string out) -------------------------------------------------------------------------

def _one_line(value: str, what: str) -> str:
    cleaned = " ".join(value.split())
    if len(cleaned) > MAX_FIELD_CHARS:
        raise ValueError(f"{what} is longer than {MAX_FIELD_CHARS} characters")
    return cleaned


def _validate(key: str, value: str) -> str:
    value = _one_line(value, key)
    if key == "color" and value not in COLORS:
        raise ValueError(f"unknown colour '{value}'")
    if key == "icon" and value not in ICONS:
        raise ValueError(f"unknown icon '{value}'")
    if key == "status" and value not in STATUSES:
        raise ValueError(f"unknown status '{value}'")
    if key == "weekly" and value.lower() not in ("yes", "no"):
        raise ValueError("weekly must be yes or no")
    if key == "name" and not value:
        raise ValueError("name is empty")
    return value


def _section(lines: list[str], stream: str) -> tuple[int, int]:
    """(heading index, index after the section's last non-blank line)."""
    for i, line in enumerate(lines):
        if line.startswith("## ") and line[3:].strip().lower() == stream:
            end = i + 1
            for j in range(i + 1, len(lines)):
                if lines[j].startswith("## "):
                    break
                if lines[j].strip():
                    end = j + 1
            return i, end
    raise ValueError(f"unknown stream '{stream}'")


def _set_key(lines: list[str], head: int, end: int, key: str, value: str) -> int:
    """Set '- key: value' inside the section; returns the new section end."""
    for j in range(head + 1, end):
        m = _KEY.match(lines[j])
        if m and m.group(1).lower() == key:
            lines[j] = f"- {key}: {value}"
            return end
    last = head
    for j in range(head + 1, end):
        if _KEY.match(lines[j]):
            last = j
    lines.insert(last + 1, f"- {key}: {value}")
    return end + 1


def update_stream(content: str | None, label: str, stream: str, fields: dict[str, str]) -> str:
    """Change name/colour/icon/slot/weekly/goal/status and month checkpoints of one stream.

    `fields` keys are FIELD_KEYS or month keys of the quarter; an empty month value is kept as an empty checkpoint.
    """
    lines = (content or skeleton(label)).split("\n")
    head, end = _section(lines, stream)
    months = quarter_months(label)
    for key, value in fields.items():
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
        end = _set_key(lines, head, end, key, _validate(key, value) if key in FIELD_KEYS else _one_line(value, key))
    return "\n".join(lines)


def add_stream(content: str | None, label: str, stream: str, fields: dict[str, str]) -> str:
    """Append a new '## <stream>' section; the id is a lowercase slug and must be new."""
    if not SLUG.match(stream):
        raise ValueError("id must be 2-24 lowercase letters, digits or dashes, starting with a letter")
    lines = (content or skeleton(label)).split("\n")
    if any(line.startswith("## ") and line[3:].strip().lower() == stream for line in lines):
        raise ValueError(f"stream '{stream}' already exists")
    while lines and lines[-1] == "":
        lines.pop()
    lines += ["", f"## {stream}"]
    months = quarter_months(label)
    data = {"status": "committed", **fields}
    for key in FIELD_KEYS + tuple(months):
        if key in data and (key in months or data[key].strip()):
            lines.append(f"- {key}: {_validate(key, data[key]) if key in FIELD_KEYS else _one_line(data[key], key)}")
    for key in data:
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
    if not any(line == f"- name: {data.get('name', '')}" for line in lines):
        raise ValueError("name is required")
    lines.append("")
    return "\n".join(lines)


def set_super_objective(content: str | None, label: str, text: str, arabic: str | None = None) -> str:
    """Replace the '# ' objective line (and the Arabic '> ' line right under it, when `arabic` is given)."""
    text = _one_line(text, "objective")
    if not text:
        raise ValueError("objective is empty")
    lines = (content or skeleton(label)).split("\n")
    for i, line in enumerate(lines):
        if line.startswith("# "):
            lines[i] = f"# {text}"
            if arabic is not None:
                has = i + 1 < len(lines) and lines[i + 1].startswith("> ")
                new = f"> {_one_line(arabic, 'Arabic text')}" if arabic.strip() else None
                if has and new:
                    lines[i + 1] = new
                elif has:
                    del lines[i + 1]
                elif new:
                    lines.insert(i + 1, new)
            return "\n".join(lines)
    raise ValueError("the quarter note has no objective line")
