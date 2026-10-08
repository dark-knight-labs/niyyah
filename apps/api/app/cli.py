"""Admin commands. Usage: python -m app.cli import-vault /path/to/vault --user me@example.com --replace"""
import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.user import User
from app.services.vault_import import import_vault


async def run_import(path: Path, email: str, replace: bool, session_factory=async_session) -> int:
    if not replace:
        print("Importing replaces this user's planner data. Pass --replace to confirm.", file=sys.stderr)
        return 1
    if not path.is_dir():
        print(f"{path} is not a directory", file=sys.stderr)
        return 1
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"no user with email {email}", file=sys.stderr)
            return 1
        today = datetime.now(ZoneInfo(settings.vault_tz)).date()
        report = await import_vault(db, user.id, path, today)
    for table, count in report.counts.items():
        print(f"{table}: {count}")
    for error in report.errors:
        print(f"warning: {error}", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import-vault", help="copy a vault checkout into the database for one user")
    imp.add_argument("path", type=Path)
    imp.add_argument("--user", required=True, help="email of the account that will own the data")
    imp.add_argument("--replace", action="store_true", help="confirm that the user's existing planner data is replaced")
    args = parser.parse_args(argv)
    return asyncio.run(run_import(args.path, args.user, args.replace))


if __name__ == "__main__":
    raise SystemExit(main())
