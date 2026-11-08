"""planner_areas and planner_items: the shadow item tree (expand step)

Revision ID: d4f6a8c0e2b9
Revises: b7d9f1a3c5e8
Create Date: 2026-11-08 16:00:00

DDL only, additive: two new tables nothing reads yet, so the previous image ignores them. The data is filled by
`python -m app.cli tree-rebuild --all`, never by this revision. The downgrade drops only these two tables.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f6a8c0e2b9"
down_revision: Union[str, None] = "b7d9f1a3c5e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_areas",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(24), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("icon", sa.String(30), nullable=False),
        sa.Column("slot", sa.String(200), nullable=False, server_default=""),
        sa.Column("weekly", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("has_pipeline", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("in_note", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("legacy_ref", sa.String(80), nullable=True),
        sa.UniqueConstraint("user_id", "slug", name="uq_planner_area_slug"),
        sa.UniqueConstraint("user_id", "legacy_ref", name="uq_planner_area_legacy_ref"),
    )
    op.create_index("ix_planner_areas_user_id", "planner_areas", ["user_id"])
    op.create_table(
        "planner_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("area", sa.String(24), nullable=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("planner_items.id", ondelete="CASCADE"), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("subtitle", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("period", sa.String(10), nullable=True),
        sa.Column("horizon", sa.String(10), nullable=True),
        sa.Column("status", sa.String(10), nullable=False, server_default="open"),
        sa.Column("commitment", sa.String(20), nullable=True),
        sa.Column("day", sa.Date(), nullable=True),
        sa.Column("start_min", sa.Integer(), nullable=True),
        sa.Column("end_min", sa.Integer(), nullable=True),
        sa.Column("weight", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("blocked_by", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done_on", sa.Date(), nullable=True),
        sa.Column("created_on", sa.Date(), nullable=True),
        sa.Column("legacy_ref", sa.String(80), nullable=True),
        sa.UniqueConstraint("user_id", "legacy_ref", name="uq_planner_item_legacy_ref"),
    )
    op.create_index("ix_planner_items_user_id", "planner_items", ["user_id"])
    op.create_index("ix_planner_items_parent_id", "planner_items", ["parent_id"])


def downgrade() -> None:
    op.drop_index("ix_planner_items_parent_id", table_name="planner_items")
    op.drop_index("ix_planner_items_user_id", table_name="planner_items")
    op.drop_table("planner_items")
    op.drop_index("ix_planner_areas_user_id", table_name="planner_areas")
    op.drop_table("planner_areas")
