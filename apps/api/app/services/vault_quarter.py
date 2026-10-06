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

from app.services.vault_streams import MONTHS, PIPELINE_STREAMS

_KEY = re.compile(r"^- (\w+):[ \t]*(.*)$")


def quarter_for(day: date) -> str:
    return f"{day.year}-Q{(day.month - 1) // 3 + 1}"


def quarter_path(label: str) -> str:
    return f"Calendar/Quarterly/{label}.md"


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
    """{quarter, starts, ends, objective, objective_ar, streams: [{stream, goal, status, checkpoints: [{month, text}]}]}"""
    meta, body = _split_frontmatter(content)
    objective, arabic = "", ""
    streams: dict[str, dict] = {}
    current: dict | None = None
    for line in body:
        if line.startswith("# ") and not objective:
            objective = line[2:].strip()
        elif line.startswith("> ") and not arabic and current is None:
            arabic = line[2:].strip()
        elif line.startswith("## "):
            name = line[3:].strip().lower()
            current = streams.setdefault(name, {"stream": name, "goal": "", "status": "", "checkpoints": []}) if name in PIPELINE_STREAMS else None
        elif current is not None:
            m = _KEY.match(line)
            if not m:
                continue
            key, value = m.group(1).lower(), m.group(2).strip()
            if key in ("goal", "status"):
                current[key] = value
            elif key in MONTHS:
                current["checkpoints"].append({"month": key, "text": value})
    ordered = [streams[s] for s in PIPELINE_STREAMS if s in streams]
    return {"quarter": meta.get("quarter", ""), "starts": meta.get("starts"), "ends": meta.get("ends"),
            "objective": objective, "objective_ar": arabic, "streams": ordered}
