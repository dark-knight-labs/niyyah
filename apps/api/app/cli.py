"""Admin commands. Usage: python -m app.cli import-snapshot export.json --user me@example.com --replace"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select

from app.core.database import async_session
from app.models.user import User
from app.schemas.snapshot import Snapshot
from app.services.planner_import import import_snapshot


async def run_import(path: Path, email: str, replace: bool, session_factory=async_session) -> int:
    if not replace:
        print("Importing replaces this user's planner data. Pass --replace to confirm.", file=sys.stderr)
        return 1
    try:
        snapshot = Snapshot.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ValidationError) as exc:
        print(f"cannot read {path}: {exc}", file=sys.stderr)
        return 1
    async with session_factory() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"no user with email {email}", file=sys.stderr)
            return 1
        try:
            counts = await import_snapshot(db, user.id, snapshot)
            await db.commit()
        except ValueError as exc:
            await db.rollback()
            print(f"import refused: {exc}", file=sys.stderr)
            return 1
    for table, count in counts.items():
        print(f"{table}: {count}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import-snapshot", help="load an export snapshot (JSON) into one user's account")
    imp.add_argument("path", type=Path)
    imp.add_argument("--user", required=True, help="email of the account that will own the data")
    imp.add_argument("--replace", action="store_true", help="confirm that the user's existing planner data is replaced")
    args = parser.parse_args(argv)
    return asyncio.run(run_import(args.path, args.user, args.replace))


if __name__ == "__main__":
    raise SystemExit(main())
