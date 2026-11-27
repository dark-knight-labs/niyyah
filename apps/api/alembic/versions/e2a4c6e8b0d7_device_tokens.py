"""device tokens and their idempotent captures

Revision ID: e2a4c6e8b0d7
Revises: a2c4e6f8b0d3
Create Date: 2026-11-27 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2a4c6e8b0d7"
down_revision: Union[str, None] = "a2c4e6f8b0d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("scope", sa.String(20), nullable=False, server_default="capture"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_device_tokens_user_id", "device_tokens", ["user_id"])
    op.create_table(
        "device_captures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("device_token_id", sa.Integer(), sa.ForeignKey("device_tokens.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("planner_tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("device_token_id", "client_id", name="uq_device_capture_client"),
    )
    op.create_index("ix_device_captures_task_id", "device_captures", ["task_id"])


def downgrade() -> None:
    op.drop_index("ix_device_captures_task_id", table_name="device_captures")
    op.drop_table("device_captures")
    op.drop_index("ix_device_tokens_user_id", table_name="device_tokens")
    op.drop_table("device_tokens")
