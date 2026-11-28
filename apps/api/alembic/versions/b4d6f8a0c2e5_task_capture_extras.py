"""task capture extras: link, deadline_at, tracked_seconds, timer_started_at on planner_tasks

Four nullable columns without defaults: on Postgres each ADD COLUMN is a catalog-only change (no table rewrite, a momentary
ACCESS EXCLUSIVE lock). Nothing is backfilled; an older image never names them, so it keeps inserting tasks.

Revision ID: b4d6f8a0c2e5
Revises: e2a4c6e8b0d7
Create Date: 2026-11-28 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4d6f8a0c2e5"
down_revision: Union[str, None] = "e2a4c6e8b0d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = ("link", "deadline_at", "tracked_seconds", "timer_started_at")


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("link", sa.String(2048), nullable=True))
    op.add_column("planner_tasks", sa.Column("deadline_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("planner_tasks", sa.Column("tracked_seconds", sa.Integer(), nullable=True))
    op.add_column("planner_tasks", sa.Column("timer_started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Drops what capture clients stored in these columns; the tasks themselves stay.
    with op.batch_alter_table("planner_tasks") as batch:
        for name in reversed(COLUMNS):
            batch.drop_column(name)
