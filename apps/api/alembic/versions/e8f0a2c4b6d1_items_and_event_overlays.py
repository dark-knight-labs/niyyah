"""item fields on tasks, and calendar event overlays

Revision ID: e8f0a2c4b6d1
Revises: c4e6a8b0d2f5
Create Date: 2026-11-01 12:00:00

Written by hand (no autogenerate): a database can hold plugin tables this metadata does not know.
Every new column has a database default, so an older image can still insert tasks. Overlays live in their own table,
which older code never reads. `status` is backfilled from `done`; after any rollout or rollback run RECONCILE_SQL
(app.services.planner_items), which makes `status` agree with `done` again (`done` wins).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e8f0a2c4b6d1"
down_revision: Union[str, None] = "c4e6a8b0d2f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TASK_COLUMNS = ("start_min", "end_min", "weight", "status", "checklist")


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("start_min", sa.Integer(), nullable=True))
    op.add_column("planner_tasks", sa.Column("end_min", sa.Integer(), nullable=True))
    op.add_column("planner_tasks", sa.Column("weight", sa.SmallInteger(), nullable=False, server_default=sa.text("0")))
    op.add_column("planner_tasks", sa.Column("status", sa.String(10), nullable=False, server_default="open"))
    op.add_column("planner_tasks", sa.Column("checklist", sa.JSON(), nullable=False, server_default="[]"))
    tasks = sa.table("planner_tasks", sa.column("done", sa.Boolean), sa.column("status", sa.String))
    op.execute(tasks.update().where(tasks.c.done == sa.true()).values(status="done"))

    op.create_table(
        "planner_event_overlays",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_key", sa.String(400), nullable=False),
        sa.Column("source_calendar", sa.String(120), nullable=False, server_default=""),
        sa.Column("title", sa.String(300), nullable=False, server_default=""),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("weight", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("stream", sa.String(24), nullable=True),
        sa.Column("products", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("checklist", sa.JSON(), nullable=False, server_default="[]"),
        sa.UniqueConstraint("user_id", "event_key", name="uq_planner_event_overlay_user_key"),
    )
    op.create_index("ix_planner_event_overlays_user_id", "planner_event_overlays", ["user_id"])


def downgrade() -> None:
    """Destructive: drops every overlay and the item fields of every task. Take a pg_dump first."""
    op.drop_table("planner_event_overlays")
    with op.batch_alter_table("planner_tasks") as batch:
        for name in reversed(TASK_COLUMNS):
            batch.drop_column(name)
