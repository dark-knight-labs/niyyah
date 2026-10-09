"""planner tables and per-user vault days

Revision ID: d4e8b1a95c20
Revises: c3a1f0d27b64
Create Date: 2026-10-08 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8b1a95c20"
down_revision: Union[str, None] = "c3a1f0d27b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _owner() -> sa.Column:
    return sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)


def _create(name: str, *columns, index_user: bool = True) -> None:
    op.create_table(name, sa.Column("id", sa.Integer(), primary_key=True), *columns)
    if index_user:
        op.create_index(f"ix_{name}_user_id", name, ["user_id"])


def upgrade() -> None:
    # vault_days becomes per-user; rows synced from the vault keep user_id NULL.
    op.add_column("vault_days", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_vault_days_user_id", "vault_days", "users", ["user_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_vault_days_user_id", "vault_days", ["user_id"])
    op.drop_index("ix_vault_days_date", table_name="vault_days")
    op.create_index("ix_vault_days_date", "vault_days", ["date"], unique=False)
    op.create_unique_constraint("uq_vault_days_user_date", "vault_days", ["user_id", "date"])

    _create("planner_tasks", _owner(),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("due_on", sa.Date()), sa.Column("scheduled_on", sa.Date()), sa.Column("start_on", sa.Date()),
            sa.Column("done_on", sa.Date()), sa.Column("source_path", sa.String(500)),
            sa.Column("position", sa.Integer(), nullable=False))
    for col in ("due_on", "scheduled_on", "start_on"):
        op.create_index(f"ix_planner_tasks_{col}", "planner_tasks", [col])

    _create("planner_log_entries", _owner(),
            sa.Column("day", sa.Date(), nullable=False), sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.UniqueConstraint("user_id", "day", "position", name="uq_planner_log_user_day_pos"))
    op.create_index("ix_planner_log_entries_day", "planner_log_entries", ["day"])

    _create("planner_goals", _owner(),
            sa.Column("position", sa.Integer(), nullable=False), sa.Column("title", sa.String(200), nullable=False),
            sa.Column("value", sa.String(400), nullable=False), sa.Column("caption", sa.String(400), nullable=False),
            sa.Column("progress", sa.Integer()))

    _create("planner_quarters", _owner(),
            sa.Column("label", sa.String(10), nullable=False), sa.Column("starts", sa.Date()), sa.Column("ends", sa.Date()),
            sa.Column("objective", sa.Text(), nullable=False), sa.Column("objective_ar", sa.Text(), nullable=False),
            sa.UniqueConstraint("user_id", "label", name="uq_planner_quarter_user_label"))

    _create("planner_quarter_streams", _owner(),
            sa.Column("quarter", sa.String(10), nullable=False), sa.Column("slug", sa.String(24), nullable=False),
            sa.Column("name", sa.String(80), nullable=False), sa.Column("color", sa.String(20), nullable=False),
            sa.Column("icon", sa.String(30), nullable=False), sa.Column("slot", sa.String(200), nullable=False),
            sa.Column("weekly", sa.Boolean(), nullable=False), sa.Column("has_pipeline", sa.Boolean(), nullable=False),
            sa.Column("in_note", sa.Boolean(), nullable=False), sa.Column("goal", sa.Text(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False), sa.Column("checkpoints", sa.JSON(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.UniqueConstraint("user_id", "quarter", "slug", name="uq_planner_qstream"))
    op.create_index("ix_planner_quarter_streams_quarter", "planner_quarter_streams", ["quarter"])

    _create("planner_week_objectives", _owner(),
            sa.Column("week", sa.String(10), nullable=False), sa.Column("stream", sa.String(24), nullable=False),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("done", sa.Boolean(), nullable=False),
            sa.Column("checkpoint", sa.String(3)),
            sa.UniqueConstraint("user_id", "week", "stream", name="uq_planner_objective"))
    op.create_index("ix_planner_week_objectives_week", "planner_week_objectives", ["week"])

    _create("planner_pipeline_items", _owner(),
            sa.Column("stream", sa.String(24), nullable=False), sa.Column("lane", sa.String(10), nullable=False),
            sa.Column("text", sa.Text(), nullable=False), sa.Column("description", sa.Text(), nullable=False),
            sa.Column("product", sa.String(100)), sa.Column("checkpoint", sa.String(3)),
            sa.Column("added_on", sa.Date()), sa.Column("done_on", sa.Date()), sa.Column("focus_week", sa.String(10)),
            sa.Column("done", sa.Boolean(), nullable=False), sa.Column("blocked_by", sa.JSON(), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False))
    op.create_index("ix_planner_pipeline_items_stream", "planner_pipeline_items", ["stream"])

    _create("planner_notebook_entries", _owner(),
            sa.Column("stream", sa.String(24), nullable=False), sa.Column("ext_id", sa.String(24), nullable=False),
            sa.Column("kind", sa.String(10), nullable=False), sa.Column("title", sa.String(200), nullable=False),
            sa.Column("body", sa.Text(), nullable=False), sa.Column("entry_date", sa.String(10)),
            sa.Column("is_open", sa.Boolean()), sa.Column("position", sa.Integer(), nullable=False),
            sa.UniqueConstraint("user_id", "stream", "ext_id", name="uq_planner_notebook_ext"))
    op.create_index("ix_planner_notebook_entries_stream", "planner_notebook_entries", ["stream"])

    op.create_table("planner_schedule_settings",
                    sa.Column("id", sa.Integer(), primary_key=True),
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True),
                    sa.Column("meta", sa.JSON(), nullable=False))

    _create("planner_schedule_blocks", _owner(),
            sa.Column("day_type", sa.String(10), nullable=False), sa.Column("block", sa.String(20), nullable=False),
            sa.Column("start", sa.String(20), nullable=False), sa.Column("end", sa.String(20), nullable=False),
            sa.Column("what", sa.Text(), nullable=False), sa.Column("position", sa.Integer(), nullable=False))


def downgrade() -> None:
    for name in ("planner_schedule_blocks", "planner_schedule_settings", "planner_notebook_entries",
                 "planner_pipeline_items", "planner_week_objectives", "planner_quarter_streams", "planner_quarters",
                 "planner_goals", "planner_log_entries", "planner_tasks"):
        op.drop_table(name)
    op.drop_constraint("uq_vault_days_user_date", "vault_days", type_="unique")
    op.drop_index("ix_vault_days_date", table_name="vault_days")
    op.create_index("ix_vault_days_date", "vault_days", ["date"], unique=True)
    op.drop_index("ix_vault_days_user_id", table_name="vault_days")
    op.drop_constraint("fk_vault_days_user_id", "vault_days", type_="foreignkey")
    op.drop_column("vault_days", "user_id")
