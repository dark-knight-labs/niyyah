"""Commit and push edits to the vault checkout.

The checkout is a mirror of the remote, so each attempt starts from origin/main (hard reset),
re-applies the edits to fresh content, commits and pushes. A rejected push (someone else, e.g.
Obsidian Git, pushed first) just means: start the attempt again. No merges, no conflicts.
"""
import fcntl
import subprocess
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path

from app.core.config import settings

ATTEMPTS = 3
Edit = Callable[[str | None], str]  # existing content (None when the file is new) -> new content


class VaultWriteError(Exception):
    """The edit could not be saved to the vault; the message is safe to show."""


def _git(args: list[str], cwd: Path) -> str:
    done = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise subprocess.CalledProcessError(done.returncode, args, done.stdout, done.stderr)
    return done.stdout.strip()


@contextmanager
def vault_lock(workdir: Path) -> Iterator[None]:
    """One writer or syncer at a time, across API pods that share the checkout volume.

    The lock file sits beside the checkout, not inside it, so it survives the checkout being wiped and re-cloned.
    """
    workdir.parent.mkdir(parents=True, exist_ok=True)
    with open(workdir.parent / f".{workdir.name}.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def commit_edits(edits: dict[str, Edit], message: str, workdir: str | None = None) -> str:
    """Apply `edits` ({vault-relative path: function}) and push them as one commit. Returns the commit hash."""
    root = Path(workdir or settings.vault_workdir)
    if not (root / ".git").exists():
        raise VaultWriteError("the vault checkout is not ready yet; sync it first")

    last_error = ""
    with vault_lock(root):
        for _ in range(ATTEMPTS):
            try:
                _git(["fetch", "origin", "main"], root)
                _git(["reset", "--hard", "origin/main"], root)
                for rel, edit in edits.items():
                    path = root / rel
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(edit(path.read_text(encoding="utf-8") if path.exists() else None), encoding="utf-8")
                    _git(["add", rel], root)
                if not _git(["status", "--porcelain"], root):
                    return _git(["rev-parse", "--short", "HEAD"], root)  # nothing changed
                _git(["-c", f"user.name={settings.vault_git_name}", "-c", f"user.email={settings.vault_git_email}",
                      "commit", "-q", "-m", message], root)
                _git(["push", "origin", "HEAD:main"], root)
                return _git(["rev-parse", "--short", "HEAD"], root)
            except subprocess.CalledProcessError as exc:
                last_error = (exc.stderr or exc.stdout or "").strip()
                if "denied" in last_error.lower() or "permission" in last_error.lower() or "not allowed" in last_error.lower():
                    raise VaultWriteError("the vault key may not push to the vault") from exc
    raise VaultWriteError(f"could not save to the vault after {ATTEMPTS} tries: {last_error[-200:]}")
