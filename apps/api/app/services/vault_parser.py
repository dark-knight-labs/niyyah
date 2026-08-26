import re
from dataclasses import dataclass
from datetime import date

import yaml

CANONICAL_BLOCKS = ["soul", "onething", "ops", "body", "distribution", "fnf", "sleep"]

BLOCK_ALIASES = {
    "mind": "onething",
    "operating": "ops",
}

# Verified against Calendar/Daily/2026-08-23.md's `modeMeta` dataviewjs table.
# Re-sync this table if that daily-template object ever changes.
MODE_META = {
    "full":       {"possible": 21, "color": "#10b981"},
    "yellow":     {"possible": 14, "color": "#f59e0b"},
    "compressed": {"possible": 21, "color": "#3b82f6"},
    "minimal":    {"possible": 12, "color": "#8b5cf6"},
    "off":        {"possible": 2,  "color": "#ef4444"},
    "ramadan":    {"possible": 14, "color": "#06b6d4"},
    "fasting":    {"possible": 21, "color": "#f59e0b"},
}

_CALLOUT_RE = re.compile(r"^>\s*\[!(\w+)\]")
_CHECKBOX_RE = re.compile(r"^>\s*-\s*\[( |x)\]\s*(⭐+)")


@dataclass
class ParsedDay:
    date: date
    mode: str
    possible: int
    total: int
    blocks: dict[str, int]
    focus: str | None
    log: str | None


def _split_frontmatter(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    frontmatter = yaml.safe_load(parts[1]) or {}
    return frontmatter, parts[2]


def _parse_blocks(body: str) -> dict[str, int]:
    blocks: dict[str, int] = {}
    current_block: str | None = None

    for line in body.splitlines():
        callout_match = _CALLOUT_RE.match(line)
        if callout_match:
            name = BLOCK_ALIASES.get(callout_match.group(1).lower(), callout_match.group(1).lower())
            current_block = name if name in CANONICAL_BLOCKS else None
            if current_block:
                blocks.setdefault(current_block, 0)
            continue

        if current_block is None:
            continue

        if not line.startswith(">"):
            current_block = None
            continue

        checkbox_match = _CHECKBOX_RE.match(line)
        if checkbox_match and checkbox_match.group(1) == "x":
            stars = len(checkbox_match.group(2))
            blocks[current_block] = max(blocks[current_block], stars)

    return blocks


def _extract_section(body: str, heading: str) -> str | None:
    lines = body.splitlines()
    start = next((i + 1 for i, line in enumerate(lines) if line.strip() == heading), None)
    if start is None:
        return None
    section_lines = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        section_lines.append(line)
    joined = "\n".join(section_lines).strip()
    return joined or None


def parse_daily_note(content: str, note_date: date) -> ParsedDay:
    frontmatter, body = _split_frontmatter(content)
    mode = frontmatter.get("mode", "full")
    if not isinstance(mode, str) or not mode:
        # `mode:` present but empty/null in the YAML yields None here (the
        # dict .get default only applies when the key is absent). VaultDay.mode
        # is a non-nullable string column, so an unnormalized None would raise
        # an IntegrityError at commit time instead of falling back cleanly.
        mode = "full"
    meta = MODE_META.get(mode, MODE_META["full"])

    blocks = _parse_blocks(body)
    total = sum(blocks.values())

    focus = None
    focus_section = _extract_section(body, "## Focus")
    if focus_section:
        for line in focus_section.splitlines():
            stripped = line.strip()
            if stripped:
                focus = re.sub(r"^-\s*", "", stripped)
                break

    log = None
    log_section = _extract_section(body, "## Log")
    if log_section:
        log_lines = [line.strip() for line in log_section.splitlines() if line.strip().startswith("- ")]
        log = "\n".join(log_lines) or None

    return ParsedDay(
        date=note_date,
        mode=mode,
        possible=meta["possible"],
        total=total,
        blocks=blocks,
        focus=focus,
        log=log,
    )
