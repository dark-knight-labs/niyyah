"""suggestion_bundles, suggestion_changes

Revision ID: f1a3c5e7b9d2
Revises: b7d9f1a3c5e8
Create Date: 2026-11-06 14:00:00

Additive: two new tables, so the previous image ignores them. Downgrade drops them (pending and applied suggestions are lost;
take a pg_dump first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a3c5e7b9d2"
down_revision: Union[str, None] = "b7d9f1a3c5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "suggestion_bundles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(80), nullable=False),
        sa.Column("run_id", sa.String(36), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_suggestion_bundles_user_status", "suggestion_bundles", ["user_id", "status"])
    op.create_table(
        "suggestion_changes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bundle_id", sa.Integer(), sa.ForeignKey("suggestion_bundles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("op", sa.String(16), nullable=False),
        sa.Column("entity", sa.String(24), nullable=False),
        sa.Column("target", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("base", sa.JSON(), nullable=True),
        sa.Column("ref", sa.String(8), nullable=True),
        sa.Column("created_key", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("inverse", sa.JSON(), nullable=True),
        sa.UniqueConstraint("bundle_id", "seq", name="uq_suggestion_change_seq"),
    )


def downgrade() -> None:
    op.drop_table("suggestion_changes")
    op.drop_index("ix_suggestion_bundles_user_status", table_name="suggestion_bundles")
    op.drop_table("suggestion_bundles")
