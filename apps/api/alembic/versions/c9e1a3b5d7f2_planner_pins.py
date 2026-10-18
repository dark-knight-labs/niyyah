"""planner pins

Revision ID: c9e1a3b5d7f2
Revises: b8d0f2a4c6e1
Create Date: 2026-10-18 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9e1a3b5d7f2"
down_revision: Union[str, None] = "b8d0f2a4c6e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_pins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(400), nullable=False),
        sa.UniqueConstraint("user_id", "key", name="uq_planner_pins_user_key"),
    )
    op.create_index("ix_planner_pins_user_id", "planner_pins", ["user_id"])


def downgrade() -> None:
    op.drop_table("planner_pins")
