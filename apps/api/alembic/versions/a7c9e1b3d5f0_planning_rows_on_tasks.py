"""pipeline items and week objectives become planner_tasks rows

Revision ID: a7c9e1b3d5f0
Revises: e8f0a2c4b6d1
Create Date: 2026-11-03 09:00:00

Written by hand (no autogenerate): a database can hold plugin tables this metadata does not know.

Upgrade: adds the planning columns to planner_tasks, copies every pipeline item and week objective into it (one mapping
function, app.services.planner_mapping, shared with the import of a version 1 export), de-duplicates a week's small domino
if an item pair shared it, then creates the partial unique index. planner_pipeline_items and planner_week_objectives are
NOT dropped and the app no longer writes them. Every new column is nullable or has a database default, so an older image
can still insert a task.

Downgrade: copies everything the old schema can represent back into the two old tables (lane rows -> pipeline items with
lane_position as their position, objective fields -> objectives; they replace what the old tables hold), deletes the lane
rows and objective-only rows that have no day from planner_tasks (a planning row with a day stays as a plain task, as the old
world had it), then drops the new columns. Lost on downgrade, by design: parent_id and origin. Take a pg_dump first.
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.services.planner_mapping import map_planning

revision: str = "a7c9e1b3d5f0"
down_revision: Union[str, None] = "e8f0a2c4b6d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

NEW_COLUMNS = ("lane", "lane_position", "focus_week", "objective_text", "objective_done", "focus_checkpoint", "checkpoint",
               "blocked_by", "added_on", "origin")

pipeline_t = sa.table(
    "planner_pipeline_items", sa.column("id", sa.Integer), sa.column("user_id", sa.Integer), sa.column("stream", sa.String),
    sa.column("lane", sa.String), sa.column("text", sa.Text), sa.column("description", sa.Text), sa.column("products", sa.JSON),
    sa.column("checkpoint", sa.String), sa.column("added_on", sa.Date), sa.column("done_on", sa.Date), sa.column("focus_week", sa.String),
    sa.column("done", sa.Boolean), sa.column("blocked_by", sa.JSON), sa.column("position", sa.Integer))
objective_t = sa.table(
    "planner_week_objectives", sa.column("id", sa.Integer), sa.column("user_id", sa.Integer), sa.column("week", sa.String),
    sa.column("stream", sa.String), sa.column("text", sa.Text), sa.column("done", sa.Boolean), sa.column("checkpoint", sa.String))
task_t = sa.table(
    "planner_tasks", sa.column("id", sa.Integer), sa.column("user_id", sa.Integer), sa.column("text", sa.Text), sa.column("done", sa.Boolean),
    sa.column("due_on", sa.Date), sa.column("scheduled_on", sa.Date), sa.column("start_on", sa.Date), sa.column("done_on", sa.Date),
    sa.column("source_path", sa.String), sa.column("stream", sa.String), sa.column("products", sa.JSON), sa.column("description", sa.Text),
    sa.column("position", sa.Integer), sa.column("start_min", sa.Integer), sa.column("end_min", sa.Integer), sa.column("weight", sa.SmallInteger),
    sa.column("status", sa.String), sa.column("checklist", sa.JSON), sa.column("lane", sa.String), sa.column("lane_position", sa.Integer),
    sa.column("focus_week", sa.String), sa.column("objective_text", sa.Text), sa.column("objective_done", sa.Boolean),
    sa.column("focus_checkpoint", sa.String), sa.column("checkpoint", sa.String), sa.column("blocked_by", sa.JSON),
    sa.column("added_on", sa.Date), sa.column("parent_id", sa.Integer), sa.column("origin", sa.String))


def upgrade() -> None:
    op.add_column("planner_tasks", sa.Column("lane", sa.String(10), nullable=True))
    op.add_column("planner_tasks", sa.Column("lane_position", sa.Integer(), nullable=True))
    op.add_column("planner_tasks", sa.Column("focus_week", sa.String(10), nullable=True))
    op.add_column("planner_tasks", sa.Column("objective_text", sa.Text(), nullable=True))
    op.add_column("planner_tasks", sa.Column("objective_done", sa.Boolean(), nullable=True))
    op.add_column("planner_tasks", sa.Column("focus_checkpoint", sa.String(3), nullable=True))
    op.add_column("planner_tasks", sa.Column("checkpoint", sa.String(3), nullable=True))
    op.add_column("planner_tasks", sa.Column("blocked_by", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column("planner_tasks", sa.Column("added_on", sa.Date(), nullable=True))
    op.add_column("planner_tasks", sa.Column("origin", sa.String(48), nullable=True))
    with op.batch_alter_table("planner_tasks") as batch:  # a self-referencing key: SQLite needs the table rebuilt
        batch.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_planner_tasks_parent", "planner_tasks", ["parent_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_planner_tasks_parent_id", "planner_tasks", ["parent_id"])

    conn = op.get_bind()
    pipeline = [dict(r._mapping) for r in conn.execute(sa.select(pipeline_t).order_by(pipeline_t.c.id))]
    objectives = [dict(r._mapping) for r in conn.execute(sa.select(objective_t).order_by(objective_t.c.id))]
    rows, notes = map_planning(pipeline, objectives)
    for note in notes:
        log.warning(note)
    if rows:
        op.bulk_insert(task_t, rows)
    log.info("planning rows: %d pipeline items + %d objectives -> %d planner_tasks rows", len(pipeline), len(objectives), len(rows))

    op.create_index("uq_planner_task_focus", "planner_tasks", ["user_id", "stream", "focus_week"], unique=True,
                    postgresql_where=sa.text("focus_week IS NOT NULL"), sqlite_where=sa.text("focus_week IS NOT NULL"))


def downgrade() -> None:
    """Destructive for parent_id and origin; copies the rest back into the old tables first. Take a pg_dump first."""
    conn = op.get_bind()
    conn.execute(sa.delete(pipeline_t))
    conn.execute(sa.delete(objective_t))
    lane_rows = conn.execute(sa.select(task_t).where(task_t.c.lane.is_not(None)).order_by(task_t.c.lane_position, task_t.c.id)).fetchall()
    keys = ("user_id", "stream", "lane", "text", "description", "products", "checkpoint", "added_on", "done_on", "focus_week", "done", "blocked_by")
    items = [{**{k: r._mapping[k] for k in keys}, "position": r._mapping["lane_position"] if r._mapping["lane_position"] is not None else 0}
             for r in lane_rows]
    if items:
        op.bulk_insert(pipeline_t, items)
    objective_rows = conn.execute(sa.select(task_t).where(task_t.c.objective_text.is_not(None), task_t.c.focus_week.is_not(None))
                                  .order_by(task_t.c.focus_week, task_t.c.stream)).fetchall()
    objectives = [{"user_id": r.user_id, "week": r.focus_week, "stream": r.stream, "text": r.objective_text,
                   "done": bool(r.objective_done), "checkpoint": r.focus_checkpoint} for r in objective_rows]
    if objectives:
        op.bulk_insert(objective_t, objectives)

    undated = sa.and_(task_t.c.due_on.is_(None), task_t.c.scheduled_on.is_(None), task_t.c.start_on.is_(None))
    planning = sa.or_(task_t.c.lane.is_not(None), task_t.c.focus_week.is_not(None), task_t.c.objective_text.is_not(None))
    conn.execute(sa.delete(task_t).where(planning, undated))

    op.drop_index("uq_planner_task_focus", table_name="planner_tasks")
    op.drop_index("ix_planner_tasks_parent_id", table_name="planner_tasks")
    with op.batch_alter_table("planner_tasks") as batch:
        batch.drop_column("parent_id")
        for name in reversed(NEW_COLUMNS):
            batch.drop_column(name)
