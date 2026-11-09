"""planner_products table, planner_habits.goal_ref (Plan v3)

Revision ID: a2c4e6f8b0d3
Revises: f1a3c5e7b9d2
Create Date: 2026-11-09 12:00:00

DDL only, additive: a new table and one nullable column, so the previous image ignores both. Nothing is filled here;
`python -m app.cli plan-v3-migrate` seeds the products. The downgrade drops the table and the column.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a2c4e6f8b0d3"
down_revision: Union[str, None] = "f1a3c5e7b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_products",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("block", sa.String(24), nullable=False),
        sa.Column("slug", sa.String(32), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "block", "slug", name="uq_planner_product_block_slug"),
    )
    op.create_index("ix_planner_products_user_id", "planner_products", ["user_id"])
    op.add_column("planner_habits", sa.Column("goal_ref", sa.String(16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("planner_habits") as batch:
        batch.drop_column("goal_ref")
    op.drop_index("ix_planner_products_user_id", table_name="planner_products")
    op.drop_table("planner_products")
