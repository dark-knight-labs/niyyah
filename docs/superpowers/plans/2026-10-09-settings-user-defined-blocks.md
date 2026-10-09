# Settings and user-defined blocks (storage phase 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One per-user list of blocks, a stream and weekend per schedule, editors for all of it on the Settings page, a seeded starter for new accounts, and no block, weekend or OT-owner rule left hard-coded.

**Architecture:** `planner_blocks` table plus a `stream` column on schedule rows. `/vault/config/*` endpoints read and replace blocks, schedule and feeds. In `vault` mode the same GET endpoints return the owner's defaults (so production keeps its behaviour); writes answer 501. The web app gets a `BlocksProvider` and `useBlocks()` that replace the constant lists; removing the constants makes `tsc` list every call site that still needs converting.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest-asyncio; Next.js 16, React, Tailwind, `tsc`.

Spec: `docs/superpowers/specs/2026-10-09-settings-user-defined-blocks-design.md`. Mock: https://claude.ai/artifact/Q7Ffwr4FHcRkEXxjQqLcpR.

## Global Constraints

- API work in `/home/ubuntu/src/dark-knight/niyyah/apps/api`; test command `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (205 tests pass today and must keep passing, except tests this plan names for update). **Never run two pytest processes at once** (shared `./test.db`).
- Web work in `/home/ubuntu/src/dark-knight/niyyah/apps/web`; checks `../../node_modules/.bin/tsc --noEmit -p .` and `../../node_modules/.bin/next build`.
- `STORAGE_BACKEND` stays `vault` by default and in production. Vault-mode responses keep today's meaning: the owner's pages must look and behave the same.
- Colours are the 12 stream colour keys: `emerald, amber, violet, fuchsia, cyan, rose, slate, teal, orange, indigo, lime, sky`; in CSS `var(--stream-<key>)` (defined for light and dark in `globals.css`). Never use hex alpha suffixes on them; use `color-mix(in srgb, <color> 8%, transparent)`.
- Block keys are slugs matching `^[a-z][a-z0-9-]{1,19}$` (at most 20 characters, the width of the existing `block` columns) and never change after creation. Ring names are 1 to 6 characters, upper case.
- Branch `feature/settings-blocks` (exists, has the spec). Commit after each task, no AI attribution lines. Do not push until Task 12.
- Overlap warnings stay client-side (the server cannot compute prayer anchors); the server validates syntax, blocks, streams and location only.
- Migrations are not run by CI. Task 12 lists the manual steps.

## File Structure

| File | Responsibility |
|---|---|
| `app/services/planner_defaults.py` (create) | `DEFAULT_BLOCKS` (owner), `STARTER_*` (new accounts), legacy weekend and OT-stream rule |
| `app/models/planner.py` (modify) | `PlannerBlock`; `stream` on `PlannerScheduleBlock` |
| `alembic/versions/f2b4d6a8c013_blocks_and_schedule_stream.py` (create) | migration |
| `app/services/planner_blocks.py` (create) | list and replace blocks, derive blocks on import |
| `app/services/planner_config.py` (create) | replace schedule, feeds, seed a new user |
| `app/schemas/vault.py` (modify) | config schemas; `stream` on schedule rows |
| `app/api/v1/vault.py` (modify) | `/config/*` endpoints, vault-mode defaults, votes scoped to the user's blocks |
| `app/services/planner_day.py`, `vault_parser.py` (modify) | block validation and star ceiling from the user's blocks |
| `app/services/vault_import.py`, `planner_store.py` (modify) | import derives blocks, rows carry `stream`, meta carries `weekend_days` |
| `app/services/auth.py` (modify) | seed at registration in db mode |
| `tests/vault_fixture.py` + existing db tests (modify) | six-block daily notes |
| `tests/test_blocks_config.py`, `test_schedule_config.py`, `test_feeds_config.py`, `test_new_account.py` (create) | tests |
| `web/src/lib/blocks.tsx` (create) | provider and hook |
| `web/src/lib/routine.ts`, `ring.ts`, `streams.ts`, `vault-constants.ts`, `vault-api.ts`, `vault-types.ts` (modify) | generalised, constants removed |
| `web/src/components/**` (modify ~12 files) | read from `useBlocks()` |
| `web/src/components/settings/*.tsx`, `web/src/app/(app)/settings/page.tsx` (create/replace) | Settings page |

---

### Task 1: Defaults, model and migration

**Files:** Create `app/services/planner_defaults.py`, `alembic/versions/f2b4d6a8c013_blocks_and_schedule_stream.py`; modify `app/models/planner.py`.
**Interfaces:** Produces `DEFAULT_BLOCKS: list[dict]`, `STARTER_BLOCKS`, `STARTER_META`, `STARTER_WEEKDAY`, `STARTER_WEEKEND`, `LEGACY_WEEKEND_DAYS`, `legacy_stream(block, day_type) -> str | None`, `COLOR_KEYS`; `PlannerBlock(user_id, key, label, ring_name, color, counts_for_stars, position, archived)`; `PlannerScheduleBlock.stream`.

- [ ] **Step 1: Failing test** `tests/test_planner_defaults.py`:

```python
from app.services.planner_defaults import COLOR_KEYS, DEFAULT_BLOCKS, STARTER_BLOCKS, STARTER_WEEKDAY, STARTER_WEEKEND, legacy_stream
from app.services.vault_streams import COLORS, SLUG


def test_colour_keys_match_the_stream_palette():
    assert tuple(COLOR_KEYS) == COLORS


def test_every_default_and_starter_block_is_well_formed():
    for blocks in (DEFAULT_BLOCKS, STARTER_BLOCKS):
        keys = [b["key"] for b in blocks]
        assert len(keys) == len(set(keys))
        for b in blocks:
            assert SLUG.match(b["key"]) and b["color"] in COLOR_KEYS and 1 <= len(b["ring_name"]) <= 6 and b["label"].strip()


def test_starter_schedule_only_uses_starter_blocks():
    keys = {b["key"] for b in STARTER_BLOCKS}
    assert {r["block"] for r in STARTER_WEEKDAY + STARTER_WEEKEND} <= keys


def test_legacy_rule_gives_the_ot_slot_to_kahf_on_weekdays_and_alisha_on_weekends():
    assert legacy_stream("ot", "weekday") == "kahf" and legacy_stream("ot", "weekend") == "alisha"
    assert legacy_stream("soul", "weekday") is None
```

- [ ] **Step 2:** Run it, expect `ModuleNotFoundError`.
- [ ] **Step 3: Write `app/services/planner_defaults.py`:**

```python
"""Block and schedule defaults: the owner's set (what vault mode serves today) and the starter template for new accounts."""
from app.services.vault_streams import COLORS

COLOR_KEYS = list(COLORS)


def _b(key, label, ring, color, stars=True, archived=False):
    return {"key": key, "label": label, "ring_name": ring, "color": color, "counts_for_stars": stars, "archived": archived}


# The block set the app has hard-coded until now, with its colours mapped onto the stream palette.
DEFAULT_BLOCKS = [
    _b("soul", "Soul", "SOUL", "emerald"),
    _b("body", "Body", "BODY", "amber"),
    _b("ot", "OT", "OT", "violet"),
    _b("planning", "Planning", "PLAN", "sky", stars=False),
    _b("distribution", "Distribution", "DIST", "cyan"),
    _b("fnf", "FnF", "FNF", "rose"),
    _b("sleep", "Sleep", "SLEEP", "slate"),
    _b("onething", "ONE Thing", "ONE", "indigo", archived=True),
    _b("ops", "OPS", "OPS", "violet", archived=True),
]

LEGACY_WEEKEND_DAYS = ["fri", "sat"]


def legacy_stream(block: str, day_type: str) -> str | None:
    """The old hard-coded rule: the OT slot is Kahf on weekdays and Alisha Noor on the weekend."""
    if block != "ot":
        return None
    return "alisha" if day_type == "weekend" else "kahf"


STARTER_BLOCKS = [
    _b("soul", "Soul", "SOUL", "emerald"),
    _b("body", "Body", "BODY", "amber"),
    _b("work", "Deep work", "WORK", "violet"),
    _b("planning", "Planning", "PLAN", "sky", stars=False),
    _b("fnf", "Family and friends", "FAM", "rose"),
    _b("sleep", "Sleep", "SLEEP", "slate"),
]

STARTER_META = {"city": None, "lat": None, "lon": None, "tz": "UTC", "method": "mwl", "madhab": "shafi", "weekend_days": ["sat", "sun"]}


def _r(block, start, end, what, stream=None):
    return {"block": block, "start": start, "end": end, "what": what, "stream": stream}


STARTER_WEEKDAY = [
    _r("soul", "fajr", "sunrise", "Quran and adhkar"),
    _r("body", "sunrise+10", "07:45", "Walk or train"),
    _r("work", "08:30", "dhuhr-10", "Deep work"),
    _r("soul", "dhuhr", "dhuhr+25", "Dhuhr and lunch"),
    _r("work", "13:30", "asr-15", "Deep work"),
    _r("fnf", "maghrib", "isha+40", "Family dinner"),
    _r("sleep", "isha+90", "fajr-20", "Sleep"),
]
STARTER_WEEKEND = [
    _r("soul", "fajr", "sunrise", "Quran and adhkar"),
    _r("planning", "09:00", "10:30", "Weekly planning"),
    _r("work", "11:00", "asr-15", "Side project"),
    _r("fnf", "maghrib", "isha+60", "Family and friends"),
    _r("sleep", "isha+100", "fajr-20", "Sleep"),
]
```

- [ ] **Step 4:** Add the model. In `app/models/planner.py` append:

```python
class PlannerBlock(Base):
    """A part of the user's day. Votes and schedule rows refer to it by key; archived blocks stay so history still resolves."""
    __tablename__ = "planner_blocks"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_planner_block_user_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    key: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    ring_name: Mapped[str] = mapped_column(String(6), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False)
    counts_for_stars: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

and in `PlannerScheduleBlock` add `stream: Mapped[str | None] = mapped_column(String(24), nullable=True)` after `what`.

- [ ] **Step 5:** Migration `alembic/versions/f2b4d6a8c013_blocks_and_schedule_stream.py` (head today is `e7a2c4d9b013`; confirm with `PYTHONPATH=. alembic heads`):

```python
"""blocks and schedule stream

Revision ID: f2b4d6a8c013
Revises: e7a2c4d9b013
Create Date: 2026-10-09 09:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f2b4d6a8c013"
down_revision: Union[str, None] = "e7a2c4d9b013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "planner_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(20), nullable=False),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("ring_name", sa.String(6), nullable=False),
        sa.Column("color", sa.String(20), nullable=False),
        sa.Column("counts_for_stars", sa.Boolean(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.UniqueConstraint("user_id", "key", name="uq_planner_block_user_key"),
    )
    op.create_index("ix_planner_blocks_user_id", "planner_blocks", ["user_id"])
    op.add_column("planner_schedule_blocks", sa.Column("stream", sa.String(24), nullable=True))


def downgrade() -> None:
    op.drop_column("planner_schedule_blocks", "stream")
    op.drop_table("planner_blocks")
```

- [ ] **Step 6:** Run the defaults test and `tests/test_planner_models.py` (pass). Verify the migration on Postgres with the same docker recipe as before (`upgrade head`, `downgrade -1`, `upgrade head`, then `alembic check` must print "No new upgrade operations detected").
- [ ] **Step 7:** Commit `Add block defaults, the blocks table and a stream on schedule rows`.

---

### Task 2: Blocks service and API

**Files:** Create `app/services/planner_blocks.py`; modify `app/schemas/vault.py`, `app/api/v1/vault.py`. Test `tests/test_blocks_config.py`.
**Interfaces:** Produces `planner_blocks.list_blocks(db, user_id) -> list[dict]`, `replace_blocks(db, user_id, items: list[dict]) -> None` (flush only), `counted_keys(db, user_id) -> list[str]`; schemas `BlockConfig`, `BlocksConfigResponse`, `BlocksConfigIn`; endpoints `GET/PUT /vault/config/blocks`.

- [ ] **Step 1: Failing tests** `tests/test_blocks_config.py`:

```python
import pytest

from app.core.config import settings

V = "/api/v1/vault/config/blocks"


def _blocks(res):
    return res.json()["blocks"]


@pytest.mark.asyncio
async def test_vault_mode_serves_the_owners_defaults_publicly(client):
    res = await client.get(V)
    assert res.status_code == 200
    keys = [b["key"] for b in _blocks(res)]
    assert keys[:3] == ["soul", "body", "ot"] and "onething" in keys
    assert next(b for b in _blocks(res) if b["key"] == "onething")["archived"] is True


@pytest.mark.asyncio
async def test_vault_mode_refuses_writes(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    assert (await auth_client.put(V, json={"blocks": []})).status_code == 501


@pytest.mark.asyncio
async def test_db_mode_needs_a_login(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    assert (await client.get(V)).status_code == 401


@pytest.mark.asyncio
async def test_replace_creates_renames_reorders_and_archives(db_client):
    client, _ = db_client
    current = _blocks(await client.get(V))
    assert [b["key"] for b in current if not b["archived"]][:2] == ["soul", "body"]
    new = [dict(b) for b in current]
    new[0]["label"] = "Spirit"
    new = [new[1], new[0], *new[2:]]  # body first
    new.append({"key": "reading", "label": "Reading", "ring_name": "read", "color": "lime", "counts_for_stars": False, "archived": False})
    res = await client.put(V, json={"blocks": [b for b in new if b["key"] != "planning"]})  # omitting a key archives it
    assert res.status_code == 200
    out = {b["key"]: b for b in _blocks(res)}
    assert out["soul"]["label"] == "Spirit" and out["reading"]["ring_name"] == "READ"
    assert out["planning"]["archived"] is True
    assert [b["key"] for b in _blocks(res)][:2] == ["body", "soul"]


@pytest.mark.asyncio
async def test_replace_rejects_bad_input(db_client):
    client, _ = db_client
    ok = {"key": "soul", "label": "Soul", "ring_name": "SOUL", "color": "emerald", "counts_for_stars": True, "archived": False}
    for bad, text in [
        ({**ok, "key": "Bad Key"}, "key"), ({**ok, "label": " "}, "name"), ({**ok, "ring_name": "TOOLONGNAME"}, "ring"),
        ({**ok, "color": "plaid"}, "colour"),
    ]:
        res = await client.put(V, json={"blocks": [bad]})
        assert res.status_code == 422, (bad, res.text)
    dup = await client.put(V, json={"blocks": [ok, ok]})
    assert dup.status_code == 422 and "twice" in dup.json()["detail"]
    none_active = await client.put(V, json={"blocks": [{**ok, "archived": True}]})
    assert none_active.status_code == 422 and "at least one" in none_active.json()["detail"]


@pytest.mark.asyncio
async def test_a_block_still_on_the_schedule_cannot_be_archived(db_client):
    client, _ = db_client
    current = _blocks(await client.get(V))
    on_schedule = next(b for b in current if b["key"] == "ot")  # the fixture schedule uses ot
    changed = [{**b, "archived": True} if b["key"] == "ot" else b for b in current]
    res = await client.put(V, json={"blocks": changed})
    assert res.status_code == 422 and "schedule" in res.json()["detail"] and on_schedule["label"] in res.json()["detail"]
```

(`db_client` seeds blocks through the importer in Task 4. Until then tests 4 to 6 fail; the order of tasks keeps that visible. For Task 2 alone run only the first three tests and mark the rest `xfail` in the working copy, removing the marks in Task 4.)

- [ ] **Step 2: Schemas.** In `app/schemas/vault.py` append:

```python
class BlockConfig(BaseModel):
    key: str
    label: str
    ring_name: str
    color: str
    counts_for_stars: bool
    archived: bool


class BlocksConfigResponse(BaseModel):
    blocks: list[BlockConfig]


class BlocksConfigIn(BaseModel):
    blocks: list[BlockConfig]
```

- [ ] **Step 3: Service** `app/services/planner_blocks.py`:

```python
"""A user's blocks: the parts of the day that votes and the schedule refer to."""
from sqlalchemy import select

from app.models.planner import PlannerBlock, PlannerScheduleBlock
from app.services.planner_defaults import COLOR_KEYS
import re

BLOCK_KEY = re.compile(r"^[a-z][a-z0-9-]{1,19}$")
MAX_LABEL = 40


def _out(row: PlannerBlock) -> dict:
    return {"key": row.key, "label": row.label, "ring_name": row.ring_name, "color": row.color,
            "counts_for_stars": row.counts_for_stars, "archived": row.archived}


async def _rows(db, user_id: int) -> list[PlannerBlock]:
    return list((await db.execute(select(PlannerBlock).where(PlannerBlock.user_id == user_id)
                                  .order_by(PlannerBlock.position))).scalars().all())


async def list_blocks(db, user_id: int) -> list[dict]:
    return [_out(r) for r in await _rows(db, user_id)]


async def counted_keys(db, user_id: int, include_archived: bool = False) -> list[str]:
    return [r.key for r in await _rows(db, user_id) if r.counts_for_stars and (include_archived or not r.archived)]


def _clean(item: dict) -> dict:
    key = item["key"]
    if not BLOCK_KEY.match(key):
        raise ValueError(f"'{key}' is not a valid key: use 2-20 lowercase letters, digits or dashes, starting with a letter")
    label = " ".join(item["label"].split())
    if not label or len(label) > MAX_LABEL:
        raise ValueError(f"the name of '{key}' must be 1-{MAX_LABEL} characters")
    ring = item["ring_name"].strip().upper()
    if not 1 <= len(ring) <= 6:
        raise ValueError(f"the ring name of '{key}' must be 1-6 characters")
    if item["color"] not in COLOR_KEYS:
        raise ValueError(f"unknown colour '{item['color']}'")
    return {"key": key, "label": label, "ring_name": ring, "color": item["color"],
            "counts_for_stars": bool(item["counts_for_stars"]), "archived": bool(item["archived"])}


async def replace_blocks(db, user_id: int, items: list[dict]) -> None:
    """Make `items` (in order) the user's blocks. A block that is left out is archived, never deleted."""
    clean = [_clean(i) for i in items]
    keys = [c["key"] for c in clean]
    if len(keys) != len(set(keys)):
        raise ValueError("a key appears twice")
    if not any(not c["archived"] for c in clean):
        raise ValueError("keep at least one block that is not archived")
    existing = {r.key: r for r in await _rows(db, user_id)}
    for position, c in enumerate(clean):
        row = existing.pop(c["key"], None)
        if row is None:
            row = PlannerBlock(user_id=user_id, position=position, **c)
            db.add(row)
        else:
            row.label, row.ring_name, row.color = c["label"], c["ring_name"], c["color"]
            row.counts_for_stars, row.archived, row.position = c["counts_for_stars"], c["archived"], position
    for offset, row in enumerate(existing.values(), start=len(clean)):
        row.archived, row.position = True, offset
    await db.flush()
    used = {r for (r,) in (await db.execute(select(PlannerScheduleBlock.block).where(PlannerScheduleBlock.user_id == user_id))).all()}
    labels = {r.key: r.label for r in await _rows(db, user_id) if r.archived}
    for key in sorted(used & set(labels)):
        raise ValueError(f"'{labels[key]}' is still on your schedule; remove those rows first")
```

- [ ] **Step 4: Endpoints** in `app/api/v1/vault.py` (imports: `planner_blocks`, `BlockConfig`, `BlocksConfigIn`, `BlocksConfigResponse`, `DEFAULT_BLOCKS`):

```python
@router.get("/config/blocks", response_model=BlocksConfigResponse)
async def get_blocks_config(user: User | None = Depends(get_optional_user), db: AsyncSession = Depends(get_db)):
    """The user's blocks. In vault mode, the owner's defaults, public like the schedule they belong to."""
    if _db_mode():
        if user is None:
            raise HTTPException(status_code=401, detail="Sign in to see your blocks")
        return BlocksConfigResponse(blocks=await planner_blocks.list_blocks(db, user.id))
    return BlocksConfigResponse(blocks=DEFAULT_BLOCKS)


@router.put("/config/blocks", response_model=BlocksConfigResponse)
async def put_blocks_config(data: BlocksConfigIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    if not _db_mode():
        raise HTTPException(status_code=501, detail="Blocks are edited in the vault until STORAGE_BACKEND=db")
    await _db_run(db, lambda: planner_blocks.replace_blocks(db, user.id, [b.model_dump() for b in data.blocks]))
    return BlocksConfigResponse(blocks=await planner_blocks.list_blocks(db, user.id))
```

Pydantic rejects a missing field with 422 already; the tests above send complete bodies.

- [ ] **Step 5:** Run the first three tests (pass). Commit `Serve and replace a user's blocks`.

---

### Task 3: Schedule: stream, weekend days, read and write

**Files:** Create `app/services/planner_config.py`; modify `app/schemas/vault.py`, `app/services/planner_store.py`, `app/api/v1/vault.py`. Test `tests/test_schedule_config.py`.
**Interfaces:** Produces `planner_config.replace_schedule(db, user_id, meta: dict, weekday: list[dict], weekend: list[dict], stream_ids: set[str]) -> None`; `ScheduleBlockResponse.stream: str | None = None`; `PUT /vault/config/schedule`.

- [ ] **Step 1: Failing tests** `tests/test_schedule_config.py`:

```python
import pytest

S = "/api/v1/vault/schedule"
C = "/api/v1/vault/config/schedule"
META = {"city": "Leeds", "lat": 53.8, "lon": -1.55, "tz": "Europe/London", "method": "mwl", "madhab": "hanafi", "weekend_days": ["sat", "sun"]}
ROW = {"block": "soul", "start": "fajr", "end": "sunrise", "what": "Quran", "stream": None}


@pytest.mark.asyncio
async def test_vault_mode_schedule_carries_weekend_days_and_the_legacy_ot_stream(client, tmp_path, monkeypatch):
    from app.core.config import settings
    from tests.vault_fixture import build_vault
    from datetime import date
    build_vault(tmp_path, date(2026, 10, 7))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))
    body = (await client.get(S)).json()
    assert body["meta"]["weekend_days"] == ["fri", "sat"]
    ot = next(r for r in body["days"]["weekday"] if r["block"] == "ot")
    assert ot["stream"] == "kahf" and next(r for r in body["days"]["weekday"] if r["block"] == "soul")["stream"] is None


@pytest.mark.asyncio
async def test_save_then_read_back(db_client):
    client, _ = db_client
    res = await client.put(C, json={"meta": META, "weekday": [ROW, {**ROW, "block": "ot", "start": "08:30", "end": "dhuhr-10", "stream": "kahf"}], "weekend": [ROW]})
    assert res.status_code == 200
    body = (await client.get(S)).json()
    assert body["meta"]["city"] == "Leeds" and body["meta"]["weekend_days"] == ["sat", "sun"]
    assert [r["block"] for r in body["days"]["weekday"]] == ["soul", "ot"] and body["days"]["weekday"][1]["stream"] == "kahf"


@pytest.mark.asyncio
async def test_validation(db_client):
    client, _ = db_client
    def put(**over):
        payload = {"meta": META, "weekday": [ROW], "weekend": [ROW]}
        payload.update(over)
        return client.put(C, json=payload)
    cases = [
        ({"weekday": [{**ROW, "start": "25:00"}]}, "time"),
        ({"weekday": [{**ROW, "block": "nope"}]}, "block"),
        ({"weekday": [{**ROW, "stream": "ghost"}]}, "stream"),
        ({"weekday": []}, "weekday"),
        ({"meta": {**META, "lat": 123}}, "latitude"),
        ({"meta": {**META, "tz": "Mars/Base"}}, "time zone"),
        ({"meta": {**META, "method": "astrology"}}, "method"),
        ({"meta": {**META, "weekend_days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]}}, "weekend"),
        ({"meta": {**META, "weekend_days": ["funday"]}}, "weekend"),
    ]
    for over, word in cases:
        res = await put(**over)
        assert res.status_code == 422 and word in res.json()["detail"].lower(), (over, res.text)
    assert (await put(meta={**META, "lat": None, "lon": None})).status_code == 200  # a new account may not have a location yet
    assert (await put(meta={**META, "lat": 10, "lon": None})).status_code == 422
```

- [ ] **Step 2: Schemas.** In `ScheduleBlockResponse` add `stream: str | None = None`. Append:

```python
class ScheduleRowIn(BaseModel):
    block: str
    start: str
    end: str
    what: str = ""
    stream: str | None = None


class ScheduleMetaIn(BaseModel):
    city: str | None = None
    lat: float | None = None
    lon: float | None = None
    tz: str
    method: str
    madhab: str
    weekend_days: list[str]


class ScheduleConfigIn(BaseModel):
    meta: ScheduleMetaIn
    weekday: list[ScheduleRowIn]
    weekend: list[ScheduleRowIn]
```

- [ ] **Step 3: Service** `app/services/planner_config.py` (schedule part):

```python
"""Saving a user's schedule settings; validation mirrors what the web app can resolve."""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, select

from app.models.planner import PlannerBlock, PlannerScheduleBlock, PlannerScheduleSetting
from app.services.vault_schedule import _valid_time

METHODS = {"karachi", "mwl", "isna", "egyptian", "ummalqura", "dubai", "qatar", "kuwait", "singapore", "turkey", "tehran", "moonsighting"}
MADHABS = {"hanafi", "shafi"}
WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def _meta(meta: dict) -> dict:
    lat, lon = meta.get("lat"), meta.get("lon")
    if (lat is None) != (lon is None):
        raise ValueError("give both latitude and longitude, or neither")
    if lat is not None and not (-90 <= lat <= 90):
        raise ValueError("latitude must be between -90 and 90")
    if lon is not None and not (-180 <= lon <= 180):
        raise ValueError("longitude must be between -180 and 180")
    try:
        ZoneInfo(meta["tz"])
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        raise ValueError(f"unknown time zone '{meta.get('tz')}'")
    method = meta["method"].lower()
    if method not in METHODS:
        raise ValueError(f"unknown calculation method '{meta['method']}'")
    madhab = meta["madhab"].lower()
    if madhab not in MADHABS:
        raise ValueError(f"unknown madhab '{meta['madhab']}'")
    days = list(dict.fromkeys(meta["weekend_days"]))
    if any(d not in WEEKDAYS for d in days):
        raise ValueError("weekend days must be mon, tue, wed, thu, fri, sat or sun")
    if len(days) >= 7:
        raise ValueError("keep at least one weekday: not every day can be a weekend day")
    return {"city": (meta.get("city") or "").strip() or None, "lat": lat, "lon": lon, "tz": meta["tz"], "method": method,
            "madhab": madhab, "weekend_days": days}


def _rows(rows: list[dict], label: str, blocks: dict[str, bool], stream_ids: set[str]) -> list[dict]:
    if not rows:
        raise ValueError(f"the {label} schedule needs at least one row")
    out = []
    for n, r in enumerate(rows, start=1):
        for field in ("start", "end"):
            if not _valid_time(r[field].strip().lower()):
                raise ValueError(f"{label} row {n}: '{r[field]}' is not a time (use HH:MM or a prayer like fajr+10)")
        if r["block"] not in blocks:
            raise ValueError(f"{label} row {n}: unknown block '{r['block']}'")
        if blocks[r["block"]]:
            raise ValueError(f"{label} row {n}: '{r['block']}' is archived")
        stream = (r.get("stream") or "").strip() or None
        if stream and stream not in stream_ids:
            raise ValueError(f"{label} row {n}: unknown stream '{stream}'")
        out.append({"block": r["block"], "start": r["start"].strip().lower(), "end": r["end"].strip().lower(),
                    "what": " ".join((r.get("what") or "").split()), "stream": stream})
    return out


async def replace_schedule(db, user_id: int, meta: dict, weekday: list[dict], weekend: list[dict], stream_ids: set[str]) -> None:
    clean_meta = _meta(meta)
    blocks = {r.key: r.archived for r in (await db.execute(select(PlannerBlock).where(PlannerBlock.user_id == user_id))).scalars().all()}
    days = {"weekday": _rows(weekday, "weekday", blocks, stream_ids), "weekend": _rows(weekend, "weekend", blocks, stream_ids)}
    setting = (await db.execute(select(PlannerScheduleSetting).where(PlannerScheduleSetting.user_id == user_id))).scalar_one_or_none()
    if setting is None:
        db.add(PlannerScheduleSetting(user_id=user_id, meta=clean_meta))
    else:
        setting.meta = clean_meta
    await db.execute(delete(PlannerScheduleBlock).where(PlannerScheduleBlock.user_id == user_id))
    for day_type, rows in days.items():
        for position, r in enumerate(rows):
            db.add(PlannerScheduleBlock(user_id=user_id, day_type=day_type, position=position, **r))
    await db.flush()
```

- [ ] **Step 4: Store and endpoints.** In `planner_store.schedule` add `"stream": r.stream` to each row dict, and default `meta` to include `weekend_days` (`meta.setdefault("weekend_days", ["sat", "sun"])` on a copy). In `app/api/v1/vault.py`:
  - vault-mode `get_schedule`: after building the response, `meta = {**parsed.meta, "weekend_days": LEGACY_WEEKEND_DAYS}` and each row `{**asdict(b), "stream": legacy_stream(b.block, day_type)}` (import from `planner_defaults`).
  - New endpoint:

```python
@router.put("/config/schedule", response_model=VaultScheduleResponse)
async def put_schedule_config(data: ScheduleConfigIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    if not _db_mode():
        raise HTTPException(status_code=501, detail="The schedule is edited in the vault until STORAGE_BACKEND=db")
    today = _local_now().date()
    streams = await planner_store.streams_for(db, user.id, today)
    ids = {s.id for s in streams}
    await _db_run(db, lambda: planner_config.replace_schedule(
        db, user.id, data.meta.model_dump(), [r.model_dump() for r in data.weekday], [r.model_dump() for r in data.weekend], ids))
    return await planner_store.schedule(db, user.id)
```
  (`planner_store.schedule` returns the response dict.)
- [ ] **Step 5:** The importer and fixtures change in Task 4, so run only `test_vault_mode_schedule_carries...` now; the `db_client` tests pass after Task 4. Commit `Carry a stream and weekend days on the schedule and let users save it`.

---

### Task 4: Importer derives blocks; six-block fixture; votes use the user's blocks

**Files:** Modify `app/services/vault_import.py`, `tests/vault_fixture.py`, `app/services/vault_parser.py`, `app/services/planner_day.py`, `app/services/planner_store.py`, `app/api/v1/vault.py`, and the db tests named below.
**Interfaces:** Produces `vault_parser.possible_for_count(mode, count) -> int`; importer counts gain `"blocks"`; `planner_day._day` builds a new day from the user's counted, non-archived blocks.

- [ ] **Step 1: Fixture.** In `tests/vault_fixture.py` change `DAILY` so the votes section holds six callouts (soul, body, ot, distribution, fnf, sleep), each shaped like the existing ones; soul has `⭐⭐` ticked, body `⭐` ticked, the other four unticked. Example for one of the new callouts:

```
> [!ot]+ OT
> - [ ] ⭐ Bare Minimum
> - [ ] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best
```

The fixture schedule rows keep `soul` and `ot` (add `planning` to the weekend section so a not-voted block is exercised): append to the weekend table `| planning | 09:00 | 10:30 | Planning |`.

- [ ] **Step 2: Importer.** In `app/services/vault_import.py` add imports (`PlannerBlock`, `DEFAULT_BLOCKS`, `LEGACY_WEEKEND_DAYS`, `legacy_stream`), add `PlannerBlock` to `USER_TABLES`, and these functions:

```python
def _blocks(user_id: int, days: list[VaultDay], schedule_rows: list[PlannerScheduleBlock]) -> list[PlannerBlock]:
    """Blocks seen in the notes' votes and the schedule, labelled from the owner's defaults where the key is known."""
    voted = {v.block for d in days for v in d.block_votes}
    scheduled = {r.block for r in schedule_rows}
    known = {b["key"]: b for b in DEFAULT_BLOCKS}
    order = [b["key"] for b in DEFAULT_BLOCKS if b["key"] in voted | scheduled]
    order += sorted((voted | scheduled) - set(known))
    rows = []
    for position, key in enumerate(order):
        d = known.get(key) or {"label": key.replace("-", " ").title(), "ring_name": key[:6].upper(), "color": "slate", "archived": False}
        rows.append(PlannerBlock(user_id=user_id, key=key, label=d["label"], ring_name=d["ring_name"], color=d["color"],
                                 counts_for_stars=key in voted, position=position, archived=bool(d.get("archived"))))
    return rows
```

In `_schedule` set `meta["weekend_days"] = LEGACY_WEEKEND_DAYS` and give each `PlannerScheduleBlock` `stream=legacy_stream(b.block, day)`. In `import_vault` add `"blocks": _blocks(user_id, days, schedule_blocks)` to `groups` (after schedule is built; `days` and `schedule_blocks` already exist there). A block that the notes vote on but that is also archived by default (`onething`, `ops`) stays archived with `counts_for_stars=True`.

- [ ] **Step 3: Votes.** In `vault_parser.py` add:

```python
def possible_for_count(mode: str, count: int) -> int:
    """Star ceiling for `count` counted blocks: the mode's table value is for seven blocks."""
    return round(MODE_META.get(mode, MODE_META["full"])["possible"] * count / 7)
```

In `planner_day.py`:
  - `_day`: replace the "latest layout" logic with the user's counted, non-archived blocks:

```python
    keys = await planner_blocks.counted_keys(db, user_id)
    if not keys:
        raise ValueError("add a block that counts for stars in Settings first")
    row = VaultDay(user_id=user_id, date=day, mode="full", possible=possible_for_count("full", len(keys)), total=0, focus=None, log=None)
    row.block_votes = [VaultBlockVote(block=b, stars=0) for b in keys]
```
  - `set_mode`: `row.possible = possible_for_count(mode, len(row.block_votes))`.
  - `set_vote`: after alias lookup, replace the `CANONICAL_BLOCKS` check with `if block not in await planner_blocks.counted_keys(db, user_id, include_archived=True): raise ValueError(f"unknown block '{block}'")`.
  - import `planner_blocks`, `possible_for_count`; drop `CANONICAL_BLOCKS`, `possible_for` imports if unused.
- [ ] **Step 4: Series.** In `get_blocks` (the `/vault/blocks?days=` handler) use, in db mode, `keys = await planner_blocks.counted_keys(db, user.id, include_archived=True)` instead of `CANONICAL_BLOCKS` (vault mode unchanged).
- [ ] **Step 5: Update the tests that encode the old numbers.** These expectations change because the fixture now has six blocks:
  - `tests/test_db_reads.py`: `day["blocks"]` becomes `{"soul": 2, "body": 1, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}`; `week["totals"]` becomes `{"soul": 4, "body": 2, "ot": 0, "distribution": 0, "fnf": 0, "sleep": 0}`; `total` stays 3.
  - `tests/test_vault_import.py`: counts gain `"blocks": 7` (soul, body, ot, distribution, fnf, sleep, planning) and the votes count becomes 12.
  - `tests/test_db_day_writes.py`: `test_fixture_gives_an_imported_user_in_db_mode` blocks as above; `test_vote_updates_the_day_totals` expects `blocks["body"] == 3` and `total == 5` (assert those two keys only); `test_mode_change_recomputes_possible` expects 12 (yellow, six blocks); `test_a_missing_day_is_created_from_the_latest_layout` is renamed `..._from_the_current_blocks` and expects six zero-star blocks except `body == 2`.
  - Vault-mode tests are untouched.
- [ ] **Step 6:** Remove the temporary `xfail` marks from Task 2/3 tests, then run `tests/test_blocks_config.py tests/test_schedule_config.py tests/test_db_reads.py tests/test_vault_import.py tests/test_db_day_writes.py tests/test_writes_parity.py` (alone). All pass. If the write-parity test differs on `possible`, the cause is the fixture's block count: vault `possible_for` scales by 6/7 when `ot` is present, the database path by `count/7`; both give 18 for six blocks.
- [ ] **Step 7:** Commit `Derive blocks on import and build days from the user's blocks`.

---

### Task 5: Feeds API and seeding new accounts

**Files:** modify `app/services/planner_config.py`, `app/schemas/vault.py`, `app/api/v1/vault.py`, `app/services/auth.py`. Tests `tests/test_feeds_config.py`, `tests/test_new_account.py`.
**Interfaces:** Produces `planner_config.list_feeds/add_feed/remove_feed`, `planner_config.seed_new_user(db, user_id)`; endpoints `GET/POST /vault/config/feeds`, `DELETE /vault/config/feeds/{id}`.

- [ ] **Step 1: Failing tests.** `tests/test_feeds_config.py`:

```python
import pytest

F = "/api/v1/vault/config/feeds"


@pytest.mark.asyncio
async def test_feeds_are_masked_and_scoped(db_client):
    client, _ = db_client
    added = await client.post(F, json={"name": "Family", "url": "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics"})
    assert added.status_code == 200
    listed = (await client.get(F)).json()
    assert listed[0]["name"] == "Family" and listed[0]["host"] == "calendar.google.com" and "private-abc" not in str(listed)
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get(F, headers=other)).json() == []
    assert (await client.delete(f"{F}/{listed[0]['id']}", headers=other)).status_code == 404
    assert (await client.delete(f"{F}/{listed[0]['id']}")).status_code == 204
    assert (await client.get(F)).json() == []


@pytest.mark.asyncio
async def test_feed_input_is_checked(db_client):
    client, _ = db_client
    for body in ({"name": "x", "url": "http://insecure.example/a.ics"}, {"name": " ", "url": "https://x.example/a.ics"}, {"name": "x", "url": "not a url"}):
        assert (await client.post(F, json=body)).status_code == 422
```

`tests/test_new_account.py`:

```python
import pytest

from app.core.config import settings
from app.services.planner_defaults import STARTER_BLOCKS

V = "/api/v1/vault"


@pytest.mark.asyncio
async def test_registration_in_db_mode_seeds_the_starter(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    await client.post("/api/v1/auth/register", json={"email": "new@niyyah.app", "password": "newpass1234"})
    token = (await client.post("/api/v1/auth/login", json={"email": "new@niyyah.app", "password": "newpass1234"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    blocks = (await client.get(f"{V}/config/blocks", headers=h)).json()["blocks"]
    assert [b["key"] for b in blocks] == [b["key"] for b in STARTER_BLOCKS]
    sched = (await client.get(f"{V}/schedule", headers=h)).json()
    assert sched["meta"]["lat"] is None and sched["meta"]["weekend_days"] == ["sat", "sun"]
    assert len(sched["days"]["weekday"]) == 7 and len(sched["days"]["weekend"]) == 5


@pytest.mark.asyncio
async def test_a_new_account_can_vote_on_its_own_blocks(client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "db")
    await client.post("/api/v1/auth/register", json={"email": "new@niyyah.app", "password": "newpass1234"})
    token = (await client.post("/api/v1/auth/login", json={"email": "new@niyyah.app", "password": "newpass1234"})).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    from app.api.v1.vault import _local_now
    today = _local_now().date()
    res = await client.put(f"{V}/day/{today}/vote", json={"block": "work", "stars": 3}, headers=h)
    assert res.status_code == 200
    day = res.json()["day"]
    assert day["blocks"]["work"] == 3 and set(day["blocks"]) == {"soul", "body", "work", "fnf", "sleep"} and day["possible"] == 15
    assert (await client.put(f"{V}/day/{today}/vote", json={"block": "planning", "stars": 1}, headers=h)).status_code == 422
```

(`possible` is `round(21 * 5 / 7) = 15`: five counted starter blocks.)

- [ ] **Step 2: Schemas.** Append `FeedIn(name: str, url: str)` and `FeedResponse(id: int, name: str, host: str, color: str | None, email: str | None)`.
- [ ] **Step 3: Service.** Append to `planner_config.py`:

```python
from urllib.parse import urlparse

from app.models.planner import PlannerCalendarFeed, PlannerBlock
from app.services.planner_defaults import STARTER_BLOCKS, STARTER_META, STARTER_WEEKDAY, STARTER_WEEKEND


def _host(url: str) -> str:
    return urlparse(url).hostname or ""


async def list_feeds(db, user_id: int) -> list[dict]:
    rows = (await db.execute(select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id)
                             .order_by(PlannerCalendarFeed.position))).scalars().all()
    return [{"id": r.id, "name": r.name, "host": _host(r.url), "color": r.color, "email": r.email} for r in rows]


async def add_feed(db, user_id: int, name: str, url: str) -> None:
    name, url = " ".join(name.split()), url.strip()
    parsed = urlparse(url)
    if not name or len(name) > 120:
        raise ValueError("give the calendar a name of 1-120 characters")
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("the calendar address must start with https://")
    top = (await db.execute(select(func.max(PlannerCalendarFeed.position)).where(PlannerCalendarFeed.user_id == user_id))).scalar()
    db.add(PlannerCalendarFeed(user_id=user_id, name=name, url=url, color=None, email=None, position=0 if top is None else top + 1))
    await db.flush()


async def remove_feed(db, user_id: int, feed_id: int) -> bool:
    row = (await db.execute(select(PlannerCalendarFeed).where(PlannerCalendarFeed.user_id == user_id,
                                                              PlannerCalendarFeed.id == feed_id))).scalar_one_or_none()
    if row is None:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def seed_new_user(db, user_id: int) -> None:
    """The starter template: blocks, settings (no location yet) and a prayer-anchored weekday and weekend."""
    for position, b in enumerate(STARTER_BLOCKS):
        db.add(PlannerBlock(user_id=user_id, position=position, **b))
    db.add(PlannerScheduleSetting(user_id=user_id, meta=dict(STARTER_META)))
    for day_type, rows in (("weekday", STARTER_WEEKDAY), ("weekend", STARTER_WEEKEND)):
        for position, r in enumerate(rows):
            db.add(PlannerScheduleBlock(user_id=user_id, day_type=day_type, position=position, **r))
    await db.flush()
```

(Add `func` to the sqlalchemy import at the top of the file.)

- [ ] **Step 4: Endpoints** in `vault.py`:

```python
@router.get("/config/feeds", response_model=list[FeedResponse])
async def get_feeds(user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    return await planner_config.list_feeds(db, user.id) if _db_mode() else []


@router.post("/config/feeds", response_model=FeedResponse)
async def post_feed(data: FeedIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    if not _db_mode():
        raise HTTPException(status_code=501, detail="Calendars are set in the vault until STORAGE_BACKEND=db")
    await _db_run(db, lambda: planner_config.add_feed(db, user.id, data.name, data.url))
    return (await planner_config.list_feeds(db, user.id))[-1]


@router.delete("/config/feeds/{feed_id}", status_code=204)
async def delete_feed(feed_id: int, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    if not _db_mode():
        raise HTTPException(status_code=501, detail="Calendars are set in the vault until STORAGE_BACKEND=db")
    if not await planner_config.remove_feed(db, user.id, feed_id):
        raise HTTPException(status_code=404, detail="no such calendar")
    await db.commit()
```

- [ ] **Step 5: Seed at registration.** In `app/services/auth.py` `register_user`, after `db.add(UserSettings(...))`: 

```python
    if settings.storage_backend == "db":  # a new account in db mode starts from the starter template
        from app.services.planner_config import seed_new_user
        await seed_new_user(db, user.id)
```
(import `settings` from `app.core.config` at the top if it is not imported there.)
- [ ] **Step 6:** Run the two new test files and `tests/test_auth.py` (alone). Commit `Add the calendar feed API and seed new accounts`.

---

### Task 6: Backend wrap-up

- [ ] **Step 1:** Run the full API suite alone (`/tmp/niyyah-oss-venv/bin/python -m pytest -q`). All green. Fix anything the six-block fixture changed in tests I did not list by updating the expectation, never the code under test, unless the failure shows a real behaviour gap.
- [ ] **Step 2:** Add a mutation check to the write-parity test as a one-off: break `possible_for_count` (`* count / 8`), confirm `test_writes_parity.py` fails, restore with `git checkout -- <file>`.
- [ ] **Step 3:** Commit any test updates `Update db-mode tests for the six-block fixture`.

---

### Task 7: Web: blocks provider, API and types

**Files:** Create `src/lib/blocks.tsx`; modify `src/lib/vault-api.ts`, `src/lib/vault-types.ts`, `src/app/(app)/layout.tsx`.
**Interfaces:** Produces `useBlocks(): Blocks` with `list`, `ready`, `get(key)`, `label(key)`, `ring(key)`, `color(key)`, `forDay(votes)`, `counted`, `reload()`.

- [ ] **Step 1: Types and API.** In `vault-types.ts` add:

```ts
export interface BlockConfig {
  key: string;
  label: string;
  ring_name: string;
  color: string;
  counts_for_stars: boolean;
  archived: boolean;
}
export interface BlocksConfigData { blocks: BlockConfig[] }
export interface ScheduleRowIn { block: string; start: string; end: string; what: string; stream: string | null }
export interface ScheduleMetaIn { city: string | null; lat: number | null; lon: number | null; tz: string; method: string; madhab: string; weekend_days: string[] }
export interface ScheduleConfigIn { meta: ScheduleMetaIn; weekday: ScheduleRowIn[]; weekend: ScheduleRowIn[] }
export interface FeedData { id: number; name: string; host: string; color: string | null; email: string | null }
```

In `vault-api.ts` add to `vaultApi`:

```ts
  blocksConfig: () => api.get<BlocksConfigData>("/vault/config/blocks"),
  saveBlocks: (blocks: BlockConfig[]) => api.put<BlocksConfigData>("/vault/config/blocks", { blocks }),
  saveSchedule: (body: ScheduleConfigIn) => api.put<VaultScheduleData>("/vault/config/schedule", body),
  feeds: () => api.get<FeedData[]>("/vault/config/feeds"),
  addFeed: (name: string, url: string) => api.post<FeedData>("/vault/config/feeds", { name, url }),
  removeFeed: (id: number) => api.delete(`/vault/config/feeds/${id}`),
```

(import the new types.)

- [ ] **Step 2: Provider** `src/lib/blocks.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { colorVar } from "@/lib/streams";
import { vaultApi } from "@/lib/vault-api";
import { BlockConfig } from "@/lib/vault-types";

export interface Blocks {
  list: BlockConfig[];
  ready: boolean;
  get: (key: string) => BlockConfig | undefined;
  label: (key: string) => string;
  ring: (key: string) => string;
  /** A CSS colour (a theme token) for the block; neutral for a key nobody defined. */
  color: (key: string) => string;
  /** The blocks a day shows: the ones it has votes for, in the user's order (unknown keys last); with no votes, the active counted blocks. */
  forDay: (votes: Record<string, number> | undefined) => BlockConfig[];
  reload: () => Promise<void>;
}

const NEUTRAL = "var(--muted-foreground)";
const Ctx = createContext<Blocks | null>(null);

export function BlocksProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<BlockConfig[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    try {
      setList((await vaultApi.blocksConfig()).blocks);
    } catch {
      setList([]); // not signed in, or the API is down: pages fall back to the key as a name
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<Blocks>(() => {
    const byKey = new Map(list.map((b) => [b.key, b]));
    const get = (key: string) => byKey.get(key);
    return {
      list, ready, get, reload,
      label: (key) => get(key)?.label ?? key,
      ring: (key) => get(key)?.ring_name ?? key.slice(0, 6).toUpperCase(),
      color: (key) => (get(key) ? colorVar(get(key)!.color) : NEUTRAL),
      forDay: (votes) => {
        if (!votes || Object.keys(votes).length === 0) return list.filter((b) => b.counts_for_stars && !b.archived);
        const known = list.filter((b) => b.key in votes);
        const unknown = Object.keys(votes).filter((k) => !byKey.has(k)).map((key): BlockConfig =>
          ({ key, label: key, ring_name: key.slice(0, 6).toUpperCase(), color: "slate", counts_for_stars: true, archived: true }));
        return [...known, ...unknown];
      },
    };
  }, [list, ready, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBlocks(): Blocks {
  const value = useContext(Ctx);
  if (!value) throw new Error("useBlocks needs a BlocksProvider above it");
  return value;
}
```

- [ ] **Step 3:** In `(app)/layout.tsx` import `BlocksProvider` and wrap the rendered `{children}` (and the surrounding shell) so every page is inside it.
- [ ] **Step 4:** `tsc` (passes: nothing consumes it yet). Commit `Add the blocks provider and config API client`.

---

### Task 8: Web: remove the constants and convert every call site

**Files:** `src/lib/vault-constants.ts`, `routine.ts`, `ring.ts`, `streams.ts`, and the components below. After deleting the constants, `tsc` lists every remaining site; convert each as follows.

- [ ] **Step 1: Delete** from `vault-constants.ts`: `BLOCK_ORDER`, `Block`, `LEGACY_MERGED_BLOCKS`, `blocksForDay`, `BLOCK_LABELS`, `BLOCK_COLORS` (keep `MODE_COLORS`, `resolveModeColor`). From `ring.ts` delete `RING_NAMES`. From `routine.ts` delete `ROUTINE_BLOCKS` and the `BLOCK_COLORS` import.
- [ ] **Step 2: `routine.ts`.** Change:
  - `ScheduleBlockData` gets `stream?: string | null`; `ScheduleMeta` gets `weekend_days: string[]`, and `lat`, `lon` become `number | null`; add `export const hasLocation = (m: ScheduleMeta) => m.lat != null && m.lon != null;`
  - `type RoutineBlock = string`; `ResolvedBlock` gets `stream: string | null`.
  - `dayTypeFor(date, tz, weekendDays)`: compute the weekday key with `new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(date).toLowerCase().slice(0, 3)` and return `"weekend"` when `weekendDays.includes(key)`.
  - `computePrayerMinutes(meta, date)` first line: `if (!hasLocation(meta)) throw new Error("set your location in Settings");` and use `meta.lat as number`, `meta.lon as number`.
  - `resolveDay(schedule, date, known: ReadonlySet<string>)`: use `dayTypeFor(date, meta.tz, meta.weekend_days)`; replace the `ROUTINE_BLOCKS` check with `if (known.size > 0 && !known.has(row.block)) throw new Error(\`unknown block '${row.block}'\`);` and push `stream: row.stream ?? null`.
  - Add:

```ts
/** The stream that owns the schedule's slot on `date`: the first row of that day type that names one. */
export function slotOwnerFor(schedule: VaultScheduleData, date: Date): string | null {
  const type = dayTypeFor(date, schedule.meta.tz, schedule.meta.weekend_days);
  const rows = schedule.days[type]?.length ? schedule.days[type] : schedule.days.weekday ?? [];
  return rows.find((r) => r.stream)?.stream ?? null;
}
```
- [ ] **Step 3: `streams.ts`.** Delete `otStreamFor`. Callers use `slotOwnerFor`.
- [ ] **Step 4: `ring.ts`.** `nameFits(b, r, charWidth)` becomes `nameFits(b, r, charWidth, name)` using `name.length`.
- [ ] **Step 5: Components.** Add `const blocks = useBlocks();` (import from `@/lib/blocks`) at the top of each component function and convert:
  - `routine-ring.tsx`, `fullscreen-clock.tsx`, `now-card.tsx`, `ring-graphic.tsx`: `ROUTINE_BLOCKS[x].label` -> `blocks.label(x)`; `ROUTINE_BLOCKS[x].color` -> `blocks.color(x)`; `RING_NAMES[x]` -> `blocks.ring(x)`; the `nameFits(...)` call passes `blocks.ring(b.block)`; the drop-shadow `${color}aa` becomes `drop-shadow(0 0 7px color-mix(in srgb, ${color} 67%, transparent))`.
  - `votes-panel.tsx`: `blocksForDay(today?.blocks).map((block) => ...)` -> `blocks.forDay(today?.blocks).map((b) => ...)` with `const block = b.key`; `BLOCK_LABELS[block]` -> `b.label`; `BLOCK_COLORS[block]` -> `blocks.color(b.key)`. Only blocks with `counts_for_stars` get buttons.
  - `block-cards.tsx`: same `forDay` conversion; background `color-mix(in srgb, ${color} 8%, var(--surface))` when stars > 0 (was `${color}14`).
  - `block-trends.tsx`, `footer-stats.tsx`: iterate `blocks.list.filter((b) => b.counts_for_stars)` (series values are keyed by block key; the existing "skip all-null" guards stay).
  - `plan-header.tsx`: the week strip receives the schedule: replace `otStreamFor(new Date(...), "UTC", streams)` with `const id = slotOwnerFor(schedule, new Date(\`${d}T12:00:00Z\`)); const owner = streams.find((s) => s.id === id);` and add a `schedule: VaultScheduleData | null` prop (the Plan page already loads the schedule or loads it: add `vaultApi.schedule()` to its loads); when `schedule` is null render no strip.
  - `app/(app)/page.tsx` (Overview): `slot` becomes `const slotId = schedule ? slotOwnerFor(schedule, now) : null;` and `ot={slotId ?? undefined}`; `ROUTINE_BLOCKS[block.block].label` -> `blocks.label(block.block)`; pass `new Set(blocks.list.map((b) => b.key))` to `resolveDay`; guard: when `schedule && !hasLocation(schedule.meta)` render a card instead of the clock:

```tsx
<div className="mx-auto max-w-xl rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
  <h2 className="font-serif text-xl">Set your location</h2>
  <p className="mt-2 text-sm text-[var(--muted-foreground)]">Prayer times anchor your clock. Add your city and calculation method in Settings.</p>
  <Link href="/settings" className="mt-4 inline-block rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-[var(--accent-fg)]">Open Settings</Link>
</div>
```
- [ ] **Step 6:** Run `../../node_modules/.bin/tsc --noEmit -p .` until clean, then `next build`. Commit `Read blocks, colours, ring names, weekend and slot owner from data`.

---

### Task 9: Web: Settings page

**Files:** Replace `src/app/(app)/settings/page.tsx`; create `src/components/settings/{location-section,blocks-section,schedule-section,feeds-section,appearance-section}.tsx`.

The page keeps one draft (`meta`, `blocks`, `weekday`, `weekend`) loaded from `vaultApi.blocksConfig()` and `vaultApi.schedule()`, shows a bottom bar with Save and Discard, and saves blocks first, then the schedule (`vaultApi.saveBlocks`, `vaultApi.saveSchedule`), then calls `blocks.reload()`. Feeds and theme act immediately. The design follows the approved mock (see the artifact and `niyyah-design` skill): hairline sections, 14px body, micro-labels, no card inside card.

- [ ] **Step 1: `page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { BlocksSection } from "@/components/settings/blocks-section";
import { FeedsSection } from "@/components/settings/feeds-section";
import { LocationSection } from "@/components/settings/location-section";
import { ScheduleSection } from "@/components/settings/schedule-section";
import { useBlocks } from "@/lib/blocks";
import { VaultScheduleData } from "@/lib/routine";
import { vaultApi } from "@/lib/vault-api";
import { BlockConfig, ScheduleMetaIn, ScheduleRowIn } from "@/lib/vault-types";

export interface Draft { meta: ScheduleMetaIn; blocks: BlockConfig[]; weekday: ScheduleRowIn[]; weekend: ScheduleRowIn[] }

const toRows = (rows: VaultScheduleData["days"][string] | undefined): ScheduleRowIn[] =>
  (rows ?? []).map((r) => ({ block: r.block, start: r.start, end: r.end, what: r.what, stream: r.stream ?? null }));

export default function SettingsPage() {
  const blocksCtx = useBlocks();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [streams, setStreams] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(async () => {
    const [cfg, sched, quarter] = await Promise.all([vaultApi.blocksConfig(), vaultApi.schedule(), vaultApi.quarter().catch(() => null)]);
    const next: Draft = {
      blocks: cfg.blocks,
      meta: { city: sched.meta.city, lat: sched.meta.lat, lon: sched.meta.lon, tz: sched.meta.tz, method: sched.meta.method.toLowerCase(),
        madhab: sched.meta.madhab.toLowerCase(), weekend_days: sched.meta.weekend_days },
      weekday: toRows(sched.days.weekday), weekend: toRows(sched.days.weekend),
    };
    setDraft(next);
    setSaved(JSON.stringify(next));
    setStreams((quarter?.streams ?? []).map((s) => ({ id: s.stream, label: s.name })));
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : "Could not load settings")); }, [load]);

  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== saved, [draft, saved]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await vaultApi.saveBlocks(draft.blocks);
      await vaultApi.saveSchedule({ meta: draft.meta, weekday: draft.weekday, weekend: draft.weekend });
      await blocksCtx.reload();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!draft) {
    return error ? <p className="text-sm text-[var(--destructive)]">{error}</p> : <div className="grid h-64 place-items-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" /></div>;
  }
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="mx-auto max-w-[68rem] pb-24">
      <h1 className="font-serif text-[1.6rem] leading-tight">Settings</h1>
      <p className="mb-5 mt-1 max-w-[62ch] text-sm text-[var(--muted-foreground)]">Where you are, the blocks of your day, the schedule on your clock and the calendars you read. Streams are edited on the Plan page.</p>
      <LocationSection meta={draft.meta} onChange={(meta) => set({ meta })} />
      <BlocksSection blocks={draft.blocks} onChange={(b) => set({ blocks: b })} />
      <ScheduleSection draft={draft} streams={streams} onChange={set} />
      <FeedsSection />
      <AppearanceSection />
      <div className="fixed inset-x-0 bottom-0 flex flex-wrap items-center justify-end gap-2.5 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <span role="status" className={`mr-auto text-sm ${error ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]"}`}>{error ?? (dirty ? "Unsaved changes" : "All changes saved")}</span>
        <button type="button" disabled={!dirty || busy} onClick={() => setDraft(JSON.parse(saved))} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold disabled:opacity-50">Discard</button>
        <button type="button" disabled={!dirty || busy} onClick={() => void save()} className="min-h-9 rounded-lg bg-[var(--accent)] px-3 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: shared section wrapper.** `src/components/settings/section.tsx`:

```tsx
export function SettingsSection({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="border-t border-[var(--border)] py-5 first:border-t-0 first:pt-0">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-[1.2rem]">{title}</h2>
        {aside && <span className="text-xs font-medium text-[var(--muted-foreground)]">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export const FIELD = "min-h-9 w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-sm";
export const MICRO = "text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-[var(--muted-foreground)]";
export const CHIP = "min-h-8 rounded-full border border-[var(--border)] px-3 text-xs font-semibold text-[var(--muted-foreground)] aria-pressed:border-[var(--foreground)] aria-pressed:bg-[var(--foreground)] aria-pressed:text-[var(--background)]";
```

- [ ] **Step 3: `location-section.tsx`**: city, latitude, longitude, time zone (text), method select (value keys `karachi, mwl, isna, egyptian, ummalqura, dubai, qatar, kuwait, singapore, turkey, tehran, moonsighting` with the display names from the mock), madhab select, and the weekend-day chips (`mon`..`sun`, toggling in `meta.weekend_days`). Numbers: `value={meta.lat ?? ""}` and `onChange` -> `e.target.value === "" ? null : Number(e.target.value)`.
- [ ] **Step 4: `blocks-section.tsx`**: for each non-archived block a row (up/down buttons that swap neighbours among active blocks, a colour dot that toggles a swatch row of the 12 colours, name input, ring-name input `maxLength={6}` upper-cased, "Stars" checkbox, Archive button); "Add block" appends `{ key: slug(label) unique, label: "New block", ring_name: "NEW", color: next colour, counts_for_stars: true, archived: false }` where the key is generated from a counter (`block-2`, `block-3`, ...) until the first save; archived blocks listed below with Restore. A block that is on the schedule shows its Archive button disabled with a title explaining why (the page passes the used keys). Colour swatches use `colorVar` from `@/lib/streams`.
- [ ] **Step 5: `schedule-section.tsx`**: weekday/weekend toggle chips; header row; rows with block select (active blocks plus the row's own archived block), start/end inputs (mono), "What" input, stream select (options: none, then `streams`), Remove button; Add row button; the live ring preview: reuse `resolveDay`-style math through a small local `previewArcs(rows, meta)` that needs prayer anchors, so use `computePrayerMinutes` when `hasLocation(meta)`, else fixed example anchors with a note "example prayer times until you set a location"; show overlap warnings from the same circular check as `findOverlaps` (export `findOverlaps` and `resolveTime` from `routine.ts` for this). Colours from `useBlocks().color` with a local fallback to the draft's block colour for blocks not saved yet (look up in `draft.blocks`).
- [ ] **Step 6: `feeds-section.tsx`**: loads `vaultApi.feeds()`, lists name + host + "••••••••", Remove button; an add form (name, `https://` address) with inline error text from the API; refreshes the list after each action.
- [ ] **Step 7: `appearance-section.tsx`**: three chips (system, light, dark) that `api.patch("/settings", { theme })`; `useTheme` already applies it on load, so also set `document.documentElement` through the existing `applyResolvedTheme` (export it from `hooks/use-theme.ts` if it is not exported).
- [ ] **Step 8:** `tsc` and `next build` clean. Commit `Rebuild the Settings page: location, blocks, schedule, calendars, appearance`.

---

### Task 10: Run it locally and look

The earlier phases never saw the pages rendered. This task does.

- [ ] **Step 1: Start the API in db mode** (SQLite, tables from the models):

```bash
cd apps/api
rm -f /tmp/niyyah-local.db
DATABASE_URL=sqlite+aiosqlite:////tmp/niyyah-local.db STORAGE_BACKEND=db SECRET_KEY=local-test CORS_ORIGINS=http://localhost:3100 \
  /tmp/niyyah-oss-venv/bin/python -c "
import asyncio
from app.core.database import Base, engine
import app.main
async def go():
    async with engine.begin() as c: await c.run_sync(Base.metadata.create_all)
asyncio.run(go())"
DATABASE_URL=sqlite+aiosqlite:////tmp/niyyah-local.db STORAGE_BACKEND=db SECRET_KEY=local-test CORS_ORIGINS=http://localhost:3100 \
  /tmp/niyyah-oss-venv/bin/uvicorn app.main:app --port 8100 &
```
- [ ] **Step 2: Start the web app** against it: `cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:8100 ../../node_modules/.bin/next dev -p 3100 &`.
- [ ] **Step 3: Drive it with the browser tools** (chrome-devtools or playwright): register `me@local.test`; confirm the Overview shows "Set your location"; open Settings, set Dhaka (23.81, 90.41, `Asia/Dhaka`, method `karachi`, madhab `hanafi`), Save; the Overview shows the clock with the starter blocks; vote on "Deep work"; add a block "Reading" (lime, Stars off) and put it on the weekday schedule, Save; archive a block that is on the schedule and read the refusal; add a calendar feed and confirm the list shows only the host. Take screenshots of Overview, Vault, Plan, Settings at 1440 and 390 wide, light and dark; fix anything visibly wrong (overflow, unreadable text, a leftover hard-coded name) and rerun `tsc`.
- [ ] **Step 4:** Stop both servers; delete `/tmp/niyyah-local.db`. Commit any fixes `Fix what the local run showed`.

---

### Task 11: Spec, docs and full verification

- [ ] **Step 1:** Update the spec: overlap warnings are client-side only; the final shapes of `/vault/config/*`; the six-block fixture note; mark phase 4 built. Add a short "Run it locally in db mode" section to `docs` (the recipe from Task 10) so open-source users can try it.
- [ ] **Step 2:** Full API suite alone, `tsc`, `next build` (all clean). Compare production behaviour: with `STORAGE_BACKEND=vault` run the pre-existing vault-mode tests (they are part of the suite) and confirm `GET /vault/config/blocks` and `GET /vault/schedule` return the owner's defaults.
- [ ] **Step 3:** Commit `Record phase 4 and how to run it locally`.

---

### Task 12: Deploy

CI does not run migrations, production stays on `vault`, and the new web build must work against a `vault`-mode API.

- [ ] **Step 1:** Merge `feature/settings-blocks` into `main` (fast-forward).
- [ ] **Step 2:** Back up the `niyyah` database (`pg_dump -Fc` through a port-forward to `shared-pg-rw` into `~/backups`, mode 600), then apply the migration (`alembic upgrade head` through a port-forward; it adds one table and one nullable column). Verify the revision is `f2b4d6a8c013`.
- [ ] **Step 3:** Push `main` with a minor tag. Watch both rollouts and the API log for errors.
- [ ] **Step 4:** Check the live Overview, Vault and Plan pages still render with the owner's block names and colours (vault mode serves the defaults), and that Settings opens (it shows the defaults read-only: saving answers 501 until the cutover). If the Settings page should be hidden in vault mode, say so to the owner rather than deciding silently.

---

## Self-review against the spec

- Blocks (one list, archive, never delete): Tasks 1, 2, 4. Stream per row and weekend days: Tasks 3, 8. Star ceiling: Task 4. Starter template and empty location: Tasks 1, 5, 8. Feeds API: Task 5. Settings page per the mock: Task 9. Vault-mode defaults and 501 writes: Tasks 2, 3, 5. Production safety: Task 12.
- Spec amendment: overlap warnings are client-side (stated in Global Constraints, recorded in Task 11).
- Type check: `list_blocks`, `replace_blocks`, `counted_keys`, `replace_schedule`, `seed_new_user`, `useBlocks().forDay/label/ring/color`, `slotOwnerFor`, `hasLocation` and `resolveDay(schedule, date, known)` are used with the same names and argument orders in every task.
