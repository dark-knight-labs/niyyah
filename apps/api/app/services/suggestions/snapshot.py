"""Rows as plain dicts, and back: what a line stores so it can be undone.

A row is named by (table, id). All values are JSON-safe (dates as ISO text). Rows are read with a Core `select` of the
primary keys, never through ORM attributes: after a flush those can be expired, and a lazy load in an AsyncSession fails.
"""
from collections import defaultdict
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Table, delete, insert, select, update

from app.core.database import Base

RowRef = tuple[str, int]  # (table name, primary key)
Row = dict  # column name -> JSON-safe value


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _dump(column, value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _load(column, value):
    if value is None:
        return None
    if isinstance(column.type, DateTime):
        return datetime.fromisoformat(value)
    if isinstance(column.type, Date):
        return date.fromisoformat(value)
    return value


def dump_row(table: Table, row) -> Row:
    return {c.name: _dump(c, row[c.name]) for c in table.columns}


def load_row(table: Table, data: Row) -> dict:
    return {c.name: _load(c, data[c.name]) for c in table.columns if c.name in data}


def ref_of(table: str, pk: int) -> RowRef:
    return (table, int(pk))


async def read_rows(db, refs, *, lock: bool = False) -> dict[RowRef, Row]:
    """The current state of each row that exists (a missing row is absent from the result).

    `lock` adds FOR UPDATE where the database has it (Postgres); sqlite ignores it."""
    await db.flush()
    by_table: dict[str, set[int]] = defaultdict(set)
    for name, pk in refs:
        by_table[name].add(pk)
    out: dict[RowRef, Row] = {}
    for name, pks in by_table.items():
        table = _table(name)
        query = select(table).where(table.c.id.in_(sorted(pks))).order_by(table.c.id)
        if lock:
            query = query.with_for_update()
        for row in (await db.execute(query)).mappings().all():
            out[(name, row["id"])] = dump_row(table, row)
    return out


async def read_where(db, table_name: str, *conditions, lock: bool = False) -> list[RowRef]:
    """Refs of the rows of a table that match (the 'rows this apply may change' queries)."""
    await db.flush()
    table = _table(table_name)
    query = select(table.c.id).where(*conditions).order_by(table.c.id)
    if lock:
        query = query.with_for_update()
    return [(table_name, pk) for pk in (await db.execute(query)).scalars().all()]


async def insert_row(db, table_name: str, data: Row) -> None:
    table = _table(table_name)
    await db.execute(insert(table).values(**load_row(table, data)))


async def update_row(db, table_name: str, pk: int, data: Row) -> None:
    table = _table(table_name)
    values = {k: v for k, v in load_row(table, data).items() if k != "id"}
    await db.execute(update(table).where(table.c.id == pk).values(**values))


async def delete_row(db, table_name: str, pk: int) -> None:
    table = _table(table_name)
    await db.execute(delete(table).where(table.c.id == pk))
