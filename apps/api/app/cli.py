"""Admin commands. Usage: python -m app.cli import-snapshot export.json --user me@example.com --replace"""
import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session
from app.models.user import User
from app.schemas.snapshot import Snapshot
from app.services import plan_v2_migrate, plan_v3_migrate, tree_shadow
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


async def run_plan_v2_migrate(user: int | None, all_users: bool, do_apply: bool, journal: Path | None, overrides: Path | None,
                              revert: Path | None, session_factory=async_session, today=None) -> int:
    """Plan v2 data migration (see app/services/plan_v2_migrate.py). Dry run unless --apply; --revert undoes a journal."""
    mode = "APPLY" if do_apply else "DRY RUN"
    if revert is not None:
        if user is not None or all_users or journal is not None or overrides is not None:
            print("--revert takes only the journal (and --apply)", file=sys.stderr)
            return 1
        try:
            entries = json.loads(revert.read_text(encoding="utf-8"))
            entries["user"], entries["created"], entries["updates"]
            [c["snapshot"] for c in entries["created"]]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"cannot read journal {revert}: {exc}", file=sys.stderr)
            return 1
        async with session_factory() as db:
            lines, changed = await plan_v2_migrate.revert(db, entries, do_apply)
            if do_apply:
                await db.commit()
            else:
                await db.rollback()
        print(f"{mode} revert of {revert} (user {entries['user']})")
        for line in lines:
            print(f"  {line}")
        print(f"TOTAL {changed} changes" + ("" if do_apply else " (dry run; pass --apply to write)"))
        return 0
    if (user is None) == (not all_users):
        print("give --user N or --all", file=sys.stderr)
        return 1
    if all_users and (journal is not None or overrides is not None):
        print("--journal and --overrides are per user: use --user", file=sys.stderr)
        return 1
    today = today or datetime.now(ZoneInfo(settings.app_timezone)).date()
    try:
        rules = plan_v2_migrate.read_overrides(str(overrides) if overrides else None)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    plans = []
    async with session_factory() as db:
        users = await _tree_users(db, user)
    for uid in users:
        async with session_factory() as db:  # one transaction per user
            try:
                p = await plan_v2_migrate.plan(db, uid, today, rules)
            except ValueError as exc:
                await db.rollback()
                print(f"user {uid}: refused before writing anything: {exc}", file=sys.stderr)
                return 1
            print(f"{mode} user {uid}")
            for line in p.lines:
                print(f"  {line}")
            print(f"  user {uid}: {p.changes} changes" + (f", {p.drift} label/checkpoint disagreements left as they are" if p.drift else ""))
            if do_apply and p.changes:
                path = journal or Path(f"plan-v2-migrate-{uid}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
                wrote = False
                try:
                    entries = await plan_v2_migrate.apply(db, p)
                    with open(path, "x", encoding="utf-8") as fh:  # written before the commit
                        wrote = True
                        json.dump(entries, fh, indent=2, ensure_ascii=False, default=str)
                except Exception as exc:  # before the commit: nothing landed, so the half-written journal is worthless
                    await db.rollback()
                    if wrote:
                        Path(path).unlink(missing_ok=True)
                    print(f"user {uid}: failed before the commit, nothing written: {exc}", file=sys.stderr)
                    return 1
                try:
                    await db.commit()
                except Exception as exc:  # the commit may or may not have landed: keep the journal, marked, rather than lose the way back
                    await db.rollback()
                    try:
                        Path(path).rename(f"{path}.uncertain")
                        print(f"journal kept as {path}.uncertain: check the data, then revert with it if the run did land", file=sys.stderr)
                    except OSError as rename_error:  # never let this hide the commit error below
                        print(f"could not rename the journal {path}: {rename_error}", file=sys.stderr)
                    print(f"user {uid}: commit failed: {exc}", file=sys.stderr)
                    return 1
                print(f"  journal: {path}")
            else:
                await db.rollback()
        plans.append(p)
    print(f"TOTAL {sum(p.changes for p in plans)} changes" + ("" if do_apply else " (dry run; pass --apply to write)"))
    print(plan_v2_migrate.add_summaries(plans))
    return 0


async def run_plan_v3_migrate(user: int | None, do_apply: bool, journal: Path | None, habit_goals: Path | None, revert: Path | None,
                              session_factory=async_session, today=None) -> int:
    """Plan v3 data migration (see app/services/plan_v3_migrate.py). Dry run unless --apply; --revert undoes a journal."""
    mode = "APPLY" if do_apply else "DRY RUN"
    if revert is not None:
        if user is not None or journal is not None or habit_goals is not None:
            print("--revert takes only the journal (and --apply)", file=sys.stderr)
            return 1
        try:
            entries = json.loads(revert.read_text(encoding="utf-8"))
            entries["user"], entries["created"], entries["updates"]
            [c["snapshot"] for c in entries["created"]]
        except (OSError, ValueError, KeyError, TypeError) as exc:
            print(f"cannot read journal {revert}: {exc}", file=sys.stderr)
            return 1
        async with session_factory() as db:
            lines, changed = await plan_v3_migrate.revert(db, entries, do_apply)
            if do_apply:
                await db.commit()
            else:
                await db.rollback()
        print(f"{mode} revert of {revert} (user {entries['user']})")
        for line in lines:
            print(f"  {line}")
        print(f"TOTAL {changed} changes" + ("" if do_apply else " (dry run; pass --apply to write)"))
        return 0
    if user is None:
        print("give --user N", file=sys.stderr)
        return 1
    today = today or datetime.now(ZoneInfo(settings.app_timezone)).date()
    try:
        goals = plan_v3_migrate.read_habit_goals(str(habit_goals) if habit_goals else None)
    except ValueError as exc:
        print(exc, file=sys.stderr)
        return 1
    async with session_factory() as db:
        try:
            p = await plan_v3_migrate.plan(db, user, today, goals)
        except ValueError as exc:
            await db.rollback()
            print(f"user {user}: refused before writing anything: {exc}", file=sys.stderr)
            return 1
        print(f"{mode} user {user}")
        for line in p.lines:
            print(f"  {line}")
        print(f"  user {user}: {p.changes} changes")
        if do_apply and p.changes:
            path = journal or Path(f"plan-v3-migrate-{user}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
            wrote = False
            try:
                entries = await plan_v3_migrate.apply(db, p)
                with open(path, "x", encoding="utf-8") as fh:  # written before the commit
                    wrote = True
                    json.dump(entries, fh, indent=2, ensure_ascii=False, default=str)
            except Exception as exc:  # before the commit: nothing landed, so the half-written journal is worthless
                await db.rollback()
                if wrote:
                    Path(path).unlink(missing_ok=True)
                print(f"user {user}: failed before the commit, nothing written: {exc}", file=sys.stderr)
                return 1
            try:
                await db.commit()
            except Exception as exc:  # the commit may or may not have landed: keep the journal, marked, rather than lose the way back
                await db.rollback()
                try:
                    Path(path).rename(f"{path}.uncertain")
                    print(f"journal kept as {path}.uncertain: check the data, then revert with it if the run did land", file=sys.stderr)
                except OSError as rename_error:  # never let this hide the commit error below
                    print(f"could not rename the journal {path}: {rename_error}", file=sys.stderr)
                print(f"user {user}: commit failed: {exc}", file=sys.stderr)
                return 1
            print(f"  journal: {path}")
        else:
            await db.rollback()
    print(f"TOTAL {p.changes} changes" + ("" if do_apply else " (dry run; pass --apply to write)"))
    print(p.summary())
    return 0


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
    mig = sub.add_parser("plan-v2-migrate", help="Plan v2: month labels, checkpoint lines as tasks, goal_ref (dry run unless --apply)")
    mig.add_argument("--user", type=int, help="user id")
    mig.add_argument("--all", action="store_true", help="every user")
    mig.add_argument("--apply", action="store_true", help="write the changes (default: only print them)")
    mig.add_argument("--journal", type=Path, help="where --apply writes the journal (default ./plan-v2-migrate-<user>-<UTC time>.json)")
    mig.add_argument("--overrides", type=Path, help='JSON {"match": {"<line id>": <item id>}, "skip": ["<line id>"]}')
    mig.add_argument("--revert", type=Path, help="undo a journal (dry run unless --apply)")
    v3 = sub.add_parser("plan-v3-migrate", help="Plan v3: products from the tags in use, habit goal links (dry run unless --apply)")
    v3.add_argument("--user", type=int, help="user id")
    v3.add_argument("--apply", action="store_true", help="write the changes (default: only print them)")
    v3.add_argument("--journal", type=Path, help="where --apply writes the journal (default ./plan-v3-migrate-<user>-<UTC time>.json)")
    v3.add_argument("--habit-goals", type=Path, help='JSON {"<habit id>": "<goal line id>"}: link habits to goals of this quarter')
    v3.add_argument("--revert", type=Path, help="undo a journal (dry run unless --apply)")
    args = parser.parse_args(argv)
    if args.command == "tree-rebuild":
        return asyncio.run(run_tree_rebuild(args.user))
    if args.command == "tree-check":
        return asyncio.run(run_tree_check(args.user))
    if args.command == "plan-v2-migrate":
        return asyncio.run(run_plan_v2_migrate(args.user, args.all, args.apply, args.journal, args.overrides, args.revert))
    if args.command == "plan-v3-migrate":
        return asyncio.run(run_plan_v3_migrate(args.user, args.apply, args.journal, args.habit_goals, args.revert))
    return asyncio.run(run_import(args.path, args.user, args.replace))


if __name__ == "__main__":
    raise SystemExit(main())
