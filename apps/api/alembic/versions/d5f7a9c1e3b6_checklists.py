"""checklists under goals and month checkpoints

Revision ID: d5f7a9c1e3b6
Revises: c1e3a5b7d9f2
Create Date: 2026-10-09 18:00:00

A stream's quarter goal, each month's checkpoint and each Overview goal card can hold lines with a done flag. Existing single-line
goals and checkpoints become one line each, so nothing is lost; the old text columns stay as a summary of the lines.
"""
import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5f7a9c1e3b6"
down_revision: Union[str, None] = "c1e3a5b7d9f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _line(text: str) -> list[dict]:
    text = " ".join((text or "").split())
    return [{"id": uuid.uuid4().hex[:8], "text": text, "done": False}] if text else []


def upgrade() -> None:
    op.add_column("planner_quarter_streams", sa.Column("goal_checklist", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("planner_goals", sa.Column("checklist", sa.JSON(), nullable=False, server_default="[]"))
    bind = op.get_bind()
    streams = sa.table("planner_quarter_streams", sa.column("id", sa.Integer), sa.column("goal", sa.Text),
                       sa.column("goal_checklist", sa.JSON), sa.column("checkpoints", sa.JSON))
    for row in bind.execute(sa.select(streams.c.id, streams.c.goal, streams.c.checkpoints)).all():
        checkpoints = row.checkpoints if isinstance(row.checkpoints, list) else json.loads(row.checkpoints or "[]")
        upgraded = [{**c, "checklist": _line(c.get("text", ""))} for c in checkpoints]
        bind.execute(streams.update().where(streams.c.id == row.id).values(goal_checklist=_line(row.goal), checkpoints=upgraded))


def downgrade() -> None:
    op.drop_column("planner_goals", "checklist")
    op.drop_column("planner_quarter_streams", "goal_checklist")
