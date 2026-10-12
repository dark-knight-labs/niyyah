"""habits and their daily checks

Revision ID: b8d0f2a4c6e1
Revises: a6c8e0f2b4d1
Create Date: 2026-10-12 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b8d0f2a4c6e1"
down_revision: Union[str, None] = "a6c8e0f2b4d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_habits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("block", sa.String(20), nullable=False),
        sa.Column("anchor", sa.String(60), nullable=False, server_default=""),
        sa.Column("per_week", sa.Integer(), nullable=False, server_default="7"),
        sa.Column("minimum", sa.String(120), nullable=False, server_default=""),
        sa.Column("stage", sa.String(10), nullable=False, server_default="installing"),
        sa.Column("stream", sa.String(24), nullable=True),
        sa.Column("gate_pct", sa.Integer(), nullable=False, server_default="80"),
        sa.Column("gate_weeks", sa.Integer(), nullable=False, server_default="8"),
        sa.Column("trip_pct", sa.Integer(), nullable=True),
        sa.Column("trip_weeks", sa.Integer(), nullable=True),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "planner_habit_checks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("habit_id", sa.Integer(), sa.ForeignKey("planner_habits.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("level", sa.String(4), nullable=False),
        sa.UniqueConstraint("habit_id", "day"),
    )


def downgrade() -> None:
    op.drop_table("planner_habit_checks")
    op.drop_table("planner_habits")
