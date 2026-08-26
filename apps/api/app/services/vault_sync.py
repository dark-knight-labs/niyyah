import asyncio
import shutil
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
            # Stale/broken checkout — wipe it so `git clone` (which refuses to
            # clone into a non-empty directory) can actually recover below.
            shutil.rmtree(path, ignore_errors=True)

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

        try:
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

            # A re-sync must remove votes for blocks no longer present in the note
            # (e.g. mode changed full -> off, or a callout was deleted) — otherwise
            # day.total (from parsed.total) desyncs from the sum of stored rows,
            # and /streaks' "absent means not stored" invariant breaks.
            for block, vote in existing_votes.items():
                if block not in parsed.blocks:
                    await db.delete(vote)

            # Commit per day (not once at the end) so that one day's DB-write
            # failure can be rolled back and reported without discarding every
            # other day already processed in this run.
            await db.commit()
            result.synced_days += 1
        except Exception as exc:  # a single bad day's write must not abort the whole sync
            await db.rollback()
            result.errors.append(f"{note_path.name}: db write failed: {exc}")

    return result
