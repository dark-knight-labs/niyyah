"""task description

Revision ID: c4e6a8b0d2f5
Revises: b3d5f7a9c1e4
Create Date: 2026-10-20 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4e6a8b0d2f5"
down_revision: Union[str, None] = "b3d5f7a9c1e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("description", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("planner_tasks") as batch:
        batch.drop_column("description")
