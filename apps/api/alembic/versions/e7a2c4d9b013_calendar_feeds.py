"""calendar feeds

Revision ID: e7a2c4d9b013
Revises: d4e8b1a95c20
Create Date: 2026-10-08 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7a2c4d9b013"
down_revision: Union[str, None] = "d4e8b1a95c20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_calendar_feeds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("color", sa.String(20)),
        sa.Column("email", sa.String(255)),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_planner_calendar_feeds_user_id", "planner_calendar_feeds", ["user_id"])


def downgrade() -> None:
    op.drop_table("planner_calendar_feeds")
