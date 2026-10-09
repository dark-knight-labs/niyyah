"""drop the rows synced from a vault checkout

Revision ID: c1e3a5b7d9f2
Revises: b4d6f8a0c125
Create Date: 2026-10-09 15:00:00

Before this, vault_days rows with no user belonged to the single-owner vault mode. Every day now belongs to a user.
Take a backup first: the rows are deleted (their votes with them).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1e3a5b7d9f2"
down_revision: Union[str, None] = "b4d6f8a0c125"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM vault_block_votes WHERE vault_day_id IN (SELECT id FROM vault_days WHERE user_id IS NULL)")
    op.execute("DELETE FROM vault_days WHERE user_id IS NULL")
    op.alter_column("vault_days", "user_id", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    op.alter_column("vault_days", "user_id", existing_type=sa.Integer(), nullable=True)
