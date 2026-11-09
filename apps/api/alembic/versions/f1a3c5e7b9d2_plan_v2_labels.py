"""planner_tasks: goal_ref, label_month, label_date (Plan v2)

Revision ID: f1a3c5e7b9d2
Revises: d4f6a8c0e2b9
Create Date: 2026-11-09 08:00:00

DDL only, additive: three nullable columns, so the previous image ignores them and can still insert a task. Nothing is
filled here; `python -m app.cli plan-v2-migrate` does that. `label_month` is 'YYYY-MM' (a CHECK on Postgres; SQLite has no
regex operator, and the API validates it either way). `label_date` is a separate column rather than `scheduled_on`: a lane
item with a scheduled day would leave the undated tray and show on the calendar views. The downgrade drops the columns.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a3c5e7b9d2"
down_revision: Union[str, None] = "d4f6a8c0e2b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK = "ck_planner_tasks_label_month"


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("goal_ref", sa.String(16), nullable=True))
    op.add_column("planner_tasks", sa.Column("label_month", sa.String(7), nullable=True))
    op.add_column("planner_tasks", sa.Column("label_date", sa.Date(), nullable=True))
    if op.get_bind().dialect.name == "postgresql":
        op.create_check_constraint(CHECK, "planner_tasks", "label_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(CHECK, "planner_tasks", type_="check")
    with op.batch_alter_table("planner_tasks") as batch:
        batch.drop_column("label_date")
        batch.drop_column("label_month")
        batch.drop_column("goal_ref")
