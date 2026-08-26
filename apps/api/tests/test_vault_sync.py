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
async def test_resync_deletes_votes_for_blocks_no_longer_in_note(tmp_path, db_session, monkeypatch):
    # DAY_1 (below) has both soul and body blocks; the re-synced version only has soul
    # (simulating a mode change, e.g. full -> off, or someone editing the callout out).
    two_block_day = """---
mode: full
possible: 21
---
> [!soul]+ Soul
> - [x] ⭐⭐ Prayed 5x Fard + Sunnah

> [!body]+ Body
> - [x] ⭐ Walk / 20min bodyweight
"""
    one_block_day = """---
mode: off
possible: 2
---
> [!soul]+ Soul
> - [x] ⭐⭐ Prayed 5x Fard + Sunnah
"""
    repo_dir = tmp_path / "gitlab-xarvis"
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": two_block_day})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))
    workdir = str(tmp_path / "work")

    result = await vault_sync.sync_vault(db_session, workdir=workdir)
    assert result.errors == []

    day = (await db_session.execute(
        VaultDay.__table__.select().where(VaultDay.date == date(2026, 8, 20))
    )).first()
    votes = (await db_session.execute(
        VaultBlockVote.__table__.select().where(VaultBlockVote.vault_day_id == day.id)
    )).fetchall()
    assert {v.block for v in votes} == {"soul", "body"}

    # Now the note changes to drop the "body" block entirely; re-sync from that repo.
    (repo_dir / "Calendar" / "Daily" / "2026-08-20.md").write_text(one_block_day, encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "--quiet", "-m", "drop body block"], cwd=repo_dir, check=True)

    result = await vault_sync.sync_vault(db_session, workdir=workdir)
    assert result.errors == []

    day = (await db_session.execute(
        VaultDay.__table__.select().where(VaultDay.date == date(2026, 8, 20))
    )).first()
    votes = (await db_session.execute(
        VaultBlockVote.__table__.select().where(VaultBlockVote.vault_day_id == day.id)
    )).fetchall()
    assert {v.block for v in votes} == {"soul"}
    assert day.total == 2  # sum of remaining blocks, matching parsed.total


@pytest.mark.asyncio
async def test_sync_recovers_from_broken_checkout_by_reclone(tmp_path, db_session, monkeypatch):
    gitlab_repo = _make_repo(tmp_path, "gitlab-xarvis", {"2026-08-20.md": DAY_1})
    monkeypatch.setattr(settings, "vault_gitlab_url", gitlab_repo)
    monkeypatch.setattr(settings, "vault_github_url", str(tmp_path / "unused"))

    # Simulate a broken/stale checkout: a workdir whose .git is garbage, so
    # `git pull --ff-only` fails. Before the fix, the fallback `git clone`
    # would then refuse to clone into this still-non-empty directory forever.
    workdir = tmp_path / "work"
    (workdir / ".git").mkdir(parents=True)
    (workdir / ".git" / "garbage").write_text("not a real git repo", encoding="utf-8")
    (workdir / "some-leftover-file.txt").write_text("stale", encoding="utf-8")

    result = await vault_sync.sync_vault(db_session, workdir=str(workdir))

    assert result.errors == []
    assert result.synced_days == 1
    day = (await db_session.execute(
        VaultDay.__table__.select().where(VaultDay.date == date(2026, 8, 20))
    )).first()
    assert day is not None


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
