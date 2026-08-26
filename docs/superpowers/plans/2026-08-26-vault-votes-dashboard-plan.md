# Vault Votes Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DB-backed Votes dashboard at `/vault` in the existing Niyyah web app, synced from the xarvis Obsidian vault's daily notes via git (GitLab primary, GitHub fallback), styled in a Datadog-style light+dark theme, without touching any existing Niyyah feature.

**Architecture:** New SQLAlchemy models (`VaultDay`, `VaultBlockVote`) store parsed vote data. A sync service clones/pulls the xarvis vault's git history into a local working copy, parses `Calendar/Daily/*.md` files (Obsidian callout checkboxes, with alias normalization for legacy block names and a hardcoded per-mode ceiling table), and upserts into Postgres. A new FastAPI router exposes read endpoints (today/week/month/blocks/streaks) plus two sync triggers (authenticated manual, GitLab-webhook-secret). The Next.js app gains a new `/vault` page built from six presentational components, plus app-wide dark-theme CSS tokens wired to the existing (currently inert) theme setting.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + Alembic + Postgres (existing niyyah-api), pytest + pytest-asyncio + httpx (existing test stack), Next.js 16 + React 19 + Tailwind 4 (existing web app, no new frontend dependencies).

**Design spec:** `docs/superpowers/specs/2026-08-26-vault-votes-dashboard-design.md` — read this first for the full rationale; this plan implements it task-by-task.

## Global Constraints

- **Nothing existing is deleted or rewritten.** Every task only adds new files or makes additive edits (new import line, new secret keys, new nav entry) to existing files.
- Backend: follow existing patterns exactly — `Mapped`/`mapped_column` SQLAlchemy 2.0 style (`app/models/tracker.py`), async router pattern with `Depends(get_current_user)` / `Depends(get_db)` (`app/api/v1/tracker.py`), pydantic schemas with `model_config = {"from_attributes": True}` where returning ORM rows.
- Backend tests: pytest + pytest-asyncio, `asyncio_mode = auto` (from `apps/api/pytest.ini`), sqlite+aiosqlite for the shared `apps/api/tests/conftest.py` fixtures (`client`, `auth_client`, `setup_db` autouse). Standalone unit tests that don't need the full app (models, parser, sync) use their own throwaway `sqlite+aiosqlite:///:memory:` engine instead of the shared fixtures.
- Frontend: **no test framework exists in `apps/web`** (verified — no jest/vitest config, no `*.test.*` files, no `test` script in `package.json`). Do not add one. Frontend task cycles are: implement → `npx tsc --noEmit` (no type errors) → manual verification in the browser (`npm run dev`, check `/vault` in both light and dark, per Task 7's theme toggle).
- Frontend styling: no chart library, no new npm dependencies. Pure CSS (flexbox bars, circle grids, inline sparkline bars) and Tailwind utility classes against the existing CSS-variable tokens in `globals.css`. Font stays Manrope for prose/labels; use Tailwind's built-in `font-mono` utility for stat numbers (no new font import — the existing `layout.tsx` comment notes Google Fonts can't be fetched from the CI build network, so self-hosted-or-system-stack only).
- Git commits: one local `git commit` at the end of each task (per this skill's convention). Do **not** `git push` after every task — this is a multi-task feature landing as one coherent increment. Push + create the semver tag only after Task 12 (the final task), per the user's standing workflow preference. Never push/tag mid-feature with partially-wired migrations or routers.
- K8s: this repo's GitLab CI only rebuilds images and does `kubectl rollout restart` — it does **not** `kubectl apply -f k8s/` or run migrations automatically. Task 12 requires manually running `kubectl apply --dry-run=client -f k8s/niyyah.yaml` then the real apply, and manually re-running `k8s/migration-job.yaml` after the new image is live. `niyyah` is a protected prod namespace (per `AGENT.md`) — no destructive commands without confirmation.

---

## Task 1: Vault DB Models

**Files:**
- Create: `apps/api/app/models/vault.py`
- Test: `apps/api/tests/test_vault_models.py`

**Interfaces:**
- Produces: `VaultDay` (fields: `id`, `date`, `mode`, `possible`, `total`, `focus`, `log`, `synced_at`, relationship `block_votes`), `VaultBlockVote` (fields: `id`, `vault_day_id`, `block`, `stars`, relationship `day`). Both importable from `app.models.vault`.

- [ ] **Step 1: Write the failing test**

```python
# apps/api/tests/test_vault_models.py
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.vault import VaultBlockVote, VaultDay


@pytest.mark.asyncio
async def test_vault_day_and_block_vote_roundtrip():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        day = VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=2)
        session.add(day)
        await session.commit()
        await session.refresh(day)

        vote = VaultBlockVote(vault_day_id=day.id, block="soul", stars=2)
        session.add(vote)
        await session.commit()
        await session.refresh(vote)

        assert vote.id is not None
        assert vote.stars == 2

    await engine.dispose()


@pytest.mark.asyncio
async def test_vault_day_date_is_unique():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        session.add(VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=0))
        await session.commit()

        session.add(VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=5))
        with pytest.raises(IntegrityError):
            await session.commit()

    await engine.dispose()


@pytest.mark.asyncio
async def test_block_vote_unique_per_day():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with Session() as session:
        day = VaultDay(date=date(2026, 8, 23), mode="full", possible=21, total=0)
        session.add(day)
        await session.commit()
        await session.refresh(day)

        session.add(VaultBlockVote(vault_day_id=day.id, block="soul", stars=1))
        await session.commit()

        session.add(VaultBlockVote(vault_day_id=day.id, block="soul", stars=3))
        with pytest.raises(IntegrityError):
            await session.commit()

    await engine.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_vault_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.vault'`

- [ ] **Step 3: Write the model**

```python
# apps/api/app/models/vault.py
from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class VaultDay(Base):
    __tablename__ = "vault_days"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    possible: Mapped[int] = mapped_column(Integer, nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    focus: Mapped[str | None] = mapped_column(Text, nullable=True)
    log: Mapped[str | None] = mapped_column(Text, nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    block_votes: Mapped[list["VaultBlockVote"]] = relationship(back_populates="day", cascade="all, delete-orphan")


class VaultBlockVote(Base):
    __tablename__ = "vault_block_votes"
    __table_args__ = (UniqueConstraint("vault_day_id", "block"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vault_day_id: Mapped[int] = mapped_column(Integer, ForeignKey("vault_days.id"), nullable=False, index=True)
    block: Mapped[str] = mapped_column(String(20), nullable=False)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)

    day: Mapped["VaultDay"] = relationship(back_populates="block_votes", foreign_keys=[vault_day_id])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_vault_models.py -v`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/models/vault.py apps/api/tests/test_vault_models.py
git commit -m "feat(vault): add VaultDay and VaultBlockVote models"
```

---

## Task 2: Alembic Migration for Vault Tables

**Files:**
- Modify: `apps/api/alembic/env.py`
- Create: `apps/api/alembic/versions/<generated>_add_vault_tables.py` (auto-generated, filename determined by alembic)

**Interfaces:**
- Consumes: `VaultDay`, `VaultBlockVote` from Task 1.
- Produces: `vault_days` and `vault_block_votes` tables in Postgres, additive only.

- [ ] **Step 1: Register the new models with Alembic's autogenerate**

Edit `apps/api/alembic/env.py`:

```python
# Import all models so Alembic sees them
from app.models import user, persona, principle, tracker, vault  # noqa: F401
```

(replaces the existing `from app.models import user, persona, principle, tracker  # noqa: F401` line)

- [ ] **Step 2: Start local Postgres**

Run: `cd /home/ubuntu/src/dark-knight/niyyah && docker compose up -d db`
Expected: `db` container healthy (`docker compose ps` shows `healthy`)

- [ ] **Step 3: Generate the migration**

Run: `cd apps/api && alembic upgrade head && alembic revision --autogenerate -m "add vault tables"`
Expected: new file in `apps/api/alembic/versions/` whose `upgrade()` creates `vault_days` and `vault_block_votes` and whose `downgrade()` drops them. Open the generated file and confirm it contains no unrelated changes (autogenerate sometimes picks up unrelated diffs against a stale local DB — if it does, hand-trim the migration to only the two new tables).

- [ ] **Step 4: Apply and verify**

Run: `cd apps/api && alembic upgrade head`
Expected: no errors; `psql postgresql://niyyah:niyyah@localhost:5432/niyyah -c '\dt'` (or equivalent) lists `vault_days` and `vault_block_votes`.

- [ ] **Step 5: Verify downgrade is clean**

Run: `cd apps/api && alembic downgrade -1 && alembic upgrade head`
Expected: no errors both ways — proves the migration is reversible.

- [ ] **Step 6: Commit**

```bash
git add apps/api/alembic/env.py apps/api/alembic/versions/
git commit -m "feat(vault): add migration for vault_days and vault_block_votes"
```

---

## Task 3: Vault Markdown Parser

**Files:**
- Create: `apps/api/app/services/vault_parser.py`
- Modify: `apps/api/requirements.txt` (add `pyyaml`)
- Test: `apps/api/tests/test_vault_parser.py`

**Interfaces:**
- Produces: `parse_daily_note(content: str, note_date: date) -> ParsedDay`, where `ParsedDay` has fields `date`, `mode`, `possible`, `total`, `blocks: dict[str, int]`, `focus: str | None`, `log: str | None`. Also exports `CANONICAL_BLOCKS: list[str]`, `BLOCK_ALIASES: dict[str, str]`, `MODE_META: dict[str, dict]`.
- Consumed by: Task 5 (sync service).

- [ ] **Step 1: Add pyyaml dependency**

Add to `apps/api/requirements.txt`:

```
pyyaml>=6.0
```

Run: `cd apps/api && pip install -r requirements.txt`

- [ ] **Step 2: Write the failing tests**

```python
# apps/api/tests/test_vault_parser.py
from datetime import date

from app.services.vault_parser import parse_daily_note

FULL_DAY = """---
id: 20260823-daily
mode: full
stars: 0
possible: 21
---
# Sunday, 23rd August, 2026

> [!soul]+ Soul
> - [ ] ⭐ Prayed 5x Fard
> - [x] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah

> [!onething]+ ONE Thing
> - [ ] ⭐ Learned / read / practiced
> - [ ] ⭐⭐ Solid learning session
> - [x] ⭐⭐⭐ Deep study + built something

## Focus
- Most important thing today: ship the vault dashboard

## Tasks

## Log
- entry one
- entry two

## Captured (triage later)
"""

ALIAS_DRIFT_DAY = """---
mode: full
possible: 21
---
> [!mind]+ Mind
> - [ ] ⭐ Learned / read / practiced
> - [x] ⭐⭐ Solid learning session
> - [ ] ⭐⭐⭐ Deep study + built something

> [!operating]+ Operating
> - [x] ⭐ Bare minimum done
> - [ ] ⭐⭐ Good Enough
> - [ ] ⭐⭐⭐ Great work — extra mile
"""

MINIMAL_DAY_STALE_POSSIBLE = """---
mode: minimal
stars: 0
possible: 21
---
> [!soul]+ Soul
> - [x] ⭐ Prayed 5x Fard
> - [ ] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah
"""

UNCHECKED_DAY = """---
mode: full
possible: 21
---
> [!sleep]+ Sleep
> - [ ] ⭐ Slept
> - [ ] ⭐⭐ Slept within 30min of Isha
> - [ ] ⭐⭐⭐ Slept right after Isha
"""


def test_parses_canonical_blocks_and_takes_checked_star_level():
    parsed = parse_daily_note(FULL_DAY, date(2026, 8, 23))
    assert parsed.blocks["soul"] == 2
    assert parsed.blocks["onething"] == 3
    assert parsed.mode == "full"
    assert parsed.possible == 21
    assert parsed.total == 5


def test_normalizes_legacy_block_names():
    parsed = parse_daily_note(ALIAS_DRIFT_DAY, date(2026, 8, 10))
    assert parsed.blocks["onething"] == 2
    assert parsed.blocks["ops"] == 1
    assert "mind" not in parsed.blocks
    assert "operating" not in parsed.blocks


def test_possible_comes_from_mode_meta_not_stale_frontmatter():
    # frontmatter says possible: 21, but mode: minimal caps at 12 per MODE_META
    parsed = parse_daily_note(MINIMAL_DAY_STALE_POSSIBLE, date(2026, 8, 15))
    assert parsed.possible == 12


def test_block_with_no_checked_box_is_zero():
    parsed = parse_daily_note(UNCHECKED_DAY, date(2026, 8, 16))
    assert parsed.blocks["sleep"] == 0


def test_extracts_focus_and_log():
    parsed = parse_daily_note(FULL_DAY, date(2026, 8, 23))
    assert parsed.focus == "Most important thing today: ship the vault dashboard"
    assert parsed.log == "- entry one\n- entry two"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_vault_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.vault_parser'`

- [ ] **Step 4: Write the parser**

```python
# apps/api/app/services/vault_parser.py
import re
from dataclasses import dataclass
from datetime import date

import yaml

CANONICAL_BLOCKS = ["soul", "onething", "ops", "body", "distribution", "fnf", "sleep"]

BLOCK_ALIASES = {
    "mind": "onething",
    "operating": "ops",
}

# Verified against Calendar/Daily/2026-08-23.md's `modeMeta` dataviewjs table.
# Re-sync this table if that daily-template object ever changes.
MODE_META = {
    "full":       {"possible": 21, "color": "#10b981"},
    "yellow":     {"possible": 14, "color": "#f59e0b"},
    "compressed": {"possible": 21, "color": "#3b82f6"},
    "minimal":    {"possible": 12, "color": "#8b5cf6"},
    "off":        {"possible": 2,  "color": "#ef4444"},
    "ramadan":    {"possible": 14, "color": "#06b6d4"},
    "fasting":    {"possible": 21, "color": "#f59e0b"},
}

_CALLOUT_RE = re.compile(r"^>\s*\[!(\w+)\]")
_CHECKBOX_RE = re.compile(r"^>\s*-\s*\[( |x)\]\s*(⭐+)")


@dataclass
class ParsedDay:
    date: date
    mode: str
    possible: int
    total: int
    blocks: dict[str, int]
    focus: str | None
    log: str | None


def _split_frontmatter(content: str) -> tuple[dict, str]:
    if not content.startswith("---"):
        return {}, content
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}, content
    frontmatter = yaml.safe_load(parts[1]) or {}
    return frontmatter, parts[2]


def _parse_blocks(body: str) -> dict[str, int]:
    blocks: dict[str, int] = {}
    current_block: str | None = None

    for line in body.splitlines():
        callout_match = _CALLOUT_RE.match(line)
        if callout_match:
            name = BLOCK_ALIASES.get(callout_match.group(1).lower(), callout_match.group(1).lower())
            current_block = name if name in CANONICAL_BLOCKS else None
            if current_block:
                blocks.setdefault(current_block, 0)
            continue

        if current_block is None:
            continue

        if not line.startswith(">"):
            current_block = None
            continue

        checkbox_match = _CHECKBOX_RE.match(line)
        if checkbox_match and checkbox_match.group(1) == "x":
            stars = len(checkbox_match.group(2))
            blocks[current_block] = max(blocks[current_block], stars)

    return blocks


def _extract_section(body: str, heading: str) -> str | None:
    lines = body.splitlines()
    start = next((i + 1 for i, line in enumerate(lines) if line.strip() == heading), None)
    if start is None:
        return None
    section_lines = []
    for line in lines[start:]:
        if line.startswith("## "):
            break
        section_lines.append(line)
    joined = "\n".join(section_lines).strip()
    return joined or None


def parse_daily_note(content: str, note_date: date) -> ParsedDay:
    frontmatter, body = _split_frontmatter(content)
    mode = frontmatter.get("mode", "full")
    meta = MODE_META.get(mode, MODE_META["full"])

    blocks = _parse_blocks(body)
    total = sum(blocks.values())

    focus = None
    focus_section = _extract_section(body, "## Focus")
    if focus_section:
        for line in focus_section.splitlines():
            stripped = line.strip()
            if stripped:
                focus = re.sub(r"^-\s*", "", stripped)
                break

    log = None
    log_section = _extract_section(body, "## Log")
    if log_section:
        log_lines = [line.strip() for line in log_section.splitlines() if line.strip().startswith("- ")]
        log = "\n".join(log_lines) or None

    return ParsedDay(
        date=note_date,
        mode=mode,
        possible=meta["possible"],
        total=total,
        blocks=blocks,
        focus=focus,
        log=log,
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_vault_parser.py -v`
Expected: 5 passed

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/services/vault_parser.py apps/api/tests/test_vault_parser.py apps/api/requirements.txt
git commit -m "feat(vault): add daily note parser with alias normalization and mode ceilings"
```

---

## Task 4: Vault Config + Git Sync Service

**Files:**
- Modify: `apps/api/app/core/config.py`
- Create: `apps/api/app/services/vault_sync.py`
- Test: `apps/api/tests/test_vault_sync.py`

**Interfaces:**
- Consumes: `parse_daily_note`, `ParsedDay` from Task 3; `VaultDay`, `VaultBlockVote` from Task 1; `settings` from `app.core.config`.
- Produces: `async def sync_vault(db: AsyncSession, workdir: str | None = None) -> SyncResult`, where `SyncResult` has fields `synced_days: int`, `errors: list[str]`. Consumed by Task 6 (sync endpoints).

- [ ] **Step 1: Add vault settings**

Edit `apps/api/app/core/config.py` — add these fields inside the `Settings` class (after `cors_origins`):

```python
    vault_gitlab_url: str = "ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git"
    vault_github_url: str = "https://github.com/dark-knight-labs/xarvis.git"
    vault_sync_secret: str = "change-me-in-production"
    vault_workdir: str = "/app/data/vault-sync"
```

- [ ] **Step 2: Write the failing tests**

```python
# apps/api/tests/test_vault_sync.py
import subprocess
from datetime import date
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.database import Base
from app.models.vault import VaultBlockVote, VaultDay
from app.services import vault_sync

DAY_1 = """---
mode: full
possible: 21
---
> [!soul]+ Soul
> - [ ] ⭐ Prayed 5x Fard
> - [x] ⭐⭐ Prayed 5x Fard + Sunnah
> - [ ] ⭐⭐⭐ Tahajjud + Quran 1 page + Sunnah
"""

DAY_2 = """---
mode: full
possible: 21
---
> [!body]+ Body
> - [x] ⭐ Walk / 20min bodyweight
> - [ ] ⭐⭐ 1H session + walk
> - [ ] ⭐⭐⭐ Full session
"""

BROKEN_FRONTMATTER = """---
mode: [this is not valid yaml: :
---
> [!soul]+ Soul
> - [x] ⭐ Prayed 5x Fard
"""


def _make_repo(base: Path, name: str, notes: dict[str, str]) -> str:
    repo_dir = base / name
    daily_dir = repo_dir / "Calendar" / "Daily"
    daily_dir.mkdir(parents=True)
    for filename, content in notes.items():
        (daily_dir / filename).write_text(content, encoding="utf-8")

    subprocess.run(["git", "init", "--quiet"], cwd=repo_dir, check=True)
    subprocess.run(["git", "config", "user.email", "test@test.local"], cwd=repo_dir, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo_dir, check=True)
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "seed"], cwd=repo_dir, check=True)
    return str(repo_dir)


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with Session() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_sync_clones_from_gitlab_primary(tmp_path, db_session, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1, "2026-08-21.md": DAY_2})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))

    result = await vault_sync.sync_vault(db_session, workdir=str(tmp_path / "work"))

    assert result.errors == []
    assert result.synced_days == 2

    day = (await db_session.execute(
        VaultDay.__table__.select().where(VaultDay.date == date(2026, 8, 20))
    )).first()
    assert day is not None


@pytest.mark.asyncio
async def test_sync_falls_back_to_github_when_gitlab_unreachable(tmp_path, db_session, monkeypatch):
    github_repo = _make_repo(tmp_path, "github-xarvis", {"2026-08-22.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", str(tmp_path / "does-not-exist"))
    monkeypatch.setattr(settings, "vault_github_url", github_repo)

    result = await vault_sync.sync_vault(db_session, workdir=str(tmp_path / "work"))

    assert result.errors == []
    assert result.synced_days == 1


@pytest.mark.asyncio
async def test_sync_is_idempotent(tmp_path, db_session, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    workdir = str(tmp_path / "work")

    await vault_sync.sync_vault(db_session, workdir=workdir)
    await vault_sync.sync_vault(db_session, workdir=workdir)

    days = (await db_session.execute(VaultDay.__table__.select())).fetchall()
    votes = (await db_session.execute(VaultBlockVote.__table__.select())).fetchall()
    assert len(days) == 1
    assert len(votes) == 1


@pytest.mark.asyncio
async def test_sync_skips_malformed_file_and_reports_error(tmp_path, db_session, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {
        "2026-08-20.md": DAY_1,
        "2026-08-21.md": BROKEN_FRONTMATTER,
    })
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))

    result = await vault_sync.sync_vault(db_session, workdir=str(tmp_path / "work"))

    assert result.synced_days == 1
    assert len(result.errors) == 1
    assert "2026-08-21.md" in result.errors[0]
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_vault_sync.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.vault_sync'`

- [ ] **Step 4: Write the sync service**

```python
# apps/api/app/services/vault_sync.py
import asyncio
import subprocess
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_parser import parse_daily_note


@dataclass
class SyncResult:
    synced_days: int = 0
    errors: list[str] = field(default_factory=list)


def _run_git(args: list[str], cwd: str | None = None) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True, timeout=60)


def _ensure_repo(workdir: str) -> None:
    path = Path(workdir)
    if (path / ".git").exists():
        try:
            _run_git(["pull", "--ff-only"], cwd=workdir)
            return
        except subprocess.CalledProcessError:
            pass  # stale/broken checkout — fall through and re-clone

    path.mkdir(parents=True, exist_ok=True)
    try:
        _run_git(["clone", settings.vault_gitlab_url, workdir])
    except subprocess.CalledProcessError:
        _run_git(["clone", settings.vault_github_url, workdir])


async def sync_vault(db: AsyncSession, workdir: str | None = None) -> SyncResult:
    workdir = workdir or settings.vault_workdir
    result = SyncResult()

    try:
        await asyncio.to_thread(_ensure_repo, workdir)
    except subprocess.CalledProcessError as exc:
        result.errors.append(f"git sync failed on both remotes: {exc.stderr}")
        return result

    daily_dir = Path(workdir) / "Calendar" / "Daily"
    if not daily_dir.exists():
        result.errors.append(f"{daily_dir} not found in vault checkout")
        return result

    for note_path in sorted(daily_dir.glob("*.md")):
        try:
            note_date = date.fromisoformat(note_path.stem)
        except ValueError:
            continue  # not a YYYY-MM-DD daily note (e.g. a README)

        try:
            content = note_path.read_text(encoding="utf-8")
            parsed = parse_daily_note(content, note_date)
        except Exception as exc:  # a single bad file must not abort the whole sync
            result.errors.append(f"{note_path.name}: {exc}")
            continue

        existing = await db.execute(select(VaultDay).where(VaultDay.date == parsed.date))
        day = existing.scalar_one_or_none()
        if day is None:
            day = VaultDay(
                date=parsed.date, mode=parsed.mode, possible=parsed.possible, total=parsed.total,
                focus=parsed.focus, log=parsed.log,
            )
            db.add(day)
            await db.flush()
        else:
            day.mode = parsed.mode
            day.possible = parsed.possible
            day.total = parsed.total
            day.focus = parsed.focus
            day.log = parsed.log
            day.synced_at = datetime.now(timezone.utc)

        votes_result = await db.execute(select(VaultBlockVote).where(VaultBlockVote.vault_day_id == day.id))
        existing_votes = {v.block: v for v in votes_result.scalars().all()}
        for block, stars in parsed.blocks.items():
            if block in existing_votes:
                existing_votes[block].stars = stars
            else:
                db.add(VaultBlockVote(vault_day_id=day.id, block=block, stars=stars))

        result.synced_days += 1

    await db.commit()
    return result
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_vault_sync.py -v`
Expected: 4 passed

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/core/config.py apps/api/app/services/vault_sync.py apps/api/tests/test_vault_sync.py
git commit -m "feat(vault): add git sync service with GitLab-primary/GitHub-fallback"
```

---

## Task 5: Vault Schemas + Read Endpoints

**Files:**
- Create: `apps/api/app/schemas/vault.py`
- Create: `apps/api/app/api/v1/vault.py`
- Modify: `apps/api/app/main.py`
- Test: `apps/api/tests/test_vault_endpoints.py`

**Interfaces:**
- Consumes: `VaultDay`, `VaultBlockVote` (Task 1); `get_db`, `get_current_user` (existing `app.core.database`/`app.core.deps`).
- Produces: `router` (FastAPI `APIRouter`, prefix `/vault`) with `GET /today`, `GET /week`, `GET /month`, `GET /blocks`, `GET /streaks`. Task 6 adds `POST /sync` and `POST /sync/webhook` to this same router/file.

- [ ] **Step 1: Write the schemas**

```python
# apps/api/app/schemas/vault.py
from datetime import date

from pydantic import BaseModel


class VaultDayResponse(BaseModel):
    date: date
    mode: str
    possible: int
    blocks: dict[str, int]
    total: int
    pct: int
    focus: str | None
    log: str | None


class VaultWeekResponse(BaseModel):
    days: list[VaultDayResponse]
    totals: dict[str, int]
    week_total: int
    week_possible: int
    week_pct: int


class VaultMonthResponse(BaseModel):
    month: str
    days: list[VaultDayResponse]
    totals: dict[str, int]
    modes: dict[str, int]
    month_pct: int


class VaultBlocksSeriesResponse(BaseModel):
    range: int
    blocks: dict[str, list[int]]
    averages: dict[str, float]


class VaultStreakEntry(BaseModel):
    current: int
    longest: int


class VaultStreaksResponse(BaseModel):
    streaks: dict[str, VaultStreakEntry]


class VaultSyncResponse(BaseModel):
    synced_days: int
    errors: list[str]
```

- [ ] **Step 2: Write the failing tests**

```python
# apps/api/tests/test_vault_endpoints.py
from datetime import date, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.models.vault import VaultBlockVote, VaultDay
from tests.conftest import TestSession


@pytest_asyncio.fixture
async def seed_day():
    async def _seed(d: date, mode: str = "full", possible: int = 21, blocks: dict[str, int] | None = None):
        blocks = blocks or {}
        async with TestSession() as session:
            day = VaultDay(date=d, mode=mode, possible=possible, total=sum(blocks.values()))
            session.add(day)
            await session.flush()
            for block, stars in blocks.items():
                session.add(VaultBlockVote(vault_day_id=day.id, block=block, stars=stars))
            await session.commit()
    return _seed


@pytest.mark.asyncio
async def test_today_returns_404_when_no_data(auth_client: AsyncClient):
    resp = await auth_client.get("/api/v1/vault/today")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_today_returns_synced_day(auth_client: AsyncClient, seed_day):
    await seed_day(date.today(), mode="full", possible=21, blocks={"soul": 2, "body": 3})
    resp = await auth_client.get("/api/v1/vault/today")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 5
    assert body["pct"] == round(100 * 5 / 21)
    assert body["blocks"]["soul"] == 2


@pytest.mark.asyncio
async def test_week_aggregates_totals(auth_client: AsyncClient, seed_day):
    today = date.today()
    await seed_day(today, blocks={"soul": 3})
    await seed_day(today - timedelta(days=1), blocks={"soul": 1})
    resp = await auth_client.get("/api/v1/vault/week")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["days"]) == 2
    assert body["totals"]["soul"] == 4
    assert body["week_total"] == 4


@pytest.mark.asyncio
async def test_month_filters_and_computes_mode_distribution(auth_client: AsyncClient, seed_day):
    month_str = date.today().strftime("%Y-%m")
    await seed_day(date.today(), mode="full", blocks={"soul": 3})
    resp = await auth_client.get(f"/api/v1/vault/month?month={month_str}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["modes"]["full"] == 1


@pytest.mark.asyncio
async def test_streaks_resets_on_zero_and_ignores_absent_blocks(auth_client: AsyncClient, seed_day):
    today = date.today()
    await seed_day(today - timedelta(days=2), blocks={"soul": 2})
    await seed_day(today - timedelta(days=1), blocks={"soul": 0})
    await seed_day(today, blocks={"soul": 1})
    resp = await auth_client.get("/api/v1/vault/streaks")
    assert resp.status_code == 200
    streaks = resp.json()["streaks"]
    assert streaks["soul"]["current"] == 1
    assert streaks["soul"]["longest"] == 1
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_vault_endpoints.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.v1.vault'`

- [ ] **Step 4: Write the router**

```python
# apps/api/app/api/v1/vault.py
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.vault import VaultDay
from app.schemas.vault import (
    VaultBlocksSeriesResponse,
    VaultDayResponse,
    VaultMonthResponse,
    VaultStreakEntry,
    VaultStreaksResponse,
    VaultWeekResponse,
)

router = APIRouter(prefix="/vault", tags=["vault"])


def _day_to_response(day: VaultDay) -> VaultDayResponse:
    blocks = {v.block: v.stars for v in day.block_votes}
    pct = round(100 * day.total / day.possible) if day.possible else 0
    return VaultDayResponse(
        date=day.date, mode=day.mode, possible=day.possible, blocks=blocks,
        total=day.total, pct=pct, focus=day.focus, log=day.log,
    )


async def _get_day(db: AsyncSession, target_date: date) -> VaultDay | None:
    result = await db.execute(
        select(VaultDay).where(VaultDay.date == target_date).options(selectinload(VaultDay.block_votes))
    )
    return result.scalar_one_or_none()


async def _get_days_range(db: AsyncSession, start: date, end: date) -> list[VaultDay]:
    result = await db.execute(
        select(VaultDay)
        .where(VaultDay.date >= start, VaultDay.date <= end)
        .options(selectinload(VaultDay.block_votes))
        .order_by(VaultDay.date)
    )
    return list(result.scalars().all())


@router.get("/today", response_model=VaultDayResponse)
async def get_today(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    day = await _get_day(db, date.today())
    if day is None:
        raise HTTPException(status_code=404, detail="No vault data synced for today")
    return _day_to_response(day)


@router.get("/week", response_model=VaultWeekResponse)
async def get_week(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    end = date.today()
    start = end - timedelta(days=6)
    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end)]

    totals: dict[str, int] = {}
    for r in responses:
        for block, stars in r.blocks.items():
            totals[block] = totals.get(block, 0) + stars

    week_total = sum(r.total for r in responses)
    week_possible = sum(r.possible for r in responses)
    week_pct = round(100 * week_total / week_possible) if week_possible else 0

    return VaultWeekResponse(
        days=responses, totals=totals, week_total=week_total,
        week_possible=week_possible, week_pct=week_pct,
    )


@router.get("/month", response_model=VaultMonthResponse)
async def get_month(month: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        year_str, month_str = month.split("-")
        start = date(int(year_str), int(month_str), 1)
    except (ValueError, IndexError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    end = date(start.year + (start.month == 12), start.month % 12 + 1, 1) - timedelta(days=1)

    responses = [_day_to_response(d) for d in await _get_days_range(db, start, end)]

    totals: dict[str, int] = {}
    modes: dict[str, int] = {}
    for r in responses:
        for block, stars in r.blocks.items():
            totals[block] = totals.get(block, 0) + stars
        modes[r.mode] = modes.get(r.mode, 0) + 1

    month_total = sum(r.total for r in responses)
    month_possible = sum(r.possible for r in responses)
    month_pct = round(100 * month_total / month_possible) if month_possible else 0

    return VaultMonthResponse(month=month, days=responses, totals=totals, modes=modes, month_pct=month_pct)


@router.get("/blocks", response_model=VaultBlocksSeriesResponse)
async def get_blocks(days: int = 30, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    end = date.today()
    start = end - timedelta(days=days - 1)
    day_rows = await _get_days_range(db, start, end)

    series: dict[str, list[int]] = {}
    for day in day_rows:
        for vote in day.block_votes:
            series.setdefault(vote.block, []).append(vote.stars)

    averages = {block: round(sum(values) / len(values), 2) for block, values in series.items() if values}

    return VaultBlocksSeriesResponse(range=days, blocks=series, averages=averages)


@router.get("/streaks", response_model=VaultStreaksResponse)
async def get_streaks(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VaultDay).options(selectinload(VaultDay.block_votes)).order_by(VaultDay.date.asc())
    )
    day_rows = list(result.scalars().all())

    running: dict[str, int] = {}
    longest: dict[str, int] = {}

    for day in day_rows:
        for vote in day.block_votes:
            running[vote.block] = running.get(vote.block, 0) + 1 if vote.stars > 0 else 0
            longest[vote.block] = max(longest.get(vote.block, 0), running[vote.block])

    streaks = {
        block: VaultStreakEntry(current=running.get(block, 0), longest=longest.get(block, 0))
        for block in longest
    }
    return VaultStreaksResponse(streaks=streaks)
```

- [ ] **Step 5: Wire the router into main.py**

Edit `apps/api/app/main.py`:

```python
from app.api.v1 import auth, personas, schedule, principles, tracker, settings as settings_router, dashboard, vault
```

(add `vault` to the import line)

```python
app.include_router(vault.router, prefix="/api/v1")
```

(add after the existing `app.include_router(dashboard.router, prefix="/api/v1")` line)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_vault_endpoints.py -v`
Expected: 5 passed

- [ ] **Step 7: Run the full backend test suite to confirm no regressions**

Run: `cd apps/api && python -m pytest -v`
Expected: all tests pass (existing tracker/auth/personas/schedule tests + all new vault tests)

- [ ] **Step 8: Commit**

```bash
git add apps/api/app/schemas/vault.py apps/api/app/api/v1/vault.py apps/api/app/main.py apps/api/tests/test_vault_endpoints.py
git commit -m "feat(vault): add read endpoints for today/week/month/blocks/streaks"
```

---

## Task 6: Vault Sync Endpoints

**Files:**
- Modify: `apps/api/app/api/v1/vault.py`
- Test: `apps/api/tests/test_vault_sync_endpoints.py`

**Interfaces:**
- Consumes: `sync_vault`, `SyncResult` (Task 4); `VaultSyncResponse` (Task 5); `settings.vault_sync_secret` (Task 4).
- Produces: `POST /vault/sync` (authenticated), `POST /vault/sync/webhook` (shared-secret header `X-Vault-Sync-Secret`).

- [ ] **Step 1: Write the failing tests**

```python
# apps/api/tests/test_vault_sync_endpoints.py
import pytest
from httpx import AsyncClient

from app.core.config import settings
from tests.test_vault_sync import DAY_1, _make_repo


@pytest.mark.asyncio
async def test_manual_sync_requires_auth(client: AsyncClient):
    resp = await client.post("/api/v1/vault/sync")
    assert resp.status_code == 403  # HTTPBearer with no credentials


@pytest.mark.asyncio
async def test_manual_sync_triggers_sync(auth_client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))

    resp = await auth_client.post("/api/v1/vault/sync")
    assert resp.status_code == 200
    body = resp.json()
    assert body["synced_days"] == 1
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_webhook_rejects_wrong_secret(client: AsyncClient):
    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Vault-Sync-Secret": "wrong-secret"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_webhook_accepts_correct_secret(client: AsyncClient, tmp_path, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "work"))

    resp = await client.post(
        "/api/v1/vault/sync/webhook",
        headers={"X-Vault-Sync-Secret": settings.vault_sync_secret},
    )
    assert resp.status_code == 200
    assert resp.json()["synced_days"] == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && python -m pytest tests/test_vault_sync_endpoints.py -v`
Expected: FAIL — 404 (routes don't exist yet)

- [ ] **Step 3: Add the sync endpoints**

Add to `apps/api/app/api/v1/vault.py` (imports first, then endpoints at the end of the file):

```python
from fastapi import APIRouter, Depends, Header, HTTPException, status
```

(replaces the existing `from fastapi import APIRouter, Depends, HTTPException` import line)

```python
from app.core.config import settings
from app.schemas.vault import VaultSyncResponse
from app.services.vault_sync import sync_vault
```

(add to the existing import block)

```python
@router.post("/sync", response_model=VaultSyncResponse)
async def trigger_sync(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await sync_vault(db)
    return VaultSyncResponse(synced_days=result.synced_days, errors=result.errors)


@router.post("/sync/webhook", response_model=VaultSyncResponse)
async def webhook_sync(x_vault_sync_secret: str = Header(...), db: AsyncSession = Depends(get_db)):
    if x_vault_sync_secret != settings.vault_sync_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sync secret")
    result = await sync_vault(db)
    return VaultSyncResponse(synced_days=result.synced_days, errors=result.errors)
```

(add at the end of the file)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && python -m pytest tests/test_vault_sync_endpoints.py -v`
Expected: 4 passed

- [ ] **Step 5: Run the full backend test suite**

Run: `cd apps/api && python -m pytest -v`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/api/v1/vault.py apps/api/tests/test_vault_sync_endpoints.py
git commit -m "feat(vault): add authenticated manual sync and webhook sync endpoints"
```

---

## Task 7: Dark Theme Wiring

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/hooks/use-theme.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `useTheme()` hook that sets `data-theme="light"|"dark"` on `document.documentElement` based on the existing `/settings` `theme` field (`light`/`dark`/`system`). `[data-theme="dark"]` CSS block in `globals.css` for Task 9-11 components to render correctly under.

- [ ] **Step 1: Add dark theme tokens to globals.css**

Edit `apps/web/src/app/globals.css` — add immediately after the existing `:root { ... }` block (before `@theme inline`):

```css
[data-theme="dark"] {
  color-scheme: dark;

  --background: #0a0a0a;
  --surface: #141414;
  --foreground: #fafafa;
  --muted: #1a1a1a;
  --muted-foreground: #a1a1aa;
  --border: #262626;
  --accent: #7c3aed;
  --accent-fg: #ffffff;
  --accent-light: #241a35;
}
```

- [ ] **Step 2: Write the theme hook**

```typescript
// apps/web/src/hooks/use-theme.ts
"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";

interface ThemeSetting {
  theme: string;
}

function applyResolvedTheme(theme: string) {
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme() {
  useEffect(() => {
    let cancelled = false;

    api
      .get<ThemeSetting>("/settings")
      .then((settings) => {
        if (!cancelled) applyResolvedTheme(settings.theme);
      })
      .catch(() => {
        if (!cancelled) applyResolvedTheme("light");
      });

    return () => {
      cancelled = true;
    };
  }, []);
}
```

- [ ] **Step 3: Call the hook from the app layout**

Edit `apps/web/src/app/(app)/layout.tsx` — add the import and call:

```typescript
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
```

(add `useTheme` to the existing import line's neighbor)

```typescript
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  useTheme();
```

(add `useTheme();` as the first line of the function body, after the existing `useAuth()`/`usePathname()` calls)

- [ ] **Step 4: Verify — TypeScript build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Verify — manual browser check**

Run: `cd apps/web && npm run dev`, log in, go to Settings, switch Theme to "Dark", save, reload any page.
Expected: background turns near-black (`#0a0a0a`), text light, existing pages (dashboard, tracker, etc.) remain legible — this proves the toggle now actually works app-wide, not just visually inert.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/hooks/use-theme.ts "apps/web/src/app/(app)/layout.tsx"
git commit -m "feat(theme): wire the existing theme setting to real dark-mode CSS tokens"
```

---

## Task 8: Vault API Client, Types, Constants, Nav Link

**Files:**
- Create: `apps/web/src/lib/vault-types.ts`
- Create: `apps/web/src/lib/vault-constants.ts`
- Create: `apps/web/src/lib/vault-api.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `vaultApi.{today,week,month,blocks,streaks,sync}` functions; `BLOCK_ORDER`, `BLOCK_LABELS`, `BLOCK_COLORS`, `MODE_COLORS` constants; `VaultDayData`, `VaultWeekData`, `VaultMonthData`, `VaultBlocksSeriesData`, `VaultStreaksData`, `VaultSyncData` types. Consumed by Tasks 9-11.

- [ ] **Step 1: Write the response types**

```typescript
// apps/web/src/lib/vault-types.ts
export interface VaultDayData {
  date: string;
  mode: string;
  possible: number;
  blocks: Record<string, number>;
  total: number;
  pct: number;
  focus: string | null;
  log: string | null;
}

export interface VaultWeekData {
  days: VaultDayData[];
  totals: Record<string, number>;
  week_total: number;
  week_possible: number;
  week_pct: number;
}

export interface VaultMonthData {
  month: string;
  days: VaultDayData[];
  totals: Record<string, number>;
  modes: Record<string, number>;
  month_pct: number;
}

export interface VaultBlocksSeriesData {
  range: number;
  blocks: Record<string, number[]>;
  averages: Record<string, number>;
}

export interface VaultStreakEntry {
  current: number;
  longest: number;
}

export interface VaultStreaksData {
  streaks: Record<string, VaultStreakEntry>;
}

export interface VaultSyncData {
  synced_days: number;
  errors: string[];
}
```

- [ ] **Step 2: Write the block/mode constants**

```typescript
// apps/web/src/lib/vault-constants.ts
export const BLOCK_ORDER = ["soul", "onething", "ops", "body", "distribution", "fnf", "sleep"] as const;
export type Block = (typeof BLOCK_ORDER)[number];

export const BLOCK_LABELS: Record<Block, string> = {
  soul: "Soul",
  onething: "ONE Thing",
  ops: "OPS",
  body: "Body",
  distribution: "Distribution",
  fnf: "FnF",
  sleep: "Sleep",
};

export const BLOCK_COLORS: Record<Block, string> = {
  soul: "#10b981",
  onething: "#3b82f6",
  ops: "#8b5cf6",
  body: "#f59e0b",
  fnf: "#f43f5e",
  distribution: "#06b6d4",
  sleep: "#64748b",
};

export const MODE_COLORS: Record<string, string> = {
  full: "#059669",
  yellow: "#eab308",
  compressed: "#3b82f6",
  minimal: "#8b5cf6",
  off: "#ef4444",
  ramadan: "#06b6d4",
  fasting: "#f59e0b",
};
```

- [ ] **Step 3: Write the API client**

```typescript
// apps/web/src/lib/vault-api.ts
import { api } from "@/lib/api-client";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  VaultMonthData,
  VaultStreaksData,
  VaultSyncData,
  VaultWeekData,
} from "@/lib/vault-types";

export const vaultApi = {
  today: () => api.get<VaultDayData>("/vault/today"),
  week: () => api.get<VaultWeekData>("/vault/week"),
  month: (month: string) => api.get<VaultMonthData>(`/vault/month?month=${month}`),
  blocks: (days: number = 30) => api.get<VaultBlocksSeriesData>(`/vault/blocks?days=${days}`),
  streaks: () => api.get<VaultStreaksData>("/vault/streaks"),
  sync: () => api.post<VaultSyncData>("/vault/sync", {}),
};
```

- [ ] **Step 4: Add the nav link**

Edit `apps/web/src/app/(app)/layout.tsx` — add `Activity` to the lucide-react import:

```typescript
import {
  LayoutDashboard,
  Users,
  Calendar,
  Compass,
  CheckSquare,
  Activity,
  Settings,
  LogOut,
} from "lucide-react";
```

Add a nav entry to the `nav` array, after `tracker`:

```typescript
const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/personas", label: "Personas", icon: Users },
  { href: "/schedule", label: "Schedule", icon: Calendar },
  { href: "/principles", label: "Principles", icon: Compass },
  { href: "/tracker", label: "Tracker", icon: CheckSquare },
  { href: "/vault", label: "Vault", icon: Activity },
  { href: "/settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 5: Verify — TypeScript build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (note: `/vault` route doesn't exist yet until Task 9, so the nav link 404s until then — expected at this point in the plan)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/vault-types.ts apps/web/src/lib/vault-constants.ts apps/web/src/lib/vault-api.ts "apps/web/src/app/(app)/layout.tsx"
git commit -m "feat(vault): add vault API client, types, constants, and nav entry"
```

---

## Task 9: Vault Page Shell — Header + Today's Blocks

**Files:**
- Create: `apps/web/src/components/vault/header.tsx`
- Create: `apps/web/src/components/vault/block-cards.tsx`
- Create: `apps/web/src/app/(app)/vault/page.tsx`

**Interfaces:**
- Consumes: `vaultApi`, `VaultDayData`, `BLOCK_ORDER`, `BLOCK_LABELS`, `BLOCK_COLORS`, `MODE_COLORS` from Task 8.
- Produces: `VaultHeader({ today, onSynced })`, `BlockCards({ today })` components; `VaultPage` default export at `/vault`. Task 10-11 extend `page.tsx` further.

- [ ] **Step 1: Write the header component**

```typescript
// apps/web/src/components/vault/header.tsx
"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { MODE_COLORS } from "@/lib/vault-constants";

interface VaultHeaderProps {
  today: VaultDayData | null;
  onSynced: () => void;
}

export function VaultHeader({ today, onSynced }: VaultHeaderProps) {
  const [syncing, setSyncing] = useState(false);

  async function handleSync() {
    setSyncing(true);
    try {
      await vaultApi.sync();
      onSynced();
    } finally {
      setSyncing(false);
    }
  }

  const modeColor = today ? MODE_COLORS[today.mode] ?? "#71717a" : "#71717a";

  return (
    <div className="flex items-center justify-between border border-[var(--border)] bg-[var(--surface)] rounded px-4 py-3 mb-4">
      <div className="flex items-center gap-3">
        <h1 className="text-sm font-bold uppercase tracking-wider">Vault</h1>
        {today && (
          <span
            className="text-xs uppercase tracking-wider px-2 py-0.5 rounded font-mono"
            style={{ backgroundColor: `${modeColor}22`, color: modeColor }}
          >
            {today.mode}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {today && (
          <span className="font-mono text-sm">
            {today.total}/{today.possible} · {today.pct}%
          </span>
        )}
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-50"
        >
          <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
          Sync
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the block cards component**

```typescript
// apps/web/src/components/vault/block-cards.tsx
import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";
import { VaultDayData } from "@/lib/vault-types";

interface BlockCardsProps {
  today: VaultDayData | null;
}

export function BlockCards({ today }: BlockCardsProps) {
  return (
    <div className="grid grid-cols-4 md:grid-cols-7 gap-2 mb-4">
      {BLOCK_ORDER.map((block) => {
        const stars = today?.blocks[block] ?? 0;
        const color = BLOCK_COLORS[block];
        return (
          <div
            key={block}
            className="border border-[var(--border)] rounded px-3 py-2"
            style={{ backgroundColor: stars > 0 ? `${color}14` : "var(--surface)" }}
          >
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color }}>
              {BLOCK_LABELS[block]}
            </p>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((level) => (
                <span
                  key={level}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: level <= stars ? color : "var(--border)" }}
                />
              ))}
              <span className="font-mono text-xs ml-1 text-[var(--muted-foreground)]">{stars}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Write the page shell**

```typescript
// apps/web/src/app/(app)/vault/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData } from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    vaultApi
      .today()
      .then(setToday)
      .catch(() => setToday(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <VaultHeader today={today} onSynced={load} />
      <BlockCards today={today} />
    </div>
  );
}
```

- [ ] **Step 4: Verify — TypeScript build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Verify — manual browser check**

Run: `cd apps/web && npm run dev` (with `apps/api` also running against a Postgres that has at least one synced `VaultDay` row — seed one manually via `POST /api/v1/vault/sync` against a real or test vault checkout, or insert a row directly for a quick visual check). Navigate to `/vault`.
Expected: header shows mode badge + score + sync button; 7-card block grid renders with correct colors/star dots. Toggle theme to dark in Settings and confirm cards still read correctly against the dark surface.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/vault/header.tsx apps/web/src/components/vault/block-cards.tsx "apps/web/src/app/(app)/vault/page.tsx"
git commit -m "feat(vault): add vault page shell with header and today's blocks"
```

---

## Task 10: Weekly Pulse + Monthly Heatmap

**Files:**
- Create: `apps/web/src/components/vault/weekly-pulse.tsx`
- Create: `apps/web/src/components/vault/monthly-heatmap.tsx`
- Modify: `apps/web/src/app/(app)/vault/page.tsx`

**Interfaces:**
- Consumes: `VaultWeekData`, `VaultMonthData`, `MODE_COLORS` from Task 8.
- Produces: `WeeklyPulse({ week })`, `MonthlyHeatmap({ month })` components, wired into `page.tsx`.

- [ ] **Step 1: Write the weekly pulse component**

```typescript
// apps/web/src/components/vault/weekly-pulse.tsx
import { MODE_COLORS } from "@/lib/vault-constants";
import { VaultWeekData } from "@/lib/vault-types";

interface WeeklyPulseProps {
  week: VaultWeekData | null;
}

export function WeeklyPulse({ week }: WeeklyPulseProps) {
  if (!week) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Weekly Pulse</p>
      <div className="flex items-end gap-2 h-24 relative">
        <div
          className="absolute left-0 right-0 border-t border-dashed border-[var(--muted-foreground)]"
          style={{ bottom: `${week.week_pct}%` }}
        />
        {week.days.map((day) => {
          const dow = new Date(day.date).toLocaleDateString("en-US", { weekday: "short" });
          const color = MODE_COLORS[day.mode] ?? "#71717a";
          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t"
                  style={{ height: `${Math.max(day.pct, 2)}%`, backgroundColor: color }}
                />
              </div>
              <span className="text-[10px] uppercase text-[var(--muted-foreground)] font-mono">{dow}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the monthly heatmap component**

```typescript
// apps/web/src/components/vault/monthly-heatmap.tsx
import { VaultMonthData } from "@/lib/vault-types";

interface MonthlyHeatmapProps {
  month: VaultMonthData | null;
}

function heatColor(pct: number): string {
  if (pct === 0) return "var(--border)";
  if (pct < 34) return "#ef4444";
  if (pct < 67) return "#eab308";
  return "#059669";
}

export function MonthlyHeatmap({ month }: MonthlyHeatmapProps) {
  if (!month) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
        Monthly Heatmap — {month.month}
      </p>
      <div className="grid grid-cols-7 gap-2">
        {month.days.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.total}/${day.possible}`}
            className="w-6 h-6 rounded-full mx-auto"
            style={{ backgroundColor: heatColor(day.pct) }}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire into the page**

Edit `apps/web/src/app/(app)/vault/page.tsx` — replace its full contents:

```typescript
// apps/web/src/app/(app)/vault/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import { VaultDayData, VaultMonthData, VaultWeekData } from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";
import { WeeklyPulse } from "@/components/vault/weekly-pulse";
import { MonthlyHeatmap } from "@/components/vault/monthly-heatmap";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [week, setWeek] = useState<VaultWeekData | null>(null);
  const [month, setMonth] = useState<VaultMonthData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      vaultApi.today().catch(() => null),
      vaultApi.week().catch(() => null),
      vaultApi.month(currentMonth()).catch(() => null),
    ])
      .then(([t, w, m]) => {
        setToday(t);
        setWeek(w);
        setMonth(m);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <VaultHeader today={today} onSynced={load} />
      <BlockCards today={today} />
      <WeeklyPulse week={week} />
      <MonthlyHeatmap month={month} />
    </div>
  );
}
```

- [ ] **Step 4: Verify — TypeScript build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Verify — manual browser check**

Navigate to `/vault` with the dev servers running and at least a week of seeded/synced `VaultDay` rows.
Expected: 7-day bar chart renders with mode-colored bars and a dashed average-reference line; day-circle heatmap renders for the current month with red/yellow/green intensity.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/vault/weekly-pulse.tsx apps/web/src/components/vault/monthly-heatmap.tsx "apps/web/src/app/(app)/vault/page.tsx"
git commit -m "feat(vault): add weekly pulse and monthly heatmap sections"
```

---

## Task 11: Block Trends + Footer Stats (Final Page Assembly)

**Files:**
- Create: `apps/web/src/components/vault/block-trends.tsx`
- Create: `apps/web/src/components/vault/footer-stats.tsx`
- Modify: `apps/web/src/app/(app)/vault/page.tsx`

**Interfaces:**
- Consumes: `VaultBlocksSeriesData`, `VaultStreaksData`, `BLOCK_ORDER`, `BLOCK_LABELS`, `BLOCK_COLORS`, `MODE_COLORS` from Task 8.
- Produces: `BlockTrends({ series })`, `FooterStats({ month, streaks })` components; final six-section `page.tsx`.

- [ ] **Step 1: Write the block trends component**

```typescript
// apps/web/src/components/vault/block-trends.tsx
import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER } from "@/lib/vault-constants";
import { VaultBlocksSeriesData } from "@/lib/vault-types";

interface BlockTrendsProps {
  series: VaultBlocksSeriesData | null;
}

export function BlockTrends({ series }: BlockTrendsProps) {
  if (!series) return null;

  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4 mb-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
        Block Trends ({series.range}d)
      </p>
      <div className="space-y-2">
        {BLOCK_ORDER.map((block) => {
          const values = series.blocks[block] ?? [];
          const avg = series.averages[block] ?? 0;
          const color = BLOCK_COLORS[block];
          return (
            <div key={block} className="flex items-center gap-3">
              <span className="text-xs w-24 shrink-0" style={{ color }}>
                {BLOCK_LABELS[block]}
              </span>
              <div className="flex-1 flex items-end gap-px h-6">
                {values.map((v, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-sm"
                    style={{ height: `${Math.max((v / 3) * 100, 4)}%`, backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs w-8 text-right text-[var(--muted-foreground)]">{avg}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the footer stats component**

```typescript
// apps/web/src/components/vault/footer-stats.tsx
import { BLOCK_COLORS, BLOCK_LABELS, BLOCK_ORDER, MODE_COLORS } from "@/lib/vault-constants";
import { VaultMonthData, VaultStreaksData } from "@/lib/vault-types";

interface FooterStatsProps {
  month: VaultMonthData | null;
  streaks: VaultStreaksData | null;
}

export function FooterStats({ month, streaks }: FooterStatsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">
          Mode Distribution
        </p>
        {month && month.days.length > 0 ? (
          <div className="flex h-3 rounded overflow-hidden">
            {Object.entries(month.modes).map(([mode, count]) => (
              <div
                key={mode}
                style={{
                  width: `${(count / month.days.length) * 100}%`,
                  backgroundColor: MODE_COLORS[mode] ?? "#71717a",
                }}
                title={`${mode}: ${count}`}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--muted-foreground)]">No data yet</p>
        )}
      </div>

      <div className="border border-[var(--border)] bg-[var(--surface)] rounded p-4">
        <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-3">Streaks</p>
        <div className="space-y-1">
          {BLOCK_ORDER.map((block) => {
            const entry = streaks?.streaks[block];
            return (
              <div key={block} className="flex items-center justify-between text-xs">
                <span style={{ color: BLOCK_COLORS[block] }}>{BLOCK_LABELS[block]}</span>
                <span className="font-mono text-[var(--muted-foreground)]">
                  {entry?.current ?? 0} / {entry?.longest ?? 0}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Final page assembly**

Edit `apps/web/src/app/(app)/vault/page.tsx` — replace its full contents:

```typescript
// apps/web/src/app/(app)/vault/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { vaultApi } from "@/lib/vault-api";
import {
  VaultBlocksSeriesData,
  VaultDayData,
  VaultMonthData,
  VaultStreaksData,
  VaultWeekData,
} from "@/lib/vault-types";
import { VaultHeader } from "@/components/vault/header";
import { BlockCards } from "@/components/vault/block-cards";
import { WeeklyPulse } from "@/components/vault/weekly-pulse";
import { MonthlyHeatmap } from "@/components/vault/monthly-heatmap";
import { BlockTrends } from "@/components/vault/block-trends";
import { FooterStats } from "@/components/vault/footer-stats";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function VaultPage() {
  const [today, setToday] = useState<VaultDayData | null>(null);
  const [week, setWeek] = useState<VaultWeekData | null>(null);
  const [month, setMonth] = useState<VaultMonthData | null>(null);
  const [blocks, setBlocks] = useState<VaultBlocksSeriesData | null>(null);
  const [streaks, setStreaks] = useState<VaultStreaksData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      vaultApi.today().catch(() => null),
      vaultApi.week().catch(() => null),
      vaultApi.month(currentMonth()).catch(() => null),
      vaultApi.blocks(30).catch(() => null),
      vaultApi.streaks().catch(() => null),
    ])
      .then(([t, w, m, b, s]) => {
        setToday(t);
        setWeek(w);
        setMonth(m);
        setBlocks(b);
        setStreaks(s);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <VaultHeader today={today} onSynced={load} />
      <BlockCards today={today} />
      <WeeklyPulse week={week} />
      <MonthlyHeatmap month={month} />
      <BlockTrends series={blocks} />
      <FooterStats month={month} streaks={streaks} />
    </div>
  );
}
```

- [ ] **Step 4: Verify — TypeScript build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Verify — manual browser check, both themes**

Navigate to `/vault` with light theme, then switch to dark in Settings and reload.
Expected: all six sections render correctly in both themes — sparklines, mode-distribution bar, and streak numbers all legible against both light and dark surfaces; monospace stat numbers (score, pct, sparkline averages, streak counts) are visually distinct from the Manrope prose/labels.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/vault/block-trends.tsx apps/web/src/components/vault/footer-stats.tsx "apps/web/src/app/(app)/vault/page.tsx"
git commit -m "feat(vault): add block trends and footer stats, complete vault dashboard"
```

---

## Task 12: K8s Wiring, Migration Rollout, GitLab Webhook

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `k8s/niyyah.yaml`

**Interfaces:**
- Consumes: `VAULT_GITLAB_URL`, `VAULT_GITHUB_URL`, `VAULT_SYNC_SECRET`, `VAULT_WORKDIR` (Task 4's `Settings` fields, sourced here from env/secret instead of code defaults).

- [ ] **Step 1: Install git + openssh-client in the API image**

Edit `apps/api/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PYTHONPATH=/app
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Add vault env vars and the deploy key to the niyyah-config secret**

Edit `k8s/niyyah.yaml` — add to the existing `niyyah-config` Secret's `stringData` block (after `CORS_ORIGINS`):

```yaml
  VAULT_GITLAB_URL: ssh://git@gitlab.alamin.rocks:2222/pkm/xarvis.git
  VAULT_GITHUB_URL: https://github.com/dark-knight-labs/xarvis.git
  VAULT_SYNC_SECRET: changeme-vault-sync-shared-secret-generate-secure-random
  VAULT_WORKDIR: /app/data/vault-sync
  GIT_SSH_COMMAND: ssh -i /app/.ssh/vault_deploy_key -o StrictHostKeyChecking=accept-new
  VAULT_DEPLOY_KEY: |
    changeme-replace-with-real-ed25519-private-key-PEM-contents-before-applying
```

- [ ] **Step 3: Mount the deploy key as a file into the API deployment**

Edit `k8s/niyyah.yaml` — add a volume mount to the `api` container (alongside the existing `backend-data` mount):

```yaml
          volumeMounts:
            - name: backend-data
              mountPath: /app/data
            - name: vault-deploy-key
              mountPath: /app/.ssh/vault_deploy_key
              subPath: vault_deploy_key
              readOnly: true
```

And a matching volume in the Deployment's `volumes:` block (alongside `backend-data`):

```yaml
      volumes:
        - name: backend-data
          persistentVolumeClaim:
            claimName: niyyah-backend-pvc
        - name: vault-deploy-key
          secret:
            secretName: niyyah-config
            items:
              - key: VAULT_DEPLOY_KEY
                path: vault_deploy_key
                mode: 0o400
```

- [ ] **Step 4: Dry-run validate the manifest**

Run: `kubectl apply --dry-run=client -f k8s/niyyah.yaml`
Expected: no errors (`configured`/`unchanged` for each resource, dry-run)

- [ ] **Step 5: Generate the real deploy key and replace the placeholder**

Manually generate a read-only SSH deploy key (`ssh-keygen -t ed25519 -C "niyyah-vault-sync" -f niyyah-vault-deploy-key -N ""`), add the **public** half as a read-only Deploy Key on the GitLab `pkm/xarvis` project (Settings → Repository → Deploy keys), then replace the `VAULT_DEPLOY_KEY` placeholder in `k8s/niyyah.yaml` with the **private** key's contents. Replace `VAULT_SYNC_SECRET`'s placeholder with a real random value (e.g. `openssl rand -hex 32`) — this will also need to be entered into the GitLab webhook's secret token field in Step 8.

- [ ] **Step 6: Apply the manifest and confirm rollout**

Run: `kubectl diff -f k8s/niyyah.yaml` (review changes), then `kubectl apply -f k8s/niyyah.yaml -n niyyah`
Expected: `niyyah-config` secret updated, `niyyah-api` deployment updated (new volume/volumeMount) and rolls out cleanly (`kubectl rollout status deployment/niyyah-api -n niyyah`)

- [ ] **Step 7: Run the migration job against prod**

Run: `kubectl delete job/niyyah-migrate -n niyyah --ignore-not-found && kubectl apply -f k8s/migration-job.yaml -n niyyah && kubectl wait --for=condition=complete job/niyyah-migrate -n niyyah --timeout=60s`
Expected: job completes successfully; `vault_days`/`vault_block_votes` tables now exist in the prod DB.

- [ ] **Step 8: Wire the GitLab webhook**

In GitLab, go to the `pkm/xarvis` project → Settings → Webhooks. Add:
- URL: `https://niyyah-api.alamin.rocks/api/v1/vault/sync/webhook`
- Secret Token: the same value set for `VAULT_SYNC_SECRET` in Step 5
- Trigger: Push events
- SSL verification: enabled

Note: GitLab sends the secret via the `X-Gitlab-Token` header, not `X-Vault-Sync-Secret` — if using GitLab's native webhook secret field, update the `webhook_sync` endpoint's `Header(...)` parameter name in `apps/api/app/api/v1/vault.py` (Task 6) to `x_gitlab_token: str = Header(...)` before this step, or configure the webhook to send a custom `X-Vault-Sync-Secret` header instead if GitLab's version supports custom headers. Confirm which approach fits before wiring the webhook, and adjust the endpoint to match.

- [ ] **Step 9: End-to-end verification**

Trigger a manual sync: `curl -X POST https://niyyah-api.alamin.rocks/api/v1/vault/sync/webhook -H "X-Vault-Sync-Secret: <the real secret>"` (or `X-Gitlab-Token`, matching Step 8). Confirm the response shows `synced_days > 0` and `errors: []`. Load `https://niyyah.alamin.rocks/vault` and confirm real vault data renders. Push a trivial commit to the xarvis vault and confirm the webhook fires (GitLab project → Settings → Webhooks → Edit → recent deliveries) and the dashboard reflects the change after refresh.

- [ ] **Step 10: Commit, push, tag**

```bash
git add apps/api/Dockerfile k8s/niyyah.yaml
git commit -m "feat(vault): wire git + deploy key + vault env vars into k8s manifests"
git push
git tag -a v<next-semver> -m "Add vault votes dashboard: git-synced Datadog-style dashboard reflecting xarvis daily votes"
git push --tags
```

(pick `<next-semver>` per the repo's existing tag history — check `git tag --sort=-v:refname | head -1` first)

---

## Post-Implementation Checklist

- [ ] All backend tests pass: `cd apps/api && python -m pytest -v`
- [ ] Frontend type-checks clean: `cd apps/web && npx tsc --noEmit`
- [ ] `/vault` renders correctly in both light and dark theme
- [ ] Manual sync button on the dashboard works
- [ ] GitLab webhook delivers successfully on a real vault push
- [ ] `WORK_LOG.md` (or niyyah's equivalent) updated with the new feature and any open follow-ups (Efforts panel, Doctrine KRs — explicitly phase 2 per the design spec)
