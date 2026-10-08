# DB storage, phase 3: writes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `STORAGE_BACKEND=db`, every planner write (day mode, votes, notes, tasks, log, pipeline, objectives, quarter, notebooks, calendar feeds) changes the signed-in user's database rows and produces the same observable result as the vault path.

**Architecture:** Two pure-database service modules, `app/services/planner_day.py` (day, tasks, log) and `app/services/planner_work.py` (pipeline, objectives, quarter, notebooks). They flush but never commit; the endpoint helper `_db_run` commits once, or rolls back and answers 422 on a `ValueError`, so a multi-step change (pipeline plus objective) is atomic. Endpoints dispatch on `_db_mode()` as the reads do. Row ids ride in the existing `line` request field and `hash` stays empty, so the frontend needs no change in this phase. A parity harness replays one scenario against a git-backed vault and against the database and compares every read.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest-asyncio.

Spec: `docs/superpowers/specs/2026-10-08-db-storage-design.md`. Previous plan: `2026-10-08-db-storage-phases-1-2.md` (built; `db` reads work).

## Global Constraints

- Work in `/home/ubuntu/src/dark-knight/niyyah/apps/api`. Test command: `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (178 tests pass today and must keep passing). **Never run two pytest processes at once**: they share `./test.db`.
- `STORAGE_BACKEND` stays `vault` by default and in production. Vault-mode behaviour does not change.
- Every query on a planner table filters on `user_id`.
- Service functions flush, never commit. `db.commit()` happens only in `_db_run` (and in `_db_write` for day writes).
- Request bodies are unchanged. In `db` mode `line` is the row id (tasks, pipeline items, notebook entries); log entries are addressed by `index` plus `hash` where `hash = line_hash(text)`.
- A write that the vault path refuses with a `ValueError` message must be refused with the same message (HTTP 422) in `db` mode.
- Branch: `feature/db-storage-writes` from `main`. Commit after each task, no AI attribution lines. Do not push until Task 8.
- Migrations are not run by CI. Task 6 adds one; deploying it needs the manual steps in Task 8.

## File Structure

| File | Responsibility |
|---|---|
| `app/services/vault_parser.py` (modify) | `possible_for(mode, blocks)` shared by parser and DB writes |
| `app/services/planner_store.py` (modify) | log entries carry a content hash; calendar feeds read |
| `app/services/planner_day.py` (create) | day mode/vote/note, tasks, log entries |
| `app/services/planner_work.py` (create) | pipeline, objectives, quarter, notebooks |
| `app/models/planner.py` (modify) | `PlannerCalendarFeed` |
| `alembic/versions/e7a2c4d9b013_calendar_feeds.py` (create) | migration for the feeds table |
| `app/services/vault_calendar.py` (modify) | `events_for_day(..., feeds=None)` |
| `app/services/vault_import.py` (modify) | import calendar feeds |
| `app/api/v1/vault.py` (modify) | `require_planner_user`, `_db_run`, dispatch for every write |
| `tests/conftest.py` (modify) | `db_client` fixture |
| `tests/test_db_day_writes.py`, `test_db_work_writes.py`, `test_db_events.py`, `test_writes_parity.py` (create) | tests |

---

### Task 1: Access rename, shared helpers, and the test fixture

**Files:**
- Modify: `app/api/v1/vault.py`, `app/services/vault_parser.py`, `app/services/planner_store.py`, `tests/conftest.py`
- Test: `tests/test_db_day_writes.py` (first test only here)

**Interfaces:**
- Produces: `require_planner_user` (the old `require_reader`, renamed: allow-listed owner in vault mode, any signed-in user in db mode); `_db_run(db, work)`; `vault_parser.possible_for(mode: str, blocks: Collection[str]) -> int`; fixture `db_client` yielding `(client, today)` with the fixture vault imported for the logged-in user and `STORAGE_BACKEND=db`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_db_day_writes.py`:

```python
import pytest


@pytest.mark.asyncio
async def test_fixture_gives_an_imported_user_in_db_mode(db_client):
    client, today = db_client
    day = (await client.get("/api/v1/vault/today")).json()
    assert day["mode"] == "full" and day["blocks"] == {"soul": 2, "body": 1}
```

- [ ] **Step 2: Run to verify it fails**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_day_writes.py -q`
Expected: FAIL (`fixture 'db_client' not found`).

- [ ] **Step 3: Implement**

In `tests/conftest.py` append:

```python
@pytest_asyncio.fixture
async def db_client(auth_client: AsyncClient, tmp_path, monkeypatch):
    """The logged-in user with the fixture vault imported into their rows and STORAGE_BACKEND=db."""
    from sqlalchemy import select

    from app.api.v1.vault import _local_now
    from app.core.config import settings
    from app.models.user import User
    from app.services.vault_import import import_vault
    from tests.vault_fixture import build_vault

    today = _local_now().date()
    build_vault(tmp_path, today)
    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, user_id, tmp_path, today)
    monkeypatch.setattr(settings, "storage_backend", "db")
    return auth_client, today
```

In `app/services/vault_parser.py` add above `parse_daily_note`:

```python
def possible_for(mode: str, blocks) -> int:
    """The day's maximum stars: the mode's table value, scaled when the merged OT block replaces onething and ops."""
    possible = MODE_META.get(mode, MODE_META["full"])["possible"]
    if "ot" in blocks and "onething" not in blocks and "ops" not in blocks:
        possible = round(possible * OT_SCALE)
    return possible
```

and inside `parse_daily_note` replace

```python
    meta = MODE_META.get(mode, MODE_META["full"])
```
(delete the line) and replace the `possible = meta["possible"]` / `if "ot" in blocks ...: possible = round(...)` lines with `possible = possible_for(mode, blocks)`. Keep `total = sum(blocks.values())`.

In `app/services/planner_store.py` change `day_log` to carry a content hash (add `from app.services.vault_tasks import line_hash` to the imports):

```python
    return [{"index": r.position, "hash": line_hash(r.text), "text": r.text} for r in rows]
```

In `app/api/v1/vault.py`:
1. Rename `require_reader` to `require_planner_user` everywhere (definition and the seven read endpoints).
2. Add below `require_editor`:

```python
async def _db_run(db: AsyncSession, work):
    """Run a database write and commit it. Bad input or a stale row (ValueError) is a 422 and nothing is saved."""
    try:
        result = await work()
        await db.commit()
        return result
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
```

- [ ] **Step 4: Run the suite for what changed**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_day_writes.py tests/test_vault_parser.py tests/test_db_reads.py tests/test_storage_switch.py -q`
Expected: all pass (the parser tests prove `possible_for` changed nothing).

- [ ] **Step 5: Commit**

```bash
git add app tests
git commit -m "Prepare db-mode writes: shared possible_for, hashed log entries, db_client fixture"
```

---

### Task 2: Day, task and log writes

**Files:**
- Create: `app/services/planner_day.py`
- Modify: `app/api/v1/vault.py`
- Test: `tests/test_db_day_writes.py`

**Interfaces:**
- Consumes: `_db_run`, `require_planner_user`, `db_client`, `possible_for`.
- Produces in `planner_day` (all `async`, `(db, user_id, ...)`, flush only): `set_mode(db, user_id, day, mode) -> VaultDay`, `set_vote(db, user_id, day, block, stars) -> VaultDay`, `add_note(db, user_id, day, clock, section, span, text) -> VaultDay`, `add_task(db, user_id, day, text) -> VaultDay`, `set_task_done(db, user_id, task_id, done, today) -> None`, `set_task_text(db, user_id, task_id, text) -> None`, `remove_task(db, user_id, task_id) -> None`, `edit_log_entry(db, user_id, day, index, expected_hash, text) -> VaultDay | None`, `remove_log_entry(db, user_id, day, index, expected_hash) -> VaultDay | None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_db_day_writes.py`:

```python
V = "/api/v1/vault"


@pytest.mark.asyncio
async def test_vote_updates_the_day_totals(db_client):
    client, today = db_client
    res = await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    assert res.status_code == 200 and res.json()["commit"] == "db"
    assert res.json()["day"]["blocks"] == {"soul": 2, "body": 3} and res.json()["day"]["total"] == 5


@pytest.mark.asyncio
async def test_vote_rejects_bad_input_with_the_vault_messages(db_client):
    client, today = db_client
    bad = await client.put(f"{V}/day/{today}/vote", json={"block": "nope", "stars": 1})
    assert bad.status_code == 422 and "unknown block" in bad.json()["detail"]
    missing = await client.put(f"{V}/day/{today}/vote", json={"block": "ops", "stars": 1})
    assert missing.status_code == 422 and "no vote lines" in missing.json()["detail"]
    assert (await client.put(f"{V}/day/{today}/vote", json={"block": "soul", "stars": 4})).status_code == 422


@pytest.mark.asyncio
async def test_mode_change_recomputes_possible(db_client):
    client, today = db_client
    res = await client.put(f"{V}/day/{today}/mode", json={"mode": "yellow"})
    assert res.json()["day"]["mode"] == "yellow" and res.json()["day"]["possible"] == 14
    assert (await client.put(f"{V}/day/{today}/mode", json={"mode": "party"})).status_code == 422


@pytest.mark.asyncio
async def test_a_missing_day_is_created_from_the_latest_layout(db_client):
    from datetime import timedelta
    client, today = db_client
    day = today - timedelta(days=4)
    res = await client.put(f"{V}/day/{day}/vote", json={"block": "body", "stars": 2})
    assert res.status_code == 200
    assert res.json()["day"]["blocks"] == {"soul": 0, "body": 2} and res.json()["day"]["mode"] == "full"


@pytest.mark.asyncio
async def test_note_is_appended_to_the_log_and_the_summary(db_client):
    client, today = db_client
    res = await client.post(f"{V}/day/{today}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Shipped it"})
    assert res.status_code == 200
    log = (await client.get(f"{V}/day/{today}/log")).json()
    assert [e["index"] for e in log] == [0, 1, 2] and log[2]["text"].endswith("OT (06:00-16:03): Shipped it")
    assert res.json()["day"]["log"].splitlines()[-1] == f"- {log[2]['text']}"
    empty = await client.post(f"{V}/day/{today}/notes", json={"section": "OT", "span": "x", "text": "   "})
    assert empty.status_code == 422


@pytest.mark.asyncio
async def test_task_lifecycle(db_client):
    client, today = db_client
    tasks = (await client.get(f"{V}/day/{today}/tasks")).json()
    first = tasks[0]
    done = await client.put(f"{V}/tasks", json={"path": first["path"], "line": first["line"], "hash": "", "done": True})
    assert done.status_code == 200
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["done"] is True
    await client.put(f"{V}/tasks/text", json={"path": first["path"], "line": first["line"], "hash": "", "text": "  Pay   the invoice "})
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["text"] == "Pay the invoice"
    await client.post(f"{V}/day/{today}/tasks", json={"text": "Call the bank"})
    assert [t["text"] for t in (await client.get(f"{V}/day/{today}/tasks")).json()] == ["Call the bank", "Pay the invoice", "Renew domain"]  # file path order, as in the vault
    gone = await client.post(f"{V}/tasks/remove", json={"path": first["path"], "line": first["line"], "hash": ""})
    assert gone.status_code == 200
    again = await client.post(f"{V}/tasks/remove", json={"path": first["path"], "line": first["line"], "hash": ""})
    assert again.status_code == 422
    assert (await client.post(f"{V}/day/{today}/tasks", json={"text": " "})).status_code == 422


@pytest.mark.asyncio
async def test_log_edit_and_remove_check_the_hash(db_client):
    client, today = db_client
    log = (await client.get(f"{V}/day/{today}/log")).json()
    stale = await client.put(f"{V}/day/{today}/log", json={"index": 0, "hash": "0000000000", "text": "x"})
    assert stale.status_code == 422
    ok = await client.put(f"{V}/day/{today}/log", json={"index": 0, "hash": log[0]["hash"], "text": "Rewritten"})
    assert ok.status_code == 200
    after = (await client.get(f"{V}/day/{today}/log")).json()
    assert after[0]["text"] == "Rewritten"
    await client.post(f"{V}/day/{today}/log/remove", json={"index": 0, "hash": after[0]["hash"]})
    final = (await client.get(f"{V}/day/{today}/log")).json()
    assert [(e["index"], e["text"]) for e in final] == [(0, "Second entry")]


@pytest.mark.asyncio
async def test_writes_only_touch_the_callers_rows(db_client):
    client, today = db_client
    await client.post(f"{V}/auth/register".replace("/vault", ""), json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    mine = (await client.get(f"{V}/day/{today}/tasks")).json()[0]
    res = await client.put(f"{V}/tasks", json={"path": "", "line": mine["line"], "hash": "", "done": True}, headers=other)
    assert res.status_code == 422  # not found for them
    assert (await client.get(f"{V}/day/{today}/tasks")).json()[0]["done"] is False
```

(The register URL in the last test is `/api/v1/auth/register`; the odd `.replace` keeps the constant `V` usable. If it reads badly, write the literal URL.)

- [ ] **Step 2: Run to verify they fail**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_day_writes.py -q`
Expected: the new tests FAIL with 501 (db mode still refuses writes).

- [ ] **Step 3: Write `planner_day.py`**

```python
"""Database writes for the day: mode, votes, log notes, tasks and log entries.

Each function makes one change and flushes; the caller commits (see `_db_run` in the vault router).
A `ValueError` carries the same message the vault path gives for the same bad input.
"""
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.models.planner import LogEntry, Task
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_parser import BLOCK_ALIASES, CANONICAL_BLOCKS, MODE_META, possible_for
from app.services.vault_tasks import line_hash
from app.services.vault_write import _one_line

TASK_GONE = "this task no longer exists; reload and try again"
LOG_GONE = "this log entry changed; reload and try again"


async def _find_day(db, user_id: int, day: date) -> VaultDay | None:
    return (await db.execute(select(VaultDay).where(VaultDay.user_id == user_id, VaultDay.date == day)
                             .options(selectinload(VaultDay.block_votes)))).scalar_one_or_none()


async def _day(db, user_id: int, day: date) -> VaultDay:
    """The day's row; a missing day is created with the latest day's blocks (all zero stars), like a fresh daily note."""
    row = await _find_day(db, user_id, day)
    if row is not None:
        return row
    latest = (await db.execute(select(VaultDay).where(VaultDay.user_id == user_id)
                               .order_by(VaultDay.date.desc()).limit(1).options(selectinload(VaultDay.block_votes)))).scalar_one_or_none()
    if latest is None:
        raise ValueError("there is no daily note to copy the layout from")
    blocks = [v.block for v in latest.block_votes]
    row = VaultDay(user_id=user_id, date=day, mode="full", possible=possible_for("full", set(blocks)), total=0, focus=None, log=None)
    row.block_votes = [VaultBlockVote(block=b, stars=0) for b in blocks]
    db.add(row)
    await db.flush()
    return row


async def set_mode(db, user_id: int, day: date, mode: str) -> VaultDay:
    if mode not in MODE_META:
        raise ValueError(f"unknown mode '{mode}'")
    row = await _day(db, user_id, day)
    row.mode = mode
    row.possible = possible_for(mode, {v.block for v in row.block_votes})
    return row


async def set_vote(db, user_id: int, day: date, block: str, stars: int) -> VaultDay:
    block = BLOCK_ALIASES.get(block.lower(), block.lower())
    if block not in CANONICAL_BLOCKS:
        raise ValueError(f"unknown block '{block}'")
    if not 0 <= stars <= 3:
        raise ValueError("stars must be 0-3")
    row = await _day(db, user_id, day)
    vote = next((v for v in row.block_votes if v.block == block), None)
    if vote is None:
        raise ValueError(f"no vote lines for '{block}' in this note")
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
```

- [ ] **Step 4: Dispatch the endpoints**

In `app/api/v1/vault.py` add `from app.services import planner_day` to the `app.services` import line, add the helper below `_db_run`:

```python
async def _db_day_write(db: AsyncSession, work) -> EditResponse:
    """A db-mode day write: `work()` returns the day row (or None); the response has the day like the vault path."""
    row = await _db_run(db, work)
    return EditResponse(commit="db", day=_day_to_response(row) if row is not None else None)
```

Then add a db branch at the top of each handler body and swap its dependency from `require_editor` to `require_planner_user` (the dependency swap is what lifts the 501):

```python
@router.put("/day/{day}/mode", response_model=EditResponse)
async def put_mode(day: date, data: ModeIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    _check_day(day)
    if _db_mode():
        return await _db_day_write(db, lambda: planner_day.set_mode(db, user.id, day, data.mode))
    return await _save(day, lambda c: set_mode(c, data.mode), f"Niyyah: set {day} mode to {data.mode}", db)
```

`put_vote`: `planner_day.set_vote(db, user.id, day, data.block, data.stars)`.
`post_note`: compute `clock = _local_now().strftime("%H:%M")` first, then `planner_day.add_note(db, user.id, day, clock, data.section, data.span, data.text)`.
`post_task`: `_check_day(day)` then `planner_day.add_task(db, user.id, day, data.text)`.
`put_task`: `today = _local_now().date()`; db branch `_db_day_write(db, lambda: _none(planner_day.set_task_done(db, user.id, data.line, data.done, today)))`. Because `set_task_done` returns `None` already, pass it directly: `lambda: planner_day.set_task_done(...)`.
`put_task_text`: `planner_day.set_task_text(db, user.id, data.line, data.text)`.
`post_task_remove`: `planner_day.remove_task(db, user.id, data.line)`.
`put_log_entry`: `_check_day(day)`; `planner_day.edit_log_entry(db, user.id, day, data.index, data.hash, data.text)`.
`post_log_remove`: `_check_day(day)`; `planner_day.remove_log_entry(db, user.id, day, data.index, data.hash)`.

Every handler that did not yet take `db` gets `db: AsyncSession = Depends(get_db)` added (`put_task`, `put_task_text`, `post_task_remove`, `post_task` already have it).

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_day_writes.py tests/test_vault_write.py tests/test_vault_endpoints.py -q`
Expected: all pass. If `test_log_edit_and_remove_check_the_hash` fails on the final index list, the recompaction loop is not flushing; check that positions are reassigned after `await db.flush()` of the delete.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "Write day mode, votes, notes, tasks and log entries to the database in db mode"
```

---

### Task 3: Pipeline writes

**Files:**
- Create: `app/services/planner_work.py` (pipeline part)
- Modify: `app/api/v1/vault.py`
- Test: `tests/test_db_work_writes.py`

**Interfaces:**
- Produces in `planner_work` (async, `(db, user_id, ...)`, flush only): `add_items(db, user_id, stream, texts, lane, today, descriptions=None) -> None`, `move_item(db, user_id, stream, item_id, lane, today) -> None`, `set_checkpoint(db, user_id, stream, item_id, checkpoint) -> None`, `remove_item(db, user_id, stream, item_id) -> None`, `set_description(db, user_id, stream, item_id, text) -> None`, `set_blocked_by(db, user_id, stream, item_id, ids) -> None`, `set_text(db, user_id, stream, item_id, text) -> None`, `set_focus(db, user_id, stream, item_id, week, today) -> None`, `focused_item(db, user_id, stream, week) -> PipelineItem | None`, `item_row(db, user_id, stream, item_id) -> PipelineItem`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_db_work_writes.py`:

```python
import pytest

V = "/api/v1/vault"


async def _pipeline(client, stream="kahf"):
    data = (await client.get(f"{V}/pipelines")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["items"], data["week"]


def _ref(stream, item, **extra):
    return {"stream": stream, "line": item["line"], "hash": "", **extra}


@pytest.mark.asyncio
async def test_add_items_appends_to_a_lane(db_client):
    client, today = db_client
    res = await client.post(f"{V}/pipeline/kahf/items",
                            json={"texts": ["Buy cables [product:: Router] #nov", "  "], "lane": "next", "descriptions": ["Cat6\nshielded", ""]})
    assert res.status_code == 200 and res.json()["commit"] == "db"
    items, _ = await _pipeline(client)
    new = items[-1]
    assert (new["text"], new["lane"], new["product"], new["checkpoint"], new["description"]) == \
        ("Buy cables", "next", "Router", "nov", "Cat6\nshielded")
    assert new["added"] == today.isoformat() and new["age_days"] == 0
    assert (await client.post(f"{V}/pipeline/kahf/items", json={"texts": [" "], "lane": "next"})).status_code == 422
    assert (await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["x"], "lane": "done"})).status_code == 422
    assert (await client.post(f"{V}/pipeline/nope/items", json={"texts": ["x"], "lane": "next"})).status_code == 422


@pytest.mark.asyncio
async def test_move_stamps_done_and_reopens(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/move", json=_ref("kahf", plan, lane="done"))
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    assert plan["lane"] == "done" and plan["done"] is True and plan["done_on"] == today.isoformat()
    await client.put(f"{V}/pipeline/move", json=_ref("kahf", plan, lane="now"))
    items, _ = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    assert plan["lane"] == "now" and plan["done"] is False and plan["done_on"] is None
    assert (await client.put(f"{V}/pipeline/move", json=_ref("kahf", plan, lane="sideways"))).status_code == 422


@pytest.mark.asyncio
async def test_text_keeps_product_dates_and_checkpoint(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    router = next(i for i in items if i["product"] == "Router")
    await client.put(f"{V}/pipeline/text", json=_ref("kahf", router, text="Wire the new router"))
    items, _ = await _pipeline(client)
    router = next(i for i in items if i["product"] == "Router")
    assert router["text"] == "Wire the new router" and router["checkpoint"] is not None and router["focus"] is not None


@pytest.mark.asyncio
async def test_checkpoint_description_blockers_and_remove(db_client):
    client, today = db_client
    items, _ = await _pipeline(client)
    item = next(i for i in items if i["lane"] == "backlog")
    await client.put(f"{V}/pipeline/checkpoint", json=_ref("kahf", item, checkpoint="nov"))
    await client.put(f"{V}/pipeline/description", json=_ref("kahf", item, description="Line one\n\nLine three  "))
    await client.put(f"{V}/pipeline/blocked-by", json=_ref("kahf", item, ids=["abcd1234", "abcd1234"]))
    items, _ = await _pipeline(client)
    item = next(i for i in items if i["lane"] == "backlog")
    assert item["checkpoint"] == "nov" and item["description"] == "Line one\n\nLine three" and item["blocked_by"] == ["abcd1234"]
    assert (await client.put(f"{V}/pipeline/blocked-by", json=_ref("kahf", item, ids=["BAD ID"]))).status_code == 422
    await client.post(f"{V}/pipeline/remove", json=_ref("kahf", item))
    items, _ = await _pipeline(client)
    assert all(i["lane"] != "backlog" for i in items)
    assert (await client.post(f"{V}/pipeline/remove", json=_ref("kahf", item))).status_code == 422


@pytest.mark.asyncio
async def test_focus_moves_the_marker_and_goes_to_now(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/focus", json=_ref("kahf", plan))
    items, _ = await _pipeline(client)
    focused = [i for i in items if i["focus"] == week]
    assert [i["text"] for i in focused] == ["Plan the DNS cutover"] and focused[0]["lane"] == "now"


@pytest.mark.asyncio
async def test_another_users_item_is_not_reachable(db_client):
    client, today = db_client
    await client.post("/api/v1/auth/register", json={"email": "other@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "other@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    items, _ = await _pipeline(client)
    res = await client.post(f"{V}/pipeline/remove", json=_ref("kahf", items[0]), headers=other)
    assert res.status_code == 422
    assert len((await _pipeline(client))[0]) == len(items)
```

(The objective-linking behaviour of move, focus and remove is tested in Task 4 with the objective writes.)

- [ ] **Step 2: Run to verify they fail**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py -q`
Expected: FAIL (501).

- [ ] **Step 3: Write the pipeline part of `planner_work.py`**

```python
"""Database writes for streams' work: pipeline items, week objectives, the quarter and notebooks.

Same contract as planner_day: flush, never commit; a ValueError carries the vault path's message.
"""
from datetime import date

from sqlalchemy import func, select

from app.models.planner import PipelineItem
from app.services.vault_pipeline import LANES, MAX_DESCRIPTION_CHARS, _BLOCKER_ID, _PRODUCT, _clean as clean_item

ITEM_GONE = "that item changed or moved; reload and try again"


async def item_row(db, user_id: int, stream: str, item_id: int) -> PipelineItem:
    row = (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.id == item_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(ITEM_GONE)
    return row


async def _next_position(db, user_id: int, stream: str) -> int:
    top = (await db.execute(select(func.max(PipelineItem.position)).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream))).scalar()
    return 0 if top is None else top + 1


def _split_product(text: str) -> tuple[str, str | None]:
    """('Wire it [product:: Router]') -> ('Wire it', 'Router'): the product is a field of the item, not part of its text."""
    found = _PRODUCT.search(text)
    if not found:
        return text, None
    return _PRODUCT.sub("", text).strip(), found.group(1) or None


def _description(text: str) -> str:
    text = text.strip("\n").rstrip()
    if len(text) > MAX_DESCRIPTION_CHARS:
        raise ValueError(f"description is longer than {MAX_DESCRIPTION_CHARS} characters")
    return "\n".join(line.rstrip() for line in text.split("\n")) if text.strip() else ""


async def add_items(db, user_id: int, stream: str, texts: list[str], lane: str, today: date,
                    descriptions: list[str] | None = None) -> None:
    if lane not in LANES or lane == "done":
        raise ValueError(f"cannot add to lane '{lane}'")
    if descriptions is not None and len(descriptions) != len(texts):
        raise ValueError("descriptions must line up with texts")
    notes = descriptions or [""] * len(texts)
    cleaned = []
    for text, note in zip(texts, notes):
        if not text.strip():
            continue
        bare, product = _split_product(text)
        title, month = clean_item(bare)
        cleaned.append((title, product, month, _description(note)))
    if not cleaned:
        raise ValueError("nothing to add")
    position = await _next_position(db, user_id, stream)
    for title, product, month, note in cleaned:
        db.add(PipelineItem(user_id=user_id, stream=stream, lane=lane, text=title, description=note, product=product,
                            checkpoint=month, added_on=today, done=False, blocked_by=[], position=position))
        position += 1
    await db.flush()


async def move_item(db, user_id: int, stream: str, item_id: int, lane: str, today: date) -> None:
    """Move an item to the end of `lane`; Done ticks it and stamps the date, any other lane reopens it."""
    if lane not in LANES:
        raise ValueError(f"unknown lane '{lane}'")
    row = await item_row(db, user_id, stream, item_id)
    done = lane == "done"
    row.lane, row.done = lane, done
    row.done_on = (row.done_on or today) if done else None
    row.position = await _next_position(db, user_id, stream)


async def set_checkpoint(db, user_id: int, stream: str, item_id: int, checkpoint: str | None) -> None:
    row = await item_row(db, user_id, stream, item_id)
    row.checkpoint = clean_item(f"x #{checkpoint}")[1] if checkpoint else None


async def remove_item(db, user_id: int, stream: str, item_id: int) -> None:
    await db.delete(await item_row(db, user_id, stream, item_id))


async def set_description(db, user_id: int, stream: str, item_id: int, text: str) -> None:
    row = await item_row(db, user_id, stream, item_id)
    row.description = _description(text)


async def set_blocked_by(db, user_id: int, stream: str, item_id: int, ids: list[str]) -> None:
    row = await item_row(db, user_id, stream, item_id)
    clean: list[str] = []
    for blocker in ids:
        if not _BLOCKER_ID.match(blocker):
            raise ValueError(f"'{blocker}' is not a blocker id")
        if blocker not in clean:
            clean.append(blocker)
    row.blocked_by = clean


async def set_text(db, user_id: int, stream: str, item_id: int, text: str) -> None:
    """Rename in place, keeping lane, dates and product; a #month typed in the text replaces the checkpoint."""
    row = await item_row(db, user_id, stream, item_id)
    bare, typed_product = _split_product(text)
    title, typed_month = clean_item(bare)
    row.text = title
    row.checkpoint = typed_month or row.checkpoint
    if typed_product:
        row.product = typed_product


async def focused_item(db, user_id: int, stream: str, week: str) -> PipelineItem | None:
    return (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.focus_week == week)
        .order_by(PipelineItem.position))).scalars().first()


async def set_focus(db, user_id: int, stream: str, item_id: int, week: str, today: date) -> None:
    """Make this item the week's small domino: the marker leaves any other item and the item goes to Now, reopened."""
    row = await item_row(db, user_id, stream, item_id)
    others = (await db.execute(select(PipelineItem).where(
        PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.focus_week == week))).scalars().all()
    for other in others:
        other.focus_week = None
    row.focus_week = week
    await move_item(db, user_id, stream, item_id, "now", today)
```

- [ ] **Step 4: Dispatch the endpoints**

In `app/api/v1/vault.py` add `planner_work` to the services import and a helper beside `_save_pipeline`:

```python
async def _known_stream(db: AsyncSession, user: User, stream: str, today: date) -> None:
    streams = await planner_store.streams_for(db, user.id, today)
    if stream not in {s.id for s in streams if s.goal and not s.archived}:
        raise HTTPException(status_code=422, detail=f"unknown stream '{stream}'")
```

For each pipeline handler, swap the dependency to `require_planner_user`, add `db: AsyncSession = Depends(get_db)` if missing, and add the db branch. Pattern for add:

```python
@router.post("/pipeline/{stream}/items", response_model=EditResponse)
async def post_pipeline_items(stream: str, data: PipelineAddIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        await _known_stream(db, user, stream, today)
        return await _db_day_write(db, lambda: _done(planner_work.add_items(db, user.id, stream, data.texts, data.lane, today, data.descriptions)))
    ... existing vault code unchanged ...
```

where `_done` awaits a coroutine and returns `None`:

```python
async def _done(coro):
    await coro
    return None
```

(`_db_day_write` expects `work()` to return an awaitable result; wrap functions that return `None` with `_done` only if they would otherwise return a row. All the pipeline functions return `None`, so they can be passed directly: `lambda: planner_work.add_items(...)`. Do that and delete `_done`.)

The remaining pipeline handlers follow the same shape, each calling `await _known_stream(db, user, data.stream, today)` first, with `data.line` as the item id:
- `put_pipeline_checkpoint` -> `planner_work.set_checkpoint(db, user.id, data.stream, data.line, data.checkpoint or None)`
- `put_pipeline_text` -> `set_text(db, user.id, data.stream, data.line, data.text)`
- `put_pipeline_description` -> `set_description(..., data.description)`
- `put_pipeline_blocked_by` -> `set_blocked_by(..., data.ids)`
- `put_pipeline_move`, `put_pipeline_focus`, `post_pipeline_remove` get their objective linking in Task 4; in this task give them the plain db branch (`move_item(db, user.id, data.stream, data.line, data.lane, today)`, `set_focus(db, user.id, data.stream, data.line, week, today)`, `remove_item(db, user.id, data.stream, data.line)`) and mark the linking as Task 4 in a code comment-free way by implementing it there.

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py tests/test_vault_pipeline.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "Write pipeline changes to the database in db mode"
```

---

### Task 4: Objectives and quarter writes, and the small-domino link

**Files:**
- Modify: `app/services/planner_work.py`, `app/api/v1/vault.py`
- Test: `tests/test_db_work_writes.py`

**Interfaces:**
- Produces in `planner_work`: `update_objective(db, user_id, today, stream, text, done, checkpoint, streams) -> None`, `sync_focus(db, user_id, stream, week, today, *, text=None, done=None) -> None`, `set_super_objective(db, user_id, label, text, arabic) -> None`, `update_stream(db, user_id, label, stream, fields: dict[str, str]) -> None`, `add_stream(db, user_id, label, stream, fields: dict[str, str]) -> None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_db_work_writes.py`:

```python
async def _objectives(client):
    return {i["stream"]: i for i in (await client.get(f"{V}/objectives")).json()["items"]}


@pytest.mark.asyncio
async def test_objective_text_done_and_checkpoint(db_client):
    client, today = db_client
    res = await client.put(f"{V}/objectives", json={"stream": "alisha", "text": "  Launch   the store ", "checkpoint": "nov"})
    assert res.status_code == 200
    alisha = (await _objectives(client))["alisha"]
    assert (alisha["text"], alisha["done"], alisha["checkpoint"]) == ("Launch the store", True, "nov")
    await client.put(f"{V}/objectives", json={"stream": "alisha", "done": False})
    assert (await _objectives(client))["alisha"]["done"] is False
    assert (await client.put(f"{V}/objectives", json={"stream": "nope", "text": "x"})).status_code == 422
    assert (await client.put(f"{V}/objectives", json={"stream": "alisha", "text": "x" * 201})).status_code == 422


@pytest.mark.asyncio
async def test_an_objective_without_text_loses_its_checkpoint(db_client):
    client, today = db_client
    await client.put(f"{V}/objectives", json={"stream": "kahf", "text": "", "checkpoint": "nov"})
    kahf = (await _objectives(client))["kahf"]
    assert (kahf["text"], kahf["checkpoint"]) == ("", None)


@pytest.mark.asyncio
async def test_objective_text_creates_and_links_the_small_domino(db_client):
    client, today = db_client
    await client.put(f"{V}/objectives", json={"stream": "kahf", "text": "Cut over DNS"})
    items, week = await _pipeline(client)
    linked = [i for i in items if i["focus"] == week]
    assert [i["text"] for i in linked] == ["Cut over DNS"] and linked[0]["lane"] == "now"
    await client.put(f"{V}/objectives", json={"stream": "kahf", "done": True})
    items, week = await _pipeline(client)
    assert next(i for i in items if i["focus"] == week)["lane"] == "done"


@pytest.mark.asyncio
async def test_finishing_the_small_domino_ticks_the_objective(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    domino = next(i for i in items if i["focus"] == week)
    await client.put(f"{V}/pipeline/move", json=_ref("kahf", domino, lane="done"))
    assert (await _objectives(client))["kahf"]["done"] is True
    items, week = await _pipeline(client)
    domino = next(i for i in items if i["focus"] == week)
    await client.post(f"{V}/pipeline/remove", json=_ref("kahf", domino))
    assert (await _objectives(client))["kahf"]["text"] == ""


@pytest.mark.asyncio
async def test_focus_writes_the_objective_line(db_client):
    client, today = db_client
    items, week = await _pipeline(client)
    plan = next(i for i in items if i["text"].startswith("Plan the DNS"))
    await client.put(f"{V}/pipeline/focus", json=_ref("kahf", plan))
    assert (await _objectives(client))["kahf"]["text"] == "Plan the DNS cutover"


@pytest.mark.asyncio
async def test_super_objective_and_streams(db_client):
    client, today = db_client
    res = await client.put(f"{V}/quarter", json={"text": "  New   objective ", "arabic": ""})
    assert res.status_code == 200 and res.json()["objective"] == "New objective" and res.json()["objective_ar"] == ""
    changed = await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "name": "Kahf Hosting", "color": "teal", "weekly": False,
                                                              "checkpoints": {"nov": "DNS live", "oct": "Router done"}})
    kahf = next(s for s in changed.json()["streams"] if s["stream"] == "kahf")
    assert (kahf["name"], kahf["color"], kahf["weekly"]) == ("Kahf Hosting", "teal", False)
    assert [(c["month"], c["text"]) for c in kahf["checkpoints"]] == [("oct", "Router done"), ("nov", "DNS live")]
    assert (await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "color": "plaid"})).status_code == 422
    assert (await client.put(f"{V}/quarter/stream", json={"stream": "sleep", "name": "x"})).status_code == 422
    added = await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Errands", "goal": "Clear the list"})
    assert added.status_code == 200
    names = [s["stream"] for s in added.json()["streams"]]
    assert names[-1] == "errands" and added.json()["streams"][-1]["status"] == "committed"
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Again"})).status_code == 422
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "Bad Id", "name": "x"})).status_code == 422
    assert (await client.post(f"{V}/quarter/stream", json={"stream": "noname"})).status_code == 422
```

(`StreamAddIn` makes `name` required, so the last request is rejected by validation with 422 too, which is the behaviour to keep.)

- [ ] **Step 2: Run to verify they fail**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py -q`
Expected: the new tests FAIL (501).

- [ ] **Step 3: Add the functions to `planner_work.py`**

Add imports at the top: `from app.models.planner import PipelineItem, Quarter, QuarterStream, WeekObjective`, `from app.services.vault_objectives import MAX_OBJECTIVE_CHARS, week_for, weekly_streams`, `from app.services.vault_quarter import FIELD_KEYS, _one_line, _validate, quarter_months`, `from app.services.vault_streams import DEFAULTS, MONTHS, SLUG, make_stream`. Then append:

```python
async def update_objective(db, user_id: int, today: date, stream: str, text: str | None, done: bool | None,
                           checkpoint: str | None, streams) -> None:
    """Set the text, done flag and/or checkpoint of one stream's objective for today's week ('' clears the checkpoint)."""
    if stream not in {s.id for s in weekly_streams(streams)}:
        raise ValueError(f"unknown stream '{stream}'")
    if text is None and done is None and checkpoint is None:
        raise ValueError("nothing to change")
    if checkpoint and checkpoint not in MONTHS:
        raise ValueError(f"unknown month '{checkpoint}'")
    week = week_for(today)[2]
    existing = (await db.execute(select(WeekObjective).where(
        WeekObjective.user_id == user_id, WeekObjective.week == week, WeekObjective.stream == stream))).scalar_one_or_none()
    row = existing or WeekObjective(user_id=user_id, week=week, stream=stream, text="", done=False, checkpoint=None)
    if text is not None:
        cleaned = " ".join(text.split())
        if len(cleaned) > MAX_OBJECTIVE_CHARS:
            raise ValueError(f"objective is longer than {MAX_OBJECTIVE_CHARS} characters")
        row.text = cleaned
    if done is not None:
        row.done = done
    if checkpoint is not None:
        row.checkpoint = checkpoint or None
    if not row.text:
        row.checkpoint = None  # a checkpoint is only kept with a line of text, as in the weekly note
    keep = bool(row.text or row.done)
    if keep and existing is None:
        db.add(row)
    elif not keep and existing is not None:
        await db.delete(row)
    await db.flush()


async def sync_focus(db, user_id: int, stream: str, week: str, today: date, *, text: str | None = None,
                     done: bool | None = None) -> None:
    """Keep the week's small-domino item in step with its objective line (same rules as the vault path)."""
    item = await focused_item(db, user_id, stream, week)
    if text is not None:
        if text.strip() == "":
            if item:
                item.focus_week = None
            return
        if item:
            await set_text(db, user_id, stream, item.id, text)
            return
        wanted = clean_item(_split_product(text)[0])[0].lower()
        same = (await db.execute(select(PipelineItem).where(
            PipelineItem.user_id == user_id, PipelineItem.stream == stream, PipelineItem.done.is_(False))
            .order_by(PipelineItem.position))).scalars().all()
        match = next((i for i in same if i.text.lower() == wanted), None)
        if match:  # the objective names an item already in the pipeline: link it instead of adding a twin
            await set_focus(db, user_id, stream, match.id, week, today)
            return
        await add_items(db, user_id, stream, [text], "now", today)
        created = (await db.execute(select(PipelineItem).where(
            PipelineItem.user_id == user_id, PipelineItem.stream == stream).order_by(PipelineItem.position.desc()))).scalars().first()
        await set_focus(db, user_id, stream, created.id, week, today)
        return
    if done is not None and item:
        await move_item(db, user_id, stream, item.id, "done" if done else "now", today)


async def _quarter(db, user_id: int, label: str) -> Quarter:
    """This quarter's row; a new quarter starts like the vault's skeleton note: a placeholder objective and the built-in extras."""
    row = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == label))).scalar_one_or_none()
    if row is not None:
        return row
    row = Quarter(user_id=user_id, label=label, starts=None, ends=None, objective="Set this quarter's Super Objective", objective_ar="")
    db.add(row)
    extras = [make_stream(sid, goal=False) for sid, d in DEFAULTS.items() if d.get("goal") is False]
    for pos, s in enumerate(extras):
        db.add(QuarterStream(user_id=user_id, quarter=label, slug=s.id, name=s.name, color=s.color, icon=s.icon, slot=s.slot,
                             weekly=s.weekly, has_pipeline=s.goal, in_note=False, goal="", status=s.status, checkpoints=[], position=pos))
    await db.flush()
    return row


async def _stream_rows(db, user_id: int, label: str) -> list[QuarterStream]:
    return list((await db.execute(select(QuarterStream).where(
        QuarterStream.user_id == user_id, QuarterStream.quarter == label).order_by(QuarterStream.position))).scalars().all())


async def set_super_objective(db, user_id: int, label: str, text: str, arabic: str | None) -> None:
    text = _one_line(text, "objective")
    if not text:
        raise ValueError("objective is empty")
    quarter = await _quarter(db, user_id, label)
    quarter.objective = text
    if arabic is not None:
        quarter.objective_ar = _one_line(arabic, "Arabic text")


def _set_checkpoint_text(row: QuarterStream, month: str, text: str) -> None:
    checkpoints = [dict(c) for c in row.checkpoints or []]
    for c in checkpoints:
        if c["month"] == month:
            c["text"] = text
            break
    else:
        checkpoints.append({"month": month, "text": text})
    row.checkpoints = checkpoints


async def update_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str]) -> None:
    """Change name/colour/icon/slot/weekly/goal/status and month checkpoints of one stream defined in the quarter."""
    await _quarter(db, user_id, label)
    row = next((r for r in await _stream_rows(db, user_id, label) if r.slug == stream and r.in_note), None)
    if row is None:
        raise ValueError(f"unknown stream '{stream}'")
    months = quarter_months(label)
    for key, value in fields.items():
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
        if key in months:
            _set_checkpoint_text(row, key, _one_line(value, key))
            continue
        clean = _validate(key, value)
        if key == "weekly":
            row.weekly = clean.lower() != "no"
        else:
            setattr(row, key, clean)


async def add_stream(db, user_id: int, label: str, stream: str, fields: dict[str, str]) -> None:
    if not SLUG.match(stream):
        raise ValueError("id must be 2-24 lowercase letters, digits or dashes, starting with a letter")
    await _quarter(db, user_id, label)
    rows = await _stream_rows(db, user_id, label)
    if any(r.slug == stream and r.in_note for r in rows):
        raise ValueError(f"stream '{stream}' already exists")
    months = quarter_months(label)
    data = {"status": "committed", **fields}
    for key in data:
        if key not in FIELD_KEYS and key not in months:
            raise ValueError(f"cannot set '{key}'")
    written = {k: _validate(k, data[k]) for k in FIELD_KEYS if k in data and data[k].strip()}
    if not written.get("name"):
        raise ValueError("name is required")
    info = make_stream(stream, written)
    checkpoints = [{"month": m, "text": _one_line(data[m], m)} for m in months if m in data]
    last_note = max((r.position for r in rows if r.in_note), default=-1)
    for r in rows:
        if r.position > last_note:
            r.position += 1  # built-in extras stay after the streams the quarter defines
    taken = next((r for r in rows if r.slug == stream and not r.in_note), None)
    if taken is not None:
        await db.delete(taken)
        await db.flush()
    db.add(QuarterStream(user_id=user_id, quarter=label, slug=stream, name=info.name, color=info.color, icon=info.icon,
                         slot=info.slot, weekly=info.weekly, has_pipeline=info.goal, in_note=True, goal=written.get("goal", ""),
                         status=info.status, checkpoints=checkpoints, position=last_note + 1))
```

- [ ] **Step 4: Dispatch the endpoints**

In `app/api/v1/vault.py`:

1. `_quarter_json(db, user, today)` helper that returns the quarter response from the database (reuse the code in `get_quarter`; refactor `get_quarter`'s db branch to call it):

```python
async def _db_quarter(db: AsyncSession, user: User, today: date) -> QuarterResponse:
    label = quarter_for(today)
    data = await planner_store.quarter_data(db, user.id, label)
    if data is None:
        raise HTTPException(status_code=404, detail=f"No plan for {label} yet")
    return quarter_response(data, label, today)
```

2. `put_objective`:

```python
@router.put("/objectives", response_model=ObjectivesResponse)
async def put_objective(data: ObjectiveIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    if _db_mode():
        week = week_for(today)[2]
        streams = await planner_store.streams_for(db, user.id, today)
        block = next((s for s in streams if s.id == data.stream), None)

        async def work():
            await planner_work.update_objective(db, user.id, today, data.stream, data.text, data.done, data.checkpoint, streams)
            if block and block.goal and not block.archived and (data.text is not None or data.done is not None):
                await planner_work.sync_focus(db, user.id, data.stream, week, today, text=data.text, done=data.done)

        await _db_run(db, work)
        parsed = await planner_store.week_objectives(db, user.id, week, streams)
        return objectives_response(parsed, streams, today)
    ... existing vault code unchanged ...
```

3. Pipeline handlers from Task 3 get their linking (db branches only):

```python
    # put_pipeline_move
    if _db_mode():
        await _known_stream(db, user, data.stream, today)
        week = week_for(today)[2]
        streams = await planner_store.streams_for(db, user.id, today)

        async def work():
            item = await planner_work.item_row(db, user.id, data.stream, data.line)
            if item.focus_week == week and (data.lane == "done") != item.done:
                await planner_work.update_objective(db, user.id, today, data.stream, None, data.lane == "done", None, streams)
            await planner_work.move_item(db, user.id, data.stream, data.line, data.lane, today)

        return await _db_day_write(db, work)
```

`put_pipeline_focus`: `item = await item_row(...)` (422 "that item changed or moved; reload and try again" if missing), then `update_objective(db, user.id, today, data.stream, item.text, False, item.checkpoint or "", streams)`, then `set_focus(db, user.id, data.stream, data.line, week, today)`.
`post_pipeline_remove`: `item = await item_row(...)`; if `item.focus_week == week`: `update_objective(db, user.id, today, data.stream, "", None, "", streams)`; then `remove_item(...)`.

4. `put_super_objective`, `put_stream`, `post_stream`:

```python
@router.put("/quarter", response_model=QuarterResponse)
async def put_super_objective(data: SuperObjectiveIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    today = _local_now().date()
    label = quarter_for(today)
    if _db_mode():
        await _db_run(db, lambda: planner_work.set_super_objective(db, user.id, label, data.text, data.arabic))
        return await _db_quarter(db, user, today)
    return await _save_quarter(lambda c: set_super_objective(c, label, data.text, data.arabic), "Niyyah: edit the Super Objective")
```

`put_stream` / `post_stream`: same shape with `fields = _fields(data)`; keep the "nothing to change" 422 check in `put_stream` before the branch; db calls `planner_work.update_stream(db, user.id, label, data.stream, fields)` / `add_stream(...)`.

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py tests/test_vault_objectives.py tests/test_vault_quarter.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "Write objectives, the quarter and the small-domino link to the database in db mode"
```

---

### Task 5: Notebook writes

**Files:**
- Modify: `app/services/planner_work.py`, `app/api/v1/vault.py`
- Test: `tests/test_db_work_writes.py`

**Interfaces:**
- Produces in `planner_work`: `add_entry(db, user_id, stream, kind, title, body, today) -> None`, `set_entry(db, user_id, stream, entry_id, title, body) -> None`, `set_blocker(db, user_id, stream, entry_id, open_) -> None`, `remove_entry(db, user_id, stream, entry_id) -> None`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_db_work_writes.py`:

```python
async def _notebook(client, stream="kahf"):
    data = (await client.get(f"{V}/notebooks")).json()
    return next(s for s in data["streams"] if s["stream"] == stream)["entries"]


@pytest.mark.asyncio
async def test_notebook_entries_come_newest_first(db_client):
    client, today = db_client
    res = await client.post(f"{V}/notebook/kahf/entries", json={"kind": "blocker", "title": "", "body": "# Need approval\nfrom legal"})
    assert res.status_code == 200
    entries = await _notebook(client)
    first = entries[0]
    assert first["kind"] == "blocker" and first["open"] is True and first["date"] == today.isoformat()
    assert first["title"] == "### Need approval" and first["body"] == "### Need approval\nfrom legal" and len(first["id"]) == 8
    assert len(entries) == 3
    assert (await client.post(f"{V}/notebook/kahf/entries", json={"kind": "poem", "title": "x", "body": ""})).status_code == 422
    assert (await client.post(f"{V}/notebook/nope/entries", json={"kind": "idea", "title": "x", "body": ""})).status_code == 422


@pytest.mark.asyncio
async def test_notebook_edit_blocker_and_remove(db_client):
    client, today = db_client
    entries = await _notebook(client)
    idea = next(e for e in entries if e["kind"] == "idea")
    blocker = next(e for e in entries if e["kind"] == "blocker")
    await client.put(f"{V}/notebook/entry", json=_ref("kahf", idea, title="Passkeys v2", body="cheaper than SSO\nsee https://example.com/x"))
    await client.put(f"{V}/notebook/blocker", json=_ref("kahf", blocker, open=False))
    entries = await _notebook(client)
    idea = next(e for e in entries if e["kind"] == "idea")
    blocker = next(e for e in entries if e["kind"] == "blocker")
    assert idea["title"] == "Passkeys v2" and idea["url"] == "https://example.com/x" and blocker["open"] is False
    assert (await client.put(f"{V}/notebook/blocker", json=_ref("kahf", idea, open=False))).status_code == 422
    await client.post(f"{V}/notebook/remove", json=_ref("kahf", idea))
    assert all(e["kind"] != "idea" for e in await _notebook(client))
    assert (await client.post(f"{V}/notebook/remove", json=_ref("kahf", idea))).status_code == 422
```

- [ ] **Step 2: Run to verify they fail**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py -q -k notebook`
Expected: FAIL (501).

- [ ] **Step 3: Add the functions**

Add `from app.models.planner import NotebookEntry` (extend the existing import) and `from app.services.vault_notebook import LABELS, _clean as clean_entry, _new_id`; append:

```python
ENTRY_GONE = "that entry changed or moved; reload and try again"


async def _entry(db, user_id: int, stream: str, entry_id: int) -> NotebookEntry:
    row = (await db.execute(select(NotebookEntry).where(
        NotebookEntry.user_id == user_id, NotebookEntry.stream == stream, NotebookEntry.id == entry_id))).scalar_one_or_none()
    if row is None:
        raise ValueError(ENTRY_GONE)
    return row


async def add_entry(db, user_id: int, stream: str, kind: str, title: str, body: str, today: date) -> None:
    """A new entry goes first; a blocker starts open."""
    title, body = clean_entry(kind, title, body)
    first = (await db.execute(select(func.min(NotebookEntry.position)).where(
        NotebookEntry.user_id == user_id, NotebookEntry.stream == stream))).scalar()
    db.add(NotebookEntry(user_id=user_id, stream=stream, ext_id=_new_id(), kind=kind, title=title, body=body,
                         entry_date=today.isoformat(), is_open=True if kind == "blocker" else None,
                         position=0 if first is None else first - 1))
    await db.flush()


async def set_entry(db, user_id: int, stream: str, entry_id: int, title: str, body: str) -> None:
    row = await _entry(db, user_id, stream, entry_id)
    row.title, row.body = clean_entry(row.kind, title, body)


async def set_blocker(db, user_id: int, stream: str, entry_id: int, open_: bool) -> None:
    row = await _entry(db, user_id, stream, entry_id)
    if row.kind != "blocker":
        raise ValueError("only a blocker can be opened or cleared")
    row.is_open = open_


async def remove_entry(db, user_id: int, stream: str, entry_id: int) -> None:
    await db.delete(await _entry(db, user_id, stream, entry_id))
```

(`LABELS` is not needed; drop it from the import if the linter complains. Note the first test expects a blank title with a body starting `# Need approval` to become `### Need approval`: `clean_entry` demotes the heading and derives the title from the first line, exactly as the vault does.)

- [ ] **Step 4: Dispatch the four notebook handlers**

Swap `require_editor` for `require_planner_user`, add `db`, and add the branches (each first calls `await _known_stream(db, user, <stream>, today)`):

```python
    # post_notebook_entry
    return await _db_day_write(db, lambda: planner_work.add_entry(db, user.id, stream, data.kind, data.title, data.body, today))
    # put_notebook_entry
    return await _db_day_write(db, lambda: planner_work.set_entry(db, user.id, data.stream, data.line, data.title, data.body))
    # put_notebook_blocker
    return await _db_day_write(db, lambda: planner_work.set_blocker(db, user.id, data.stream, data.line, data.open))
    # post_notebook_remove
    return await _db_day_write(db, lambda: planner_work.remove_entry(db, user.id, data.stream, data.line))
```

`planner_store.notebook_entries` already returns `line = row id`.

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_work_writes.py tests/test_vault_notebook.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app tests
git commit -m "Write notebook entries to the database in db mode"
```

---

### Task 6: Calendar feeds, events and Google access

In vault mode the iCal feed URLs come from the Day Planner plugin settings inside the vault. In db mode they are rows of the user.

**Files:**
- Modify: `app/models/planner.py`, `app/services/vault_calendar.py`, `app/services/vault_import.py`, `app/services/planner_store.py`, `app/api/v1/vault.py`
- Create: `alembic/versions/e7a2c4d9b013_calendar_feeds.py`
- Test: `tests/test_db_events.py`

**Interfaces:**
- Produces: `PlannerCalendarFeed(user_id, name, url, color, email, position)`; `planner_store.calendar_feeds(db, user_id) -> list[dict]` (`{name, url, color, email}`); `events_for_day(root, day, tz, google=None, feeds=None)` where a non-None `feeds` replaces `sources(root)`; the import counts `calendar_feeds`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_db_events.py`:

```python
from datetime import date

import pytest
from sqlalchemy import select

from app.models.planner import PlannerCalendarFeed
from app.services import vault_calendar
from tests.conftest import TestSession

ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:1
DTSTART:20261007T060000Z
DTEND:20261007T070000Z
SUMMARY:Standup
LOCATION:https://meet.google.com/abc-defg-hij
END:VEVENT
END:VCALENDAR
"""


def test_events_for_day_uses_the_given_feeds_instead_of_the_vault(tmp_path, monkeypatch):
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS)
    feeds = [{"name": "Work", "url": "https://example.com/a.ics", "color": "#00f", "email": None}]
    events, errors = vault_calendar.events_for_day(tmp_path, date(2026, 10, 7), "UTC", None, feeds)
    assert errors == [] and [e["title"] for e in events] == ["Standup"]
    assert events[0]["meeting_url"] == "https://meet.google.com/abc-defg-hij"


@pytest.mark.asyncio
async def test_events_endpoint_reads_the_users_feeds_in_db_mode(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(vault_calendar, "_download", lambda url: ICS)
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=1, name="Work", url="https://example.com/a.ics", color=None, email=None, position=0))
        await db.commit()
    res = await client.get("/api/v1/vault/day/2026-10-07/events")
    assert res.status_code == 200 and [e["title"] for e in res.json()["events"]] == ["Standup"]


@pytest.mark.asyncio
async def test_google_status_is_open_to_any_user_in_db_mode(db_client):
    client, today = db_client
    res = await client.get("/api/v1/vault/calendar/google/status")
    assert res.status_code == 200 and res.json()["connected"] is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_events.py -q`
Expected: FAIL (`PlannerCalendarFeed` missing).

- [ ] **Step 3: Model, migration, calendar function, importer, store**

Append to `app/models/planner.py`:

```python
class PlannerCalendarFeed(Base):
    """An iCal feed (private URL) whose events show on the Overview."""
    __tablename__ = "planner_calendar_feeds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)  # the Google account, to read through its API instead
    position: Mapped[int] = mapped_column(Integer, nullable=False)
```

Create `alembic/versions/e7a2c4d9b013_calendar_feeds.py`:

```python
"""calendar feeds

Revision ID: e7a2c4d9b013
Revises: d4e8b1a95c20
Create Date: 2026-10-08 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7a2c4d9b013"
down_revision: Union[str, None] = "d4e8b1a95c20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_calendar_feeds",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("color", sa.String(20)),
        sa.Column("email", sa.String(255)),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_planner_calendar_feeds_user_id", "planner_calendar_feeds", ["user_id"])


def downgrade() -> None:
    op.drop_table("planner_calendar_feeds")
```

In `app/services/vault_calendar.py` change the signature and the loop source:

```python
def events_for_day(
    root: Path,
    day: date,
    tz: str,
    google: tuple[str, Callable[[datetime, datetime], list[dict]]] | None = None,
    feeds: list[dict] | None = None,
) -> tuple[list[dict], list[str]]:
```
and replace `for source in sources(root):` with `for source in (sources(root) if feeds is None else feeds):`. Extend the docstring with one line: "`feeds` replaces the calendars read from the vault (db mode)".

In `app/services/vault_import.py`: import `PlannerCalendarFeed` and `sources` (`from app.services.vault_calendar import sources`), add `PlannerCalendarFeed` to `USER_TABLES`, add the group

```python
        "calendar_feeds": [PlannerCalendarFeed(user_id=user_id, name=s["name"], url=s["url"], color=s["color"], email=s["email"], position=n)
                           for n, s in enumerate(sources(root))],
```
to `groups` (inside `import_vault`), and update the counts expectation in `tests/test_vault_import.py` (`"calendar_feeds": 0` for the fixture, which has no Day Planner settings).

In `app/services/planner_store.py` append:

```python
async def calendar_feeds(db: AsyncSession, user_id: int) -> list[dict]:
    rows = await _all(db, select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id).order_by(PlannerCalendarFeed.position))
    return [{"name": r.name, "url": r.url, "color": r.color, "email": r.email} for r in rows]
```
(add `PlannerCalendarFeed` to the model import).

- [ ] **Step 4: Endpoints**

In `app/api/v1/vault.py`: `get_day_events` -> `require_planner_user`; replace the `events_for_day` call:

```python
    feeds = await planner_store.calendar_feeds(db, user.id) if _db_mode() else None
    events, errors = await asyncio.to_thread(events_for_day, root, day, settings.vault_tz, google, feeds)
```

`google_status`, `google_connect`, `post_event` -> `require_planner_user` (they use the caller's own Google credential; nothing in them depends on the vault).

- [ ] **Step 5: Run the tests**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_db_events.py tests/test_vault_calendar.py tests/test_vault_import.py tests/test_google_calendar.py -q`
Expected: all pass.

- [ ] **Step 6: Verify the migration on Postgres**

```bash
docker run -d --rm --name niyyah-mig -e POSTGRES_PASSWORD=x -e POSTGRES_USER=niyyah -e POSTGRES_DB=niyyah -p 55432:5432 postgres:17
sleep 8
PYTHONPATH=. DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic upgrade head
PYTHONPATH=. DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic downgrade -1
PYTHONPATH=. DATABASE_URL=postgresql+asyncpg://niyyah:x@localhost:55432/niyyah /tmp/niyyah-oss-venv/bin/alembic upgrade head
docker stop niyyah-mig
```
Expected: three clean runs.

- [ ] **Step 7: Commit**

```bash
git add app alembic tests
git commit -m "Read calendar feeds from the database and open the Google endpoints to any user in db mode"
```

---

### Task 7: Write parity harness

Replays one scenario against a git-backed vault (vault mode) and against the imported database (db mode) and compares what the read endpoints return afterwards.

**Files:**
- Create: `tests/test_writes_parity.py`

- [ ] **Step 1: Write the harness and scenario**

```python
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.core.config import settings
from app.models.user import User
from app.services.vault_import import import_vault
from tests.conftest import TestSession
from tests.vault_fixture import build_vault

V = "/api/v1/vault"
LANE_ORDER = {"now": 0, "next": 1, "backlog": 2, "done": 3}


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True)


def git_vault(tmp_path: Path, today) -> Path:
    """The fixture vault as a git checkout whose origin is a bare repo, as commit_edits expects."""
    seed, bare, work = tmp_path / "seed", tmp_path / "remote.git", tmp_path / "work"
    build_vault(seed, today)
    _git(seed, "init", "-q", "-b", "main")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-q", "-m", "seed")
    subprocess.run(["git", "clone", "-q", "--bare", str(seed), str(bare)], check=True, capture_output=True)
    subprocess.run(["git", "clone", "-q", str(bare), str(work)], check=True, capture_output=True)
    return work


def _strip(obj):
    """Drop what legitimately differs: line numbers (row ids in db mode), hashes, and ids of entries created during the run."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in ("line", "hash", "id")}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


async def snapshot(client, today) -> dict:
    d = today.isoformat()
    out = {}
    for name, url in {"today": "/today", "week": "/week", "streaks": "/streaks", "tasks": f"/day/{d}/tasks", "log": f"/day/{d}/log",
                      "objectives": "/objectives", "quarter": "/quarter", "pipelines": "/pipelines", "notebooks": "/notebooks"}.items():
        res = await client.get(V + url)
        assert res.status_code == 200, (url, res.text)
        out[name] = _strip(res.json())
    for stream in out["pipelines"]["streams"]:  # the vault path lists items in file order, the db path in insertion order; lanes are what the page shows
        stream["items"].sort(key=lambda i: LANE_ORDER[i["lane"]])
    return out


async def scenario(client, today):
    d = today.isoformat()
    ok = lambda r: (r.status_code, r.json().get("detail")) if r.status_code != 200 else 200  # noqa: E731
    results = []
    results.append(ok(await client.put(f"{V}/day/{d}/mode", json={"mode": "yellow"})))
    results.append(ok(await client.put(f"{V}/day/{d}/vote", json={"block": "body", "stars": 3})))
    results.append(ok(await client.put(f"{V}/day/{d}/vote", json={"block": "ops", "stars": 1})))
    results.append(ok(await client.post(f"{V}/day/{d}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Shipped the router"})))
    results.append(ok(await client.post(f"{V}/day/{d}/tasks", json={"text": "Call   the bank"})))
    tasks = (await client.get(f"{V}/day/{d}/tasks")).json()
    t0 = tasks[0]
    results.append(ok(await client.put(f"{V}/tasks", json={"path": t0["path"], "line": t0["line"], "hash": t0["hash"], "done": True})))
    tasks = (await client.get(f"{V}/day/{d}/tasks")).json()
    results.append(ok(await client.put(f"{V}/tasks/text", json={"path": tasks[1]["path"], "line": tasks[1]["line"], "hash": tasks[1]["hash"], "text": "Renew the domain"})))
    log = (await client.get(f"{V}/day/{d}/log")).json()
    results.append(ok(await client.put(f"{V}/day/{d}/log", json={"index": 0, "hash": log[0]["hash"], "text": "Fixed the router"})))
    results.append(ok(await client.post(f"{V}/day/{d}/log/remove", json={"index": 1, "hash": log[1]["hash"]})))

    async def item(prefix):  # fresh reference each time: in the vault a mutation shifts the line numbers of the items below it
        pipes = (await client.get(f"{V}/pipelines")).json()
        return next(i for s in pipes["streams"] if s["stream"] == "kahf" for i in s["items"] if i["text"].startswith(prefix))

    ref = lambda i, **kw: {"stream": "kahf", "line": i["line"], "hash": i["hash"], **kw}  # noqa: E731
    results.append(ok(await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["Buy cables [product:: Router] #nov"], "lane": "next", "descriptions": ["Cat6"]})))
    results.append(ok(await client.put(f"{V}/pipeline/text", json=ref(await item("Plan the DNS"), text="Plan the DNS move"))))
    results.append(ok(await client.put(f"{V}/pipeline/checkpoint", json=ref(await item("Replace the switch"), checkpoint="dec"))))
    results.append(ok(await client.put(f"{V}/pipeline/description", json=ref(await item("Replace the switch"), description="Line one\n\nLine three"))))
    results.append(ok(await client.put(f"{V}/pipeline/move", json=ref(await item("Order the modem"), lane="next"))))
    results.append(ok(await client.put(f"{V}/pipeline/focus", json=ref(await item("Plan the DNS")))))
    results.append(ok(await client.put(f"{V}/objectives", json={"stream": "alisha", "text": "Launch the store", "checkpoint": "nov"})))
    results.append(ok(await client.put(f"{V}/objectives", json={"stream": "kahf", "done": True})))
    results.append(ok(await client.post(f"{V}/pipeline/remove", json=ref(await item("Replace")))))

    results.append(ok(await client.put(f"{V}/quarter", json={"text": "New objective", "arabic": ""})))
    results.append(ok(await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "name": "Kahf Hosting", "weekly": False, "checkpoints": {"nov": "DNS live"}})))
    results.append(ok(await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Errands", "goal": "Clear it"})))
    results.append(ok(await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "color": "plaid"})))

    async def entry(kind):
        nb = (await client.get(f"{V}/notebooks")).json()
        return next(e for s in nb["streams"] if s["stream"] == "kahf" for e in s["entries"] if e["kind"] == kind)

    results.append(ok(await client.post(f"{V}/notebook/kahf/entries", json={"kind": "idea", "title": "Passkeys v2", "body": "see https://example.com/x"})))
    results.append(ok(await client.put(f"{V}/notebook/blocker", json=ref(await entry("blocker"), open=False))))
    results.append(ok(await client.post(f"{V}/notebook/remove", json=ref(await entry("idea")))))
    return results


@pytest.mark.asyncio
async def test_db_writes_match_vault_writes(auth_client, tmp_path, monkeypatch):
    today = _local_now().date()
    work = git_vault(tmp_path, today)
    monkeypatch.setattr(settings, "vault_workdir", str(work))
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    from app.services.vault_sync import sync_vault
    async with TestSession() as db:
        await sync_vault(db, str(work))  # the vault path reads days from the legacy rows
    vault_results = await scenario(auth_client, today)
    vault_state = await snapshot(auth_client, today)

    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, user_id, tmp_path / "seed", today)
    monkeypatch.setattr(settings, "storage_backend", "db")
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "gone"))
    db_results = await scenario(auth_client, today)
    db_state = await snapshot(auth_client, today)

    assert db_results == vault_results
    for key in vault_state:
        assert db_state[key] == vault_state[key], key
```

- [ ] **Step 2: Run it and reconcile differences**

Run: `/tmp/niyyah-oss-venv/bin/python -m pytest tests/test_writes_parity.py -q -x`

Expected on the first run: it may fail with a difference. Each difference is a real mismatch between the two write paths. Fix the database path (`planner_day.py` / `planner_work.py`), not the harness, unless the difference is one of the three accepted ones (line numbers, hashes, entry ids; list order inside a lane is compared by lane only). After each fix rerun. Typical findings to expect and how to resolve them:
- a key present in one `results` entry only: the status code or 422 message differs; align the message with the vault function's `ValueError` text.
- `quarter.streams` ordering or `status` of a new stream: check `add_stream` position shifting and the `committed` default.
- `week`/`today` totals: check `possible_for` and `total` recomputation.

- [ ] **Step 3: Commit**

```bash
git add tests app
git commit -m "Prove db-mode writes match vault-mode writes with a replayed scenario"
```

---

### Task 8: Finish, verify and deploy

**Files:**
- Modify: `app/api/v1/vault.py`, `docs/superpowers/specs/2026-10-08-db-storage-design.md`

- [ ] **Step 1: Remove the 501 gate.** Replace every remaining `Depends(require_editor)` in `vault.py` with `Depends(require_planner_user)` (there should be none left that matters; the remaining uses are `/sync` handlers, which stay on `get_current_user`), delete `require_editor`, and make the edit-access answer true for every user in db mode:

```python
@router.get("/edit-access", response_model=EditAccessResponse)
async def edit_access(user: User = Depends(get_current_user)):
    return EditAccessResponse(allowed=_db_mode() or _can_edit(user))
```

Delete `tests/test_storage_switch.py::test_db_mode_refuses_vault_writes` and add `test_every_user_may_edit_in_db_mode` asserting `/vault/edit-access` returns `{"allowed": true}` for a user who is not in `VAULT_WRITE_EMAILS` when `storage_backend` is `db`.

- [ ] **Step 2: Full suite, alone.** `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (no other pytest running). Expected: all green.

- [ ] **Step 3: Update the spec.** Add to "Amendments": phase 3 addressing (`line` carries the row id in db mode, log entries use a content hash, so the frontend needs no change until the vault path is removed in phase 5); calendar feeds table; writes are atomic per request. Mark phase 3 built.

- [ ] **Step 4: Commit and merge.** `git add -A && git commit -m "Open db-mode writes to every signed-in user and record phase 3"`, then `git checkout main && git merge --ff-only feature/db-storage-writes`.

- [ ] **Step 5: Deploy in this order** (CI does not run migrations):
1. Back up: `pg_dump -Fc` of the `niyyah` database through a port-forward to `shared-pg-rw` into `~/backups/` (mode 600).
2. Apply the migration from the feature branch against production (`alembic upgrade head` through the port-forward). It only adds a table; the running image ignores it.
3. Push `main` and a new minor tag. Production keeps `STORAGE_BACKEND=vault`, so behaviour is unchanged.
4. Verify the rollout (`kubectl -n niyyah rollout status`) and that `/api/v1/vault/week` still answers.

Do not set `STORAGE_BACKEND=db` anywhere. That is the phase 5 cutover.

---

## Self-review against the spec and the phase 2 plan

- Writes covered: day mode/vote/note, tasks, log, pipeline (all eight operations), objectives, quarter (super objective, stream edit, stream add), notebooks (four operations), plus the calendar feed read that the Overview needs. Google endpoints open to any user in db mode.
- Atomicity: one commit per request through `_db_run`; the pipeline-plus-objective link is one transaction (the vault path makes it one git commit).
- Isolation: every service query filters on `user_id`; tests cover another user's item and task.
- Parity: Task 7 replays 30 operations against both paths and compares reads and statuses.
- Not in this phase by design: Settings editors for blocks, streams, schedule and calendar feeds (phase 4); removing the vault path, `/sync`, and renaming `line` to `id` (phase 5).
- Type check: `_db_run(db, work)`, `_db_day_write(db, work)`, `planner_day.*` and `planner_work.*` signatures are used with the same names and argument orders in Tasks 2 to 5.
