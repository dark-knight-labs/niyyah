"""boards, board_nodes, board_edges

Revision ID: e6a8c0d2f4b7
Revises: d1f3b5c7e9a2
Create Date: 2026-11-05 19:00:00

Additive: three new tables, so the previous image ignores them. Downgrade drops them (the boards are lost; take a pg_dump first).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e6a8c0d2f4b7"
down_revision: Union[str, None] = "d1f3b5c7e9a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False, server_default="free"),
        sa.Column("viewport", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_boards_user_id", "boards", ["user_id"])
    op.create_index("uq_board_life_per_user", "boards", ["user_id"], unique=True,
                    postgresql_where=sa.text("kind = 'life'"), sqlite_where=sa.text("kind = 'life'"))
    op.create_table(
        "board_nodes",
        sa.Column("board_id", sa.Integer(), sa.ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("parent_id", sa.String(36), nullable=True),
        sa.Column("parent_key", sa.String(80), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("x", sa.Float(), nullable=True),
        sa.Column("y", sa.Float(), nullable=True),
        sa.Column("w", sa.Float(), nullable=True),
        sa.Column("h", sa.Float(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("style", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("collapsed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("hidden", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("ref_key", sa.String(80), nullable=True),
        sa.Column("frame_id", sa.String(36), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("uq_board_node_ref", "board_nodes", ["board_id", "ref_key"], unique=True,
                    postgresql_where=sa.text("ref_key IS NOT NULL"), sqlite_where=sa.text("ref_key IS NOT NULL"))
    op.create_table(
        "board_edges",
        sa.Column("board_id", sa.Integer(), sa.ForeignKey("boards.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("from_id", sa.String(80), nullable=False),
        sa.Column("to_id", sa.String(80), nullable=False),
        sa.Column("label", sa.String(200), nullable=False, server_default=""),
        sa.Column("style", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("board_edges")
    op.drop_index("uq_board_node_ref", table_name="board_nodes")
    op.drop_table("board_nodes")
    op.drop_index("uq_board_life_per_user", table_name="boards")
    op.drop_index("ix_boards_user_id", table_name="boards")
    op.drop_table("boards")
