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
from app.services import tree_shadow
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


async def _tree_users(db, user: int | None) -> list[int]:
    if user is not None:
        return [user]
    return list((await db.execute(select(User.id).order_by(User.id))).scalars().all())


async def run_tree_rebuild(user: int | None, session_factory=async_session) -> int:
    """Rebuild the shadow item tree from the legacy quarter tables. Writes planner_areas and planner_items only."""
    async with session_factory() as db:
        for uid in await _tree_users(db, user):
            stats = await tree_shadow.rebuild(db, uid)
            await db.commit()
            print(f"user {uid}: " + ", ".join(f"{k} {v}" for k, v in stats.items()))
    return 0


async def run_tree_check(user: int | None, session_factory=async_session) -> int:
    """Compare the shadow tree with legacy. Read-only. Exit 1 on any difference."""
    bad = 0
    async with session_factory() as db:
        for uid in await _tree_users(db, user):
            diffs = await tree_shadow.compare(db, uid)
            print(f"user {uid}: " + ("equal" if not diffs else f"{len(diffs)} differences"))
            for d in diffs:
                print(f"  {d}")
            bad += bool(diffs)
        await db.rollback()
    return 1 if bad else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    imp = sub.add_parser("import-snapshot", help="load an export snapshot (JSON) into one user's account")
    imp.add_argument("path", type=Path)
    imp.add_argument("--user", required=True, help="email of the account that will own the data")
    imp.add_argument("--replace", action="store_true", help="confirm that the user's existing planner data is replaced")
    for name, text in (("tree-rebuild", "rebuild the shadow item tree from the legacy quarter tables"),
                       ("tree-check", "compare the shadow item tree with legacy (read-only; exit 1 on any difference)")):
        cmd = sub.add_parser(name, help=text)
        who = cmd.add_mutually_exclusive_group(required=True)
        who.add_argument("--user", type=int, help="user id")
        who.add_argument("--all", action="store_true", help="every user")
    args = parser.parse_args(argv)
    if args.command == "tree-rebuild":
        return asyncio.run(run_tree_rebuild(args.user))
    if args.command == "tree-check":
        return asyncio.run(run_tree_check(args.user))
    return asyncio.run(run_import(args.path, args.user, args.replace))


if __name__ == "__main__":
    raise SystemExit(main())
