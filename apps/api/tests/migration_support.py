"""Helpers for the migration tests: today's table definitions rewound to what an earlier revision looked like."""
import re

PLANNING_COLUMNS = ("lane", "lane_position", "focus_week", "objective_text", "objective_done", "focus_checkpoint", "checkpoint",
                    "blocked_by", "added_on", "parent_id", "origin")


def without_columns(ddl: str, columns: tuple[str, ...]) -> str:
    """CREATE TABLE text without the named columns (and the foreign key of parent_id), commas repaired."""
    drop = tuple(f"{c} " for c in columns)
    lines = [line for line in ddl.split("\n")
             if not line.strip().startswith(drop) and not (line.strip().startswith("FOREIGN KEY(parent_id)") and "parent_id" in columns)]
    return re.sub(r",\s*\n\)", "\n)", "\n".join(lines))
