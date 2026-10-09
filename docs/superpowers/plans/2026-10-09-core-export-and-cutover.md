# Core export API, API tokens, goals editor and cutover (storage phase 5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Niyyah gets the generic pieces a separate mirror service needs (a versioned export of one user's data and read-only API tokens), plus the goals editor and a rehearsed cutover runbook. Nothing in this repo knows about Obsidian.

**Architecture:** `GET /api/v1/export` builds a JSON snapshot of one user's rows (`planner_export.build_snapshot`) and answers `304` when the `ETag` matches. It accepts either a normal login or an API token, and only this endpoint accepts a token (`deps.get_export_user`), so a leaked token can read one user's data and do nothing else. Tokens are random, shown once, stored as a SHA-256 hash, listed and revoked in Settings.

**Tech Stack:** FastAPI, SQLAlchemy 2 async, Alembic, pytest-asyncio; Next.js for Settings.

Spec: `docs/superpowers/specs/2026-10-09-cutover-and-obsidian-mirror-design.md`. This plan replaces `2026-10-09-cutover-and-obsidian-mirror.md` (its Task 1 is reused here as Task 1). The private `niyyah-obsidian` service gets its own plan in its own repo after this one is built.

## Global Constraints

- API in `/home/ubuntu/src/dark-knight/niyyah/apps/api`; tests `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (235 pass today; rebuild the venv from `requirements-dev.txt` if it is gone). **Never run two pytest processes at once.** Web checks: `../../node_modules/.bin/tsc --noEmit -p .` in `apps/web`, then `next build`.
- No Obsidian code, setting or table in this repo. The export format is generic and documented (`docs/export-format.md`).
- A token reaches `GET /api/v1/export` only. Raw tokens are never stored or logged; only `sha256(token)` and a display prefix.
- Export refuses (409) unless `STORAGE_BACKEND=db`. Feed addresses are secrets: the snapshot carries the host only.
- Branch `feature/obsidian-mirror`. Commit after each task, no AI attribution lines. Do not push or touch production until Task 6, which needs the owner's explicit go-ahead.
- Migrations are not run by CI; Task 6 lists the manual steps.

## File Structure

| File | Responsibility |
|---|---|
| `app/services/planner_config.py`, `app/schemas/vault.py`, `app/api/v1/vault.py`, web `settings/goals-section.tsx` | goals editor (Task 1) |
| `app/models/user.py`, `alembic/versions/b4d6f8a0c125_api_tokens.py` | `ApiToken` table |
| `app/services/api_tokens.py`, `app/api/v1/tokens.py`, `app/core/deps.py` | create, list, revoke, resolve tokens |
| `app/services/planner_export.py`, `app/api/v1/export.py` | snapshot and endpoint |
| `app/main.py` | register routers |
| web `lib/tokens-api.ts`, `settings/tokens-section.tsx`, `settings/page.tsx` | API tokens in Settings |
| `docs/export-format.md`, `docs/cutover-runbook.md`, `tests/test_cutover_rehearsal.py` | docs and rehearsal |
| `tests/test_goals_config.py`, `test_api_tokens.py`, `test_export_api.py` | tests |

---

### Task 1: Goals editor

**Files:** modify `app/services/planner_config.py`, `app/schemas/vault.py`, `app/api/v1/vault.py`, web files above. Test `tests/test_goals_config.py`.
**Interfaces:** Produces `planner_config.replace_goals(db, user_id, items: list[dict]) -> None`; `PUT /vault/config/goals` returning `GoalsResponse`; `vaultApi.saveGoals(items)`.

- [ ] **Step 1: Failing tests** `tests/test_goals_config.py`:

```python
import pytest

from app.core.config import settings

G = "/api/v1/vault/config/goals"
GOAL = {"title": "Zero debt", "value": "62% paid", "caption": "what it is for", "progress": 62}


@pytest.mark.asyncio
async def test_replace_and_read_back(db_client):
    client, _ = db_client
    res = await client.put(G, json={"items": [GOAL, {"title": "Life simple", "value": "Fewer things"}]})
    assert res.status_code == 200
    items = (await client.get("/api/v1/vault/goals")).json()["items"]
    assert [(g["title"], g["value"], g["caption"], g["progress"]) for g in items] == [
        ("Zero debt", "62% paid", "what it is for", 62), ("Life simple", "Fewer things", "", None)]
    assert (await client.put(G, json={"items": []})).json()["items"] == []


@pytest.mark.asyncio
async def test_goal_input_is_checked(db_client):
    client, _ = db_client
    for bad in [{**GOAL, "title": " "}, {**GOAL, "value": ""}, {**GOAL, "progress": 101}, {**GOAL, "progress": -1},
                {**GOAL, "title": "a|b"}, {**GOAL, "caption": "two\nlines"}, {**GOAL, "title": "x" * 61}]:
        assert (await client.put(G, json={"items": [bad]})).status_code == 422, bad
    assert (await client.put(G, json={"items": [GOAL] * 7})).status_code == 422


@pytest.mark.asyncio
async def test_goals_are_per_user(db_client):
    client, _ = db_client
    await client.put(G, json={"items": [GOAL]})
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await client.get("/api/v1/vault/goals", headers=other)).json()["items"] == []


@pytest.mark.asyncio
async def test_vault_mode_refuses(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    assert (await auth_client.put(G, json={"items": []})).status_code == 501
```

- [ ] **Step 2:** Run (fails: 404/405). **Step 3: Implement.** In `app/schemas/vault.py` append:

```python
class GoalIn(BaseModel):
    title: str
    value: str
    caption: str = ""
    progress: int | None = None


class GoalsIn(BaseModel):
    items: list[GoalIn]
```

In `planner_config.py` add (imports `Goal` from `app.models.planner`):

```python
MAX_GOALS = 6


def _goal_text(value: str, what: str, limit: int, required: bool) -> str:
    text = " ".join(value.split())
    if "|" in value:
        raise ValueError(f"the {what} cannot contain |")
    if required and not text:
        raise ValueError(f"a goal needs a {what}")
    if len(text) > limit:
        raise ValueError(f"the {what} is longer than {limit} characters")
    return text


async def replace_goals(db, user_id: int, items: list[dict]) -> None:
    if len(items) > MAX_GOALS:
        raise ValueError(f"at most {MAX_GOALS} goals")
    clean = []
    for g in items:
        if "\n" in g["caption"] or "\n" in g["title"] or "\n" in g["value"]:
            raise ValueError("a goal is one line")
        progress = g.get("progress")
        if progress is not None and not 0 <= progress <= 100:
            raise ValueError("progress is 0 to 100")
        clean.append({"title": _goal_text(g["title"], "title", 60, True), "value": _goal_text(g["value"], "value", 80, True),
                      "caption": _goal_text(g.get("caption") or "", "caption", 120, False), "progress": progress})
    await db.execute(delete(Goal).where(Goal.user_id == user_id))
    for position, g in enumerate(clean):
        db.add(Goal(user_id=user_id, position=position, **g))
    await db.flush()
```

In `vault.py` (imports `GoalsIn`) next to the other config endpoints (before `/edit-access`):

```python
@router.put("/config/goals", response_model=GoalsResponse)
async def put_goals_config(data: GoalsIn, user: User = Depends(require_planner_user), db: AsyncSession = Depends(get_db)):
    if not _db_mode():
        raise HTTPException(status_code=501, detail="Goals are edited in the vault until STORAGE_BACKEND=db")
    await _db_run(db, lambda: planner_config.replace_goals(db, user.id, [g.model_dump() for g in data.items]))
    return GoalsResponse(items=await planner_store.goals(db, user.id))
```

- [ ] **Step 4:** Web. In `vault-types.ts` add `export interface GoalIn { title: string; value: string; caption: string; progress: number | null }`; in `vault-api.ts` add `saveGoals: (items: GoalIn[]) => api.put<VaultGoalsData>("/vault/config/goals", { items })`. Add `goals: GoalIn[]` to `Draft` in `components/settings/types.ts`; in `settings/page.tsx` load `vaultApi.goals()` into the draft (`goals: g.items.map((x) => ({ title: x.title, value: x.value, caption: x.caption, progress: x.progress }))`), save with `await vaultApi.saveGoals(draft.goals)` after the schedule, and render `<GoalsSection goals={draft.goals} onChange={(goals) => set({ goals })} />` between Blocks and Schedule. Create `components/settings/goals-section.tsx`:

```tsx
"use client";

import { FIELD, SettingsSection } from "@/components/settings/section";
import { GoalIn } from "@/lib/vault-types";

const MAX = 6;

interface Props {
  goals: GoalIn[];
  onChange: (goals: GoalIn[]) => void;
}

/** The cards at the top of the Overview: a title, a value, an optional caption and an optional progress bar. */
export function GoalsSection({ goals, onChange }: Props) {
  const edit = (i: number, patch: Partial<GoalIn>) => onChange(goals.map((g, n) => (n === i ? { ...g, ...patch } : g)));
  return (
    <SettingsSection id="goals" title="Goals" aside={`${goals.length} of ${MAX}`}>
      {goals.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No goals yet. They show at the top of the Overview.</p>}
      {goals.map((g, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-[var(--border)] py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_5rem_auto]">
          <input className={FIELD} aria-label="Goal title" placeholder="Title, e.g. Zero debt" maxLength={60} value={g.title} onChange={(e) => edit(i, { title: e.target.value })} />
          <input className={FIELD} aria-label="Goal value" placeholder="Value, e.g. 62% paid" maxLength={80} value={g.value} onChange={(e) => edit(i, { value: e.target.value })} />
          <input className={`${FIELD} col-span-2 sm:col-span-1`} aria-label="Goal caption" placeholder="Caption (optional)" maxLength={120} value={g.caption} onChange={(e) => edit(i, { caption: e.target.value })} />
          <input className={`${FIELD} font-mono`} type="number" min={0} max={100} aria-label="Goal progress" placeholder="0-100" value={g.progress ?? ""} onChange={(e) => edit(i, { progress: e.target.value === "" ? null : Number(e.target.value) })} />
          <button type="button" onClick={() => onChange(goals.filter((_, n) => n !== i))} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Remove</button>
        </div>
      ))}
      <button type="button" disabled={goals.length >= MAX} onClick={() => onChange([...goals, { title: "", value: "", caption: "", progress: null }])}
        className="mt-2 min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Add goal</button>
    </SettingsSection>
  );
}
```

- [ ] **Step 5:** Run `tests/test_goals_config.py`, `tsc`. Commit `Edit goals in the app`.

---


---

### Task 2: API tokens

**Files:** modify `app/models/user.py`, `app/core/deps.py`, `app/main.py`; create `alembic/versions/b4d6f8a0c125_api_tokens.py`, `app/services/api_tokens.py`, `app/api/v1/tokens.py`. Test `tests/test_api_tokens.py`.
**Interfaces:** Produces `ApiToken(id, user_id, name, prefix, token_hash, created_at, last_used_at, revoked_at)`; `api_tokens.create(db, user_id, name) -> tuple[ApiToken, str]`, `list_active(db, user_id) -> list[ApiToken]`, `revoke(db, user_id, token_id) -> bool`, `user_for_token(db, raw) -> User | None`, constants `PREFIX = "nyt_"`, `MAX_TOKENS = 10`; dependency `deps.get_export_user`; endpoints `POST/GET /api/v1/tokens`, `DELETE /api/v1/tokens/{id}`.

- [ ] **Step 1: Failing tests** `tests/test_api_tokens.py`:

```python
import pytest
from sqlalchemy import select

from app.models.user import ApiToken
from tests.conftest import TestSession

T = "/api/v1/tokens"


@pytest.mark.asyncio
async def test_create_list_and_revoke(auth_client):
    res = await auth_client.post(T, json={"name": "  mirror  "})
    assert res.status_code == 201
    made = res.json()
    assert made["name"] == "mirror" and made["token"].startswith("nyt_") and len(made["token"]) > 30
    listed = (await auth_client.get(T)).json()
    assert [t["name"] for t in listed] == ["mirror"]
    assert "token" not in listed[0] and listed[0]["prefix"] == made["token"][:8]
    assert (await auth_client.delete(f"{T}/{made['id']}")).status_code == 204
    assert (await auth_client.get(T)).json() == []
    assert (await auth_client.delete(f"{T}/{made['id']}")).status_code == 404


@pytest.mark.asyncio
async def test_only_a_hash_is_stored(auth_client):
    raw = (await auth_client.post(T, json={"name": "mirror"})).json()["token"]
    async with TestSession() as db:
        row = (await db.execute(select(ApiToken))).scalar_one()
    assert row.token_hash != raw and len(row.token_hash) == 64
    assert raw not in {str(getattr(row, c.name)) for c in ApiToken.__table__.columns}


@pytest.mark.asyncio
async def test_name_and_count_are_checked(auth_client):
    for bad in ["", "   ", "x" * 81]:
        assert (await auth_client.post(T, json={"name": bad})).status_code == 422, bad
    for i in range(10):
        assert (await auth_client.post(T, json={"name": f"t{i}"})).status_code == 201
    assert (await auth_client.post(T, json={"name": "eleventh"})).status_code == 422


@pytest.mark.asyncio
async def test_tokens_are_private_to_their_owner(auth_client):
    mine = (await auth_client.post(T, json={"name": "mine"})).json()
    await auth_client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await auth_client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await auth_client.get(T, headers=other)).json() == []
    assert (await auth_client.delete(f"{T}/{mine['id']}", headers=other)).status_code == 404


@pytest.mark.asyncio
async def test_a_token_cannot_manage_tokens(auth_client):
    raw = (await auth_client.post(T, json={"name": "mirror"})).json()["token"]
    as_token = {"Authorization": f"Bearer {raw}"}
    assert (await auth_client.get(T, headers=as_token)).status_code == 401
    assert (await auth_client.post(T, json={"name": "more"}, headers=as_token)).status_code == 401
    assert (await auth_client.get("/api/v1/auth/me", headers=as_token)).status_code == 401
```

- [ ] **Step 2:** Run `pytest tests/test_api_tokens.py -q` (fails: `ImportError ApiToken`).
- [ ] **Step 3: Implement.** In `app/models/user.py` add after `RefreshToken` (extend the `datetime` import line if needed; `String`, `DateTime`, `Integer`, `ForeignKey` are already imported):

```python
class ApiToken(Base):
    """A long-lived, read-only credential for one user's export. Only the hash is stored; the raw value is shown once."""
    __tablename__ = "api_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    prefix: Mapped[str] = mapped_column(String(12), nullable=False)  # first characters, to tell tokens apart
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

Migration `alembic/versions/b4d6f8a0c125_api_tokens.py`:

```python
"""api tokens

Revision ID: b4d6f8a0c125
Revises: f2b4d6a8c013
Create Date: 2026-10-09 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b4d6f8a0c125"
down_revision: Union[str, None] = "f2b4d6a8c013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "api_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("prefix", sa.String(12), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_api_tokens_user_id", "api_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_table("api_tokens")
```

`app/services/api_tokens.py`:

```python
"""Read-only API tokens. The raw value is returned once, at creation; afterwards only its SHA-256 is known."""
import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_token
from app.models.user import ApiToken, User

PREFIX = "nyt_"
MAX_TOKENS = 10


async def list_active(db: AsyncSession, user_id: int) -> list[ApiToken]:
    rows = await db.execute(select(ApiToken).where(ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None)).order_by(ApiToken.id))
    return list(rows.scalars().all())


async def create(db: AsyncSession, user_id: int, name: str) -> tuple[ApiToken, str]:
    name = " ".join(name.split())
    if not 1 <= len(name) <= 80:
        raise ValueError("a token needs a name of 1 to 80 characters")
    if len(await list_active(db, user_id)) >= MAX_TOKENS:
        raise ValueError(f"at most {MAX_TOKENS} tokens; revoke one first")
    raw = PREFIX + secrets.token_urlsafe(32)
    row = ApiToken(user_id=user_id, name=name, prefix=raw[:8], token_hash=hash_token(raw))
    db.add(row)
    await db.flush()
    return row, raw


async def revoke(db: AsyncSession, user_id: int, token_id: int) -> bool:
    row = (await db.execute(select(ApiToken).where(
        ApiToken.id == token_id, ApiToken.user_id == user_id, ApiToken.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        return False
    row.revoked_at = datetime.now(timezone.utc)
    return True


async def user_for_token(db: AsyncSession, raw: str) -> User | None:
    """The owner of a live token, or None. Records the use."""
    row = (await db.execute(select(ApiToken).where(
        ApiToken.token_hash == hash_token(raw), ApiToken.revoked_at.is_(None)))).scalar_one_or_none()
    if row is None:
        return None
    row.last_used_at = datetime.now(timezone.utc)
    user = (await db.execute(select(User).where(User.id == row.user_id, User.is_active.is_(True)))).scalar_one_or_none()
    await db.commit()
    return user
```

`app/api/v1/tokens.py`:

```python
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services import api_tokens

router = APIRouter(prefix="/tokens", tags=["tokens"])


class TokenIn(BaseModel):
    name: str


class TokenOut(BaseModel):
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None = None

    model_config = {"from_attributes": True}


class TokenCreated(TokenOut):
    token: str  # shown once


# These endpoints use get_current_user, which only understands a login: a token can never mint or list tokens.
@router.get("", response_model=list[TokenOut])
async def list_tokens(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await api_tokens.list_active(db, user.id)


@router.post("", response_model=TokenCreated, status_code=201)
async def create_token(data: TokenIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        row, raw = await api_tokens.create(db, user.id, data.name)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=422, detail=str(exc))
    await db.commit()
    return TokenCreated(id=row.id, name=row.name, prefix=row.prefix, created_at=row.created_at, last_used_at=None, token=raw)


@router.delete("/{token_id}", status_code=204)
async def revoke_token(token_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not await api_tokens.revoke(db, user.id, token_id):
        raise HTTPException(status_code=404, detail="no such token")
    await db.commit()
```

In `app/core/deps.py` add the import `from app.services import api_tokens` and at the end:

```python
async def get_export_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """A login or an API token. Only the export endpoint uses this; every other endpoint accepts logins only."""
    if credentials.credentials.startswith(api_tokens.PREFIX):
        user = await api_tokens.user_for_token(db, credentials.credentials)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        return user
    return await get_current_user(credentials, db)
```

In `app/main.py` import `tokens` with the other routers and add `app.include_router(tokens.router, prefix="/api/v1")`.

- [ ] **Step 4:** Run `pytest tests/test_api_tokens.py -q` (pass), then the full suite. **Step 5:** Commit `Add read-only API tokens`.

---

### Task 3: The export snapshot

**Files:** create `app/services/planner_export.py`, `app/api/v1/export.py`; modify `app/main.py`. Test `tests/test_export_api.py`.
**Interfaces:** Consumes `deps.get_export_user`, `api_tokens`. Produces `planner_export.FORMAT_VERSION = 1`, `build_snapshot(db, user) -> dict`, `etag_for(snapshot) -> str`, `GET /api/v1/export` (200 with `ETag`, 304 on `If-None-Match`, 409 unless db mode).

- [ ] **Step 1: Failing tests** `tests/test_export_api.py`:

```python
import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models.planner import PlannerCalendarFeed
from app.models.vault import VaultDay
from tests.conftest import TestSession

E = "/api/v1/export"
SECTIONS = ("blocks", "schedule", "feeds", "goals", "quarters", "week_objectives", "pipeline_items", "notebook_entries", "days", "tasks")


async def _token(client) -> str:
    return (await client.post("/api/v1/tokens", json={"name": "mirror"})).json()["token"]


@pytest.mark.asyncio
async def test_snapshot_carries_the_users_data(db_client):
    client, _ = db_client
    await client.put("/api/v1/vault/config/goals", json={"items": [{"title": "Zero debt", "value": "62% paid", "progress": 62}]})
    snap = (await client.get(E)).json()
    assert snap["version"] == 1 and snap["user"] == {"email": "test@niyyah.app", "timezone": "UTC"}
    assert all(key in snap for key in SECTIONS)
    assert snap["goals"] == [{"title": "Zero debt", "value": "62% paid", "caption": "", "progress": 62}]
    async with TestSession() as db:
        days = (await db.execute(select(func.count()).select_from(VaultDay).where(VaultDay.user_id.is_not(None)))).scalar_one()
    assert days > 0 and len(snap["days"]) == days
    day = snap["days"][0]
    assert {"date", "mode", "possible", "total", "focus", "votes", "log"} <= day.keys() and isinstance(day["votes"], dict)
    assert snap["quarters"] and snap["quarters"][0]["streams"]
    assert snap["schedule"]["days"]["weekday"]


@pytest.mark.asyncio
async def test_feed_addresses_never_leave(db_client):
    client, _ = db_client
    async with TestSession() as db:
        db.add(PlannerCalendarFeed(user_id=1, name="Family", url="https://cal.example.com/private/SECRETPART.ics", position=0))
        await db.commit()
    res = await client.get(E)
    assert res.json()["feeds"] == [{"name": "Family", "host": "cal.example.com", "color": None, "email": None}]
    assert "SECRETPART" not in res.text


@pytest.mark.asyncio
async def test_etag_answers_304_until_something_changes(db_client):
    client, _ = db_client
    first = await client.get(E)
    tag = first.headers["etag"]
    same = await client.get(E, headers={"If-None-Match": tag})
    assert same.status_code == 304 and same.content == b""
    await client.put("/api/v1/vault/config/goals", json={"items": [{"title": "New", "value": "goal"}]})
    changed = await client.get(E, headers={"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["etag"] != tag


@pytest.mark.asyncio
async def test_a_token_reads_the_export_and_nothing_else(db_client):
    client, _ = db_client
    as_token = {"Authorization": f"Bearer {await _token(client)}"}
    assert (await client.get(E, headers=as_token)).status_code == 200
    for url in ("/api/v1/vault/goals", "/api/v1/vault/today", "/api/v1/auth/me", "/api/v1/tokens"):
        assert (await client.get(url, headers=as_token)).status_code == 401, url
    assert (await client.put("/api/v1/vault/config/goals", json={"items": []}, headers=as_token)).status_code == 401


@pytest.mark.asyncio
async def test_a_revoked_token_stops_working(db_client):
    client, _ = db_client
    made = (await client.post("/api/v1/tokens", json={"name": "mirror"})).json()
    as_token = {"Authorization": f"Bearer {made['token']}"}
    assert (await client.get(E, headers=as_token)).status_code == 200
    await client.delete(f"/api/v1/tokens/{made['id']}")
    assert (await client.get(E, headers=as_token)).status_code == 401
    assert (await client.get(E, headers={"Authorization": "Bearer nyt_" + "x" * 43})).status_code == 401


@pytest.mark.asyncio
async def test_a_token_exports_its_own_user_only(db_client):
    client, _ = db_client
    await client.post("/api/v1/auth/register", json={"email": "o@niyyah.app", "password": "otherpass123"})
    login = await client.post("/api/v1/auth/login", json={"email": "o@niyyah.app", "password": "otherpass123"})
    other = {"Authorization": f"Bearer {login.json()['access_token']}"}
    raw = (await client.post("/api/v1/tokens", json={"name": "theirs"}, headers=other)).json()["token"]
    snap = (await client.get(E, headers={"Authorization": f"Bearer {raw}"})).json()
    assert snap["user"]["email"] == "o@niyyah.app"
    assert snap["days"] == [] and snap["tasks"] == [] and snap["goals"] == []


@pytest.mark.asyncio
async def test_export_needs_db_mode_and_a_login(auth_client, monkeypatch):
    monkeypatch.setattr(settings, "storage_backend", "vault")
    assert (await auth_client.get(E)).status_code == 409
    monkeypatch.setattr(settings, "storage_backend", "db")
    assert (await auth_client.get(E)).status_code == 200
    del auth_client.headers["Authorization"]
    assert (await auth_client.get(E)).status_code in (401, 403)
```

- [ ] **Step 2:** Run (fails: 404). **Step 3: Implement.** `app/services/planner_export.py`:

```python
"""A versioned JSON snapshot of one user's planner data: the contract between Niyyah and anything that mirrors or backs it up.

Documented in docs/export-format.md. Calendar feed addresses are secrets, so only the host is exported.
"""
import hashlib
import json
from datetime import date
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerBlock, PlannerCalendarFeed, PlannerScheduleBlock, PlannerScheduleSetting,
    Quarter, QuarterStream, Task, WeekObjective,
)
from app.models.user import User
from app.models.vault import VaultDay

FORMAT_VERSION = 1


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


async def _rows(db: AsyncSession, model, *order):
    return list((await db.execute(select(model).where(model.user_id == _rows.uid).order_by(*order))).scalars().all())


async def build_snapshot(db: AsyncSession, user: User) -> dict:
    uid = user.id

    async def rows(model, *order):
        return list((await db.execute(select(model).where(model.user_id == uid).order_by(*order))).scalars().all())

    quarters: dict[str, dict] = {}
    for q in await rows(Quarter, Quarter.label):
        quarters[q.label] = {"label": q.label, "starts": _iso(q.starts), "ends": _iso(q.ends), "objective": q.objective,
                             "objective_ar": q.objective_ar, "streams": []}
    for s in await rows(QuarterStream, QuarterStream.quarter, QuarterStream.position):
        quarters.setdefault(s.quarter, {"label": s.quarter, "starts": None, "ends": None, "objective": "", "objective_ar": "", "streams": []})
        quarters[s.quarter]["streams"].append({
            "slug": s.slug, "name": s.name, "color": s.color, "icon": s.icon, "slot": s.slot, "weekly": s.weekly,
            "has_pipeline": s.has_pipeline, "in_note": s.in_note, "goal": s.goal, "status": s.status,
            "checkpoints": list(s.checkpoints or [])})

    setting = (await db.execute(select(PlannerScheduleSetting).where(PlannerScheduleSetting.user_id == uid))).scalar_one_or_none()
    schedule = None
    if setting is not None:
        schedule = {"meta": dict(setting.meta), "days": {}}
        for r in await rows(PlannerScheduleBlock, PlannerScheduleBlock.position):
            schedule["days"].setdefault(r.day_type, []).append({"block": r.block, "start": r.start, "end": r.end, "what": r.what, "stream": r.stream})

    log: dict[date, list[str]] = {}
    for e in await rows(LogEntry, LogEntry.day, LogEntry.position):
        log.setdefault(e.day, []).append(e.text)
    day_rows = (await db.execute(select(VaultDay).options(selectinload(VaultDay.block_votes))
                                 .where(VaultDay.user_id == uid).order_by(VaultDay.date))).scalars().all()
    days = [{"date": d.date.isoformat(), "mode": d.mode, "possible": d.possible, "total": d.total, "focus": d.focus,
             "votes": {v.block: v.stars for v in sorted(d.block_votes, key=lambda v: v.block)}, "log": log.get(d.date, [])}
            for d in day_rows]

    return {
        "version": FORMAT_VERSION,
        "user": {"email": user.email, "timezone": user.timezone},
        "blocks": [{"key": b.key, "label": b.label, "ring_name": b.ring_name, "color": b.color,
                    "counts_for_stars": b.counts_for_stars, "archived": b.archived} for b in await rows(PlannerBlock, PlannerBlock.position)],
        "schedule": schedule,
        "feeds": [{"name": f.name, "host": urlparse(f.url).hostname or "", "color": f.color, "email": f.email}
                  for f in await rows(PlannerCalendarFeed, PlannerCalendarFeed.position)],
        "goals": [{"title": g.title, "value": g.value, "caption": g.caption, "progress": g.progress}
                  for g in await rows(Goal, Goal.position)],
        "quarters": list(quarters.values()),
        "week_objectives": [{"week": o.week, "stream": o.stream, "text": o.text, "done": o.done, "checkpoint": o.checkpoint}
                            for o in await rows(WeekObjective, WeekObjective.week, WeekObjective.stream)],
        "pipeline_items": [{"id": p.id, "stream": p.stream, "lane": p.lane, "text": p.text, "description": p.description,
                            "product": p.product, "checkpoint": p.checkpoint, "added_on": _iso(p.added_on), "done_on": _iso(p.done_on),
                            "focus_week": p.focus_week, "done": p.done, "blocked_by": list(p.blocked_by or [])}
                           for p in await rows(PipelineItem, PipelineItem.stream, PipelineItem.position)],
        "notebook_entries": [{"stream": n.stream, "id": n.ext_id, "kind": n.kind, "title": n.title, "body": n.body,
                              "date": n.entry_date, "open": n.is_open}
                             for n in await rows(NotebookEntry, NotebookEntry.stream, NotebookEntry.position)],
        "days": days,
        "tasks": [{"id": t.id, "text": t.text, "done": t.done, "due_on": _iso(t.due_on), "scheduled_on": _iso(t.scheduled_on),
                   "start_on": _iso(t.start_on), "done_on": _iso(t.done_on), "source_path": t.source_path}
                  for t in await rows(Task, Task.id)],
    }


def etag_for(snapshot: dict) -> str:
    body = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return '"' + hashlib.sha256(body.encode()).hexdigest()[:32] + '"'
```

Delete the unused module-level `_rows` helper shown above before `build_snapshot` (only the inner `rows` closure is used).

`app/api/v1/export.py`:

```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_export_user
from app.models.user import User
from app.services import planner_export

router = APIRouter(prefix="/export", tags=["export"])


@router.get("")
async def export(request: Request, user: User = Depends(get_export_user), db: AsyncSession = Depends(get_db)):
    """Everything one user has in Niyyah, as JSON (see docs/export-format.md). Send If-None-Match to poll cheaply."""
    if settings.storage_backend != "db":
        raise HTTPException(status_code=409, detail="Export needs STORAGE_BACKEND=db")
    snapshot = await planner_export.build_snapshot(db, user)
    tag = planner_export.etag_for(snapshot)
    headers = {"ETag": tag, "Cache-Control": "private, no-cache"}
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers=headers)
    return JSONResponse(snapshot, headers=headers)
```

Register in `app/main.py` (`export` imported with the routers, `app.include_router(export.router, prefix="/api/v1")`).

- [ ] **Step 4:** Run `pytest tests/test_export_api.py -q`; fix mismatches against the real fixture (for example a field the fixture leaves empty), never by loosening what a test asserts about secrets, scoping or ETag. Run the full suite. **Step 5:** Commit `Export one user's data as a versioned snapshot`.

---

### Task 4: API tokens in Settings

**Files:** create `apps/web/src/lib/tokens-api.ts`, `apps/web/src/components/settings/tokens-section.tsx`; modify `apps/web/src/lib/vault-types.ts`, `apps/web/src/app/(app)/settings/page.tsx`.
**Interfaces:** Consumes `POST/GET/DELETE /tokens`. Produces `tokensApi.list/create/revoke`, `<TokensSection />`.

- [ ] **Step 1:** Append to `lib/vault-types.ts`:

```ts
export interface ApiTokenData { id: number; name: string; prefix: string; created_at: string; last_used_at: string | null }
export interface NewApiToken extends ApiTokenData { token: string }
```

`lib/tokens-api.ts`:

```ts
import { api } from "@/lib/api-client";
import { ApiTokenData, NewApiToken } from "@/lib/vault-types";

export const tokensApi = {
  list: () => api.get<ApiTokenData[]>("/tokens"),
  create: (name: string) => api.post<NewApiToken>("/tokens", { name }),
  revoke: (id: number) => api.delete(`/tokens/${id}`),
};
```

- [ ] **Step 2:** `components/settings/tokens-section.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { FIELD, SettingsSection } from "@/components/settings/section";
import { tokensApi } from "@/lib/tokens-api";
import { ApiTokenData } from "@/lib/vault-types";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "never");

/** Read-only tokens for tools that mirror or back up your data through GET /api/v1/export. A token can read the export and nothing else. */
export function TokensSection() {
  const [tokens, setTokens] = useState<ApiTokenData[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => tokensApi.list().then(setTokens).catch(() => setTokens([])), []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const made = await tokensApi.create(name);
      setFresh(made.token);
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setError(null);
    try {
      await tokensApi.revoke(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke the token");
    }
  }

  return (
    <SettingsSection id="tokens" title="API tokens" aside="Read-only, for tools that copy your data out">
      {tokens && tokens.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No tokens yet.</p>}
      <ul>
        {(tokens ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-3 border-t border-[var(--border)] py-2 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.name}</p>
              <p className="truncate font-mono text-xs text-[var(--muted-foreground)]">{t.prefix}•••• · last used {when(t.last_used_at)}</p>
            </div>
            <button type="button" onClick={() => void revoke(t.id)} className="min-h-8 rounded-lg px-2 text-xs font-semibold text-[var(--destructive)] hover:bg-[var(--muted)]">Revoke</button>
          </li>
        ))}
      </ul>
      {fresh && (
        <div role="status" className="mt-2 rounded-lg bg-[var(--muted)] px-3 py-2">
          <p className="text-xs font-semibold">Copy this token now. It is not shown again.</p>
          <p className="mt-1 break-all font-mono text-xs">{fresh}</p>
          <button type="button" onClick={() => setFresh(null)} className="mt-1.5 min-h-8 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold">I have copied it</button>
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Name, e.g. Vault mirror" aria-label="Token name" />
        <button type="button" disabled={busy || !name.trim()} onClick={() => void create()} className="min-h-9 rounded-lg border border-[var(--border)] px-3 text-xs font-semibold hover:bg-[var(--muted)] disabled:opacity-50">Create token</button>
      </div>
      {error && <p role="alert" className="mt-1.5 text-xs text-[var(--destructive)]">{error}</p>}
      <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">A token can read your export (<span className="font-mono">GET /api/v1/export</span>) and nothing else. Revoke it and it stops at once.</p>
    </SettingsSection>
  );
}
```

- [ ] **Step 3:** In `settings/page.tsx` import `TokensSection` and render `<TokensSection />` after `<FeedsSection />`. Update the intro line to end "Streams are edited on the Plan page." (unchanged). **Step 4:** `tsc --noEmit` and `next build` in `apps/web`. Commit `Create and revoke API tokens in Settings`.

---

### Task 5: Export format doc, rehearsal and runbook

**Files:** create `docs/export-format.md`, `docs/cutover-runbook.md`, `tests/test_cutover_rehearsal.py`.

- [ ] **Step 1: Failing test** `tests/test_cutover_rehearsal.py` (the cutover in miniature: a vault becomes a db account that exports):

```python
import pytest

from app.core.config import settings


@pytest.mark.asyncio
async def test_imported_vault_exports_in_db_mode(db_client):
    client, today = db_client
    snap = (await client.get("/api/v1/export")).json()
    assert snap["days"] and snap["quarters"] and snap["schedule"]
    assert any(day["date"] == today.isoformat() for day in snap["days"])
    today_api = (await client.get("/api/v1/vault/today")).json()
    exported = next(d for d in snap["days"] if d["date"] == today.isoformat())
    assert exported["mode"] == today_api["mode"] and exported["total"] == today_api["total"]


@pytest.mark.asyncio
async def test_rolling_back_to_vault_mode_stops_the_export(db_client, monkeypatch):
    client, _ = db_client
    monkeypatch.setattr(settings, "storage_backend", "vault")
    assert (await client.get("/api/v1/export")).status_code == 409
```

- [ ] **Step 2:** Run and fix. **Step 3:** Write `docs/export-format.md`: the version, every top-level section with its fields exactly as built in `planner_export.build_snapshot`, the `ETag`/304 behaviour, the token header, and the note that feed addresses are never exported. Write `docs/cutover-runbook.md` with these numbered steps, each with its check: (1) back up `pg_dump` to `~/backups` mode 600; (2) ask the owner to stop editing the vault; (3) run `python -m app.cli import-vault` for the owner's account against a fresh vault checkout and read the report; (4) apply the migration (`alembic upgrade head`) before the code push; (5) set `STORAGE_BACKEND=db`, restart both deployments; (6) compare Overview, Vault and Plan with the vault-mode screens; (7) create an API token in Settings and hand it to the mirror service; (8) rollback = `STORAGE_BACKEND=vault` and restart (the vault is never written to by this cutover).
- [ ] **Step 4:** Commit `Document the export format and the cutover`.

---

### Task 6: Run the cutover (needs the owner's explicit go-ahead)

Do not start without the owner's yes in the conversation. It touches production data and configuration, and the mirror service should exist first so the owner keeps their vault current.

- [ ] **Step 1:** Merge `feature/obsidian-mirror` into `main`, back up, apply migration `b4d6f8a0c125`, push with a minor tag, wait for both rollouts (production is still `vault` mode).
- [ ] **Step 2:** Follow `docs/cutover-runbook.md` with the owner present; report each step before the next; roll back at any mismatch.
- [ ] **Step 3:** Record the date in the spec so the soak for phase 5b starts, and update the memory note.

---

## Self-review against the spec

- Goals editor: Task 1. Tokens (hashed, read-only, scoped to export only, revocable, listed in Settings): Tasks 2 and 4. Export (versioned, ETag, secrets withheld, db mode only): Task 3. Docs, rehearsal, runbook, cutover: Tasks 5 and 6. The private service and phase 5b are separate plans by design.
- Names used across tasks: `ApiToken`, `api_tokens.create/list_active/revoke/user_for_token`, `get_export_user`, `planner_export.build_snapshot/etag_for/FORMAT_VERSION`, `tokensApi`, `TokensSection`.
