"""blocks and schedule stream

Revision ID: f2b4d6a8c013
Revises: e7a2c4d9b013
Create Date: 2026-10-09 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2b4d6a8c013"
down_revision: Union[str, None] = "e7a2c4d9b013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("ring_name", sa.String(6), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("counts_for_stars", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("user_id", "key", name="uq_planner_block_user_key"),
    )
    op.create_index("ix_planner_blocks_user_id", "planner_blocks", ["user_id"])
    op.add_column("planner_schedule_blocks", sa.Column("stream", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("planner_schedule_blocks", "stream")
    op.drop_table("planner_blocks")
