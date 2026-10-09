"""Database writes for the day: mode, votes, log notes, tasks and log entries.

Each function makes one change and flushes; the caller commits (see `_db_run` in the vault router).
A `ValueError` carries the same message the vault path gives for the same bad input.
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models.planner import LogEntry, Task
from app.models.vault import VaultBlockVote, VaultDay
from app.services import planner_blocks
from app.services.vault_parser import BLOCK_ALIASES, MODE_META, possible_for_count
from app.services.vault_tasks import line_hash
from app.services.vault_write import _one_line

TASK_GONE = "this task no longer exists; reload and try again"
LOG_GONE = "this log entry changed; reload and try again"


async def _find_day(db, user_id: int, day: date) -> VaultDay | None:
    return (await db.execute(select(VaultDay).where(VaultDay.user_id == user_id, VaultDay.date == day)
                             .options(selectinload(VaultDay.block_votes)))).scalar_one_or_none()


async def _day(db, user_id: int, day: date) -> VaultDay:
    """The day's row; a missing day is created from the user's current counted blocks (all zero stars)."""
    row = await _find_day(db, user_id, day)
    if row is not None:
        return row
    keys = await planner_blocks.counted_keys(db, user_id)
    if not keys:
        raise ValueError("add a block that counts for stars in Settings first")
    row = VaultDay(user_id=user_id, date=day, mode="full", possible=possible_for_count("full", len(keys)), total=0, focus=None, log=None)
    row.block_votes = [VaultBlockVote(block=b, stars=0) for b in keys]
    db.add(row)
    await db.flush()
    return row


async def set_mode(db, user_id: int, day: date, mode: str) -> VaultDay:
    if mode not in MODE_META:
        raise ValueError(f"unknown mode '{mode}'")
    row = await _day(db, user_id, day)
    row.mode = mode
    row.possible = possible_for_count(mode, len(row.block_votes))
    return row


async def set_vote(db, user_id: int, day: date, block: str, stars: int) -> VaultDay:
    block = BLOCK_ALIASES.get(block.lower(), block.lower())
    if block not in await planner_blocks.counted_keys(db, user_id, include_archived=True):
        raise ValueError(f"unknown block '{block}'")
    if not 0 <= stars <= 3:
        raise ValueError("stars must be 0-3")
    row = await _day(db, user_id, day)
    vote = next((v for v in row.block_votes if v.block == block), None)
    if vote is None:  # a block added after this day was created joins it on its first vote
        vote = VaultBlockVote(block=block, stars=0)
        row.block_votes.append(vote)
        row.possible = possible_for_count(row.mode, len(row.block_votes))
    vote.stars = stars
    row.total = sum(v.stars for v in row.block_votes)
    return row


async def _entries(db, user_id: int, day: date) -> list[LogEntry]:
    return list((await db.execute(select(LogEntry).where(LogEntry.user_id == user_id, LogEntry.day == day)
                                  .order_by(LogEntry.position))).scalars().all())


async def _summarise(db, user_id: int, row: VaultDay) -> None:
    """The day's `log` text is its entries as '- ' bullets, as the daily-note parser reads them."""
    await db.flush()
    entries = await _entries(db, user_id, row.date)
    row.log = "\n".join(f"- {e.text}" for e in entries) or None


async def add_note(db, user_id: int, day: date, clock: str, section: str, span: str, text: str) -> VaultDay:
    entry = f"{clock} · {_one_line(section)} ({_one_line(span)}): {_one_line(text)}"
    row = await _day(db, user_id, day)
    top = (await db.execute(select(func.max(LogEntry.position)).where(LogEntry.user_id == user_id, LogEntry.day == day))).scalar()
    db.add(LogEntry(user_id=user_id, day=day, position=0 if top is None else top + 1, text=entry))
    await _summarise(db, user_id, row)
    return row


async def _log_entry(db, user_id: int, day: date, index: int, expected_hash: str) -> LogEntry:
    entry = (await db.execute(select(LogEntry).where(LogEntry.user_id == user_id, LogEntry.day == day,
                                                     LogEntry.position == index))).scalar_one_or_none()
    if entry is None or line_hash(entry.text) != expected_hash:
        raise ValueError(LOG_GONE)
    return entry


async def edit_log_entry(db, user_id: int, day: date, index: int, expected_hash: str, text: str) -> VaultDay | None:
    body = _one_line(text)
    entry = await _log_entry(db, user_id, day, index, expected_hash)
    entry.text = body
    row = await _find_day(db, user_id, day)
    if row is not None:
        await _summarise(db, user_id, row)
    return row


async def remove_log_entry(db, user_id: int, day: date, index: int, expected_hash: str) -> VaultDay | None:
    entry = await _log_entry(db, user_id, day, index, expected_hash)
    await db.delete(entry)
    await db.flush()
    for n, left in enumerate(await _entries(db, user_id, day)):  # keep positions 0..n-1, like the note's bullets
        left.position = n
    row = await _find_day(db, user_id, day)
    if row is not None:
        await _summarise(db, user_id, row)
    return row


def _label(text: str) -> str:
    label = " ".join(text.split())
    if not label or len(label) > 300:
        raise ValueError("task must be 1-300 characters")
    return label


async def _task(db, user_id: int, task_id: int) -> Task:
    task = (await db.execute(select(Task).where(Task.user_id == user_id, Task.id == task_id))).scalar_one_or_none()
    if task is None:
        raise ValueError(TASK_GONE)
    return task


async def add_task(db, user_id: int, day: date, text: str) -> VaultDay:
    label = _label(text)
    row = await _day(db, user_id, day)
    top = (await db.execute(select(func.max(Task.position)).where(Task.user_id == user_id))).scalar()
    db.add(Task(user_id=user_id, text=label, done=False, scheduled_on=day,
                source_path=f"Calendar/Daily/{day.isoformat()}.md", position=0 if top is None else top + 1))
    return row


async def set_task_done(db, user_id: int, task_id: int, done: bool, today: date) -> None:
    task = await _task(db, user_id, task_id)
    task.done = done
    task.done_on = today if done else None


async def set_task_text(db, user_id: int, task_id: int, text: str) -> None:
    label = _label(text)
    (await _task(db, user_id, task_id)).text = label


async def remove_task(db, user_id: int, task_id: int) -> None:
    await db.delete(await _task(db, user_id, task_id))
