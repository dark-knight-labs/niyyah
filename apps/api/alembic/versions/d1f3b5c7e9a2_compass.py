"""compass (mission and vision) and personas.stream

Revision ID: d1f3b5c7e9a2
Revises: a7c9e1b3d5f0
Create Date: 2026-11-03 14:00:00

Additive: a new table and one nullable column, so the previous image ignores both. Downgrade drops the column, then
the table (the compass rows are lost; take a pg_dump first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d1f3b5c7e9a2"
down_revision: Union[str, None] = "a7c9e1b3d5f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "compass",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mission", sa.Text(), nullable=False, server_default=""),
        sa.Column("vision", sa.Text(), nullable=False, server_default=""),
        sa.Column("vision_horizon", sa.String(10), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", name="uq_compass_user"),
    )
    with op.batch_alter_table("personas") as batch:
        batch.add_column(sa.Column("stream", sa.String(24), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("personas") as batch:
        batch.drop_column("stream")
    op.drop_table("compass")
