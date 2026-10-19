"""task stream

Revision ID: a1c3e5b7d9f2
Revises: c9e1a3b5d7f2
Create Date: 2026-10-19 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1c3e5b7d9f2"
down_revision: Union[str, None] = "c9e1a3b5d7f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("stream", sa.String(24), nullable=True))
    op.create_index("ix_planner_tasks_stream", "planner_tasks", ["stream"])


def downgrade() -> None:
    op.drop_index("ix_planner_tasks_stream", table_name="planner_tasks")
    op.drop_column("planner_tasks", "stream")
