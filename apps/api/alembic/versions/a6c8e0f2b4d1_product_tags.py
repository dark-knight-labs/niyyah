"""several product tags per pipeline item

Revision ID: a6c8e0f2b4d1
Revises: d5f7a9c1e3b6
Create Date: 2026-10-11 12:00:00

`product` (one string) becomes `products` (a JSON list). An item's existing product becomes its first and only tag.
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a6c8e0f2b4d1"
down_revision: Union[str, None] = "d5f7a9c1e3b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

items = sa.table("planner_pipeline_items", sa.column("id", sa.Integer), sa.column("product", sa.String), sa.column("products", sa.JSON))


def upgrade() -> None:
    op.add_column("planner_pipeline_items", sa.Column("products", sa.JSON(), nullable=False, server_default="[]"))
    conn = op.get_bind()
    for row in conn.execute(sa.select(items.c.id, items.c.product).where(items.c.product.is_not(None))):
        tag = " ".join(row.product.split())
        if tag:
            conn.execute(items.update().where(items.c.id == row.id).values(products=[tag]))
    with op.batch_alter_table("planner_pipeline_items") as batch:
        batch.drop_column("product")


def downgrade() -> None:
    op.add_column("planner_pipeline_items", sa.Column("product", sa.String(100), nullable=True))
    conn = op.get_bind()
    for row in conn.execute(sa.select(items.c.id, items.c.products)):
        tags = row.products if isinstance(row.products, list) else json.loads(row.products or "[]")
        if tags:
            conn.execute(items.update().where(items.c.id == row.id).values(product=tags[0]))
    with op.batch_alter_table("planner_pipeline_items") as batch:
        batch.drop_column("products")
