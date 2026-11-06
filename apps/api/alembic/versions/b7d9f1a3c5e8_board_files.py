"""board_files: uploaded images and files for board nodes

Revision ID: b7d9f1a3c5e8
Revises: e6a8c0d2f4b7
Create Date: 2026-11-06 15:00:00

Additive: one new table, so the previous image ignores it. The downgrade drops it (the uploaded bytes are lost: take a pg_dump first).
Nodes keep pointing at a file id in style.file_id; after a downgrade they simply show "File unavailable".
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7d9f1a3c5e8"
down_revision: Union[str, None] = "e6a8c0d2f4b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "board_files",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("board_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_board_files_user_id", "board_files", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_board_files_user_id", table_name="board_files")
    op.drop_table("board_files")
