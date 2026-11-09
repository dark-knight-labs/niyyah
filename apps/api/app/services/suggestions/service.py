"""Suggestions: create a bundle, apply the lines the owner picks, reject it, undo it.

A bundle is a list of lines (registry.py). Nothing changes the plan until `apply`. Apply and undo commit themselves: a
failed apply has to be rolled back and then recorded in a second transaction. Everything below them only flushes.
"""
import json
import logging
import time
from collections.abc import Callable, Sequence
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pydantic import ValidationError
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.models.suggestion import SuggestionBundle, SuggestionChange
from app.models.user import User
from app.services.suggestions import registry, snapshot
from app.services.suggestions.registry import Ctx
from app.services.suggestions.snapshot import RowRef

log = logging.getLogger("app.suggestions")

OWNER = "owner"
MAX_LINES = 40
MAX_PENDING = 30
MAX_REASON_CHARS = 4000
UNDO_DAYS = 7
Check = Callable[[str], str | None]


class SuggestionError(ValueError):
    """Bad input, or a refusal by a check: nothing was changed (422)."""


class NotFound(LookupError):
    """No such bundle for this user (404)."""


class Conflict(ValueError):
    """The bundle is not in a state that allows this (409)."""


class ApplyFailed(SuggestionError):
    """A line failed: the whole apply was rolled back and the line is marked failed."""


_registered: list[Check] = []


def set_checks(checks: Sequence[Check]) -> None:
    """The checks of the loaded plugins (core/plugins.suggestion_checks). Set when the app starts: the last app created wins."""
    _registered[:] = checks


def _all_checks(extra: Sequence[Check]) -> list[Check]:
    """Registered checks always run; `checks=` arguments add to them, never replace them."""
    return [*_registered, *(c for c in extra if c not in _registered)]


def local_today() -> date:
    return datetime.now(ZoneInfo(settings.app_timezone)).date()


def _utc(value: datetime | None) -> datetime | None:
    return value if value is None or value.tzinfo else value.replace(tzinfo=timezone.utc)


def _plain(value):
    """What a JSON column hands back for this value: used to compare a stored base with a fresh one."""
    return json.loads(json.dumps(value, default=str))


# --- Lines ---------------------------------------------------------------------------------------------------------

def _refs_used(target: dict, payload: dict) -> list[str]:
    return [r for r in (target.get("ref"), payload.get("parent_ref")) if r is not None]


def _resolve(target: dict, payload: dict, created: dict[str, dict]) -> tuple[dict, dict]:
    """Swap {"ref"} in the target and `parent_ref` in the payload for the ids earlier lines created."""
    target, payload = dict(target), dict(payload)
    if target.get("ref") is not None:
        target = {"id": created[target["ref"]]["id"]}
    if payload.get("parent_ref") is not None:
        payload["parent_id"] = created[payload.pop("parent_ref")]["id"]
    return target, payload


def _texts(entry: registry.Entry, payload: dict) -> list[str]:
    out = []
    for name in entry.text_fields:
        value = payload.get(name)
        if isinstance(value, str):
            out.append(value)
        elif isinstance(value, list):
            out += [v["text"] for v in value if isinstance(v, dict) and isinstance(v.get("text"), str)]
    return out


def run_checks(checks: Sequence[Check], source: str, title: str, reason: str, lines: Sequence) -> None:
    """Every check over the title, the reason and every free-text field; the owner's own bundles are not filtered."""
    if source == OWNER or not checks:
        return
    for text in [title, reason, *(t for entry, payload in lines for t in _texts(entry, payload))]:
        for check in checks:
            message = check(text)
            if message is not None:
                raise SuggestionError(message)


def _parse(model, data, what: str):
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        raise SuggestionError(f"{what}{' ' + where if where else ''}: {first['msg']}") from exc


async def _prepare_line(ctx: Ctx, seq: int, raw: dict, defined: set[str]) -> SuggestionChange:
    where = f"line {seq}"
    entity, op = raw.get("entity"), raw.get("op")
    entry = registry.lookup(entity, op)
    if entry is None:
        raise SuggestionError(f"{where}: unknown change {entity}.{op}")
    target = _parse(entry.target_model, raw.get("target") or {}, f"{where} target")
    payload = _parse(entry.payload_model, raw.get("payload") or {}, f"{where} payload")
    target_d, payload_d = target.model_dump(exclude_none=True, mode="json"), payload.model_dump(exclude_unset=True, mode="json")
    ref = raw.get("ref")
    if ref is not None:
        if not isinstance(ref, str) or not registry.REF.match(ref) or (entity, op) != ("item", "create"):
            raise SuggestionError(f"{where}: only an item.create line has a ref of 1-8 letters, digits, - or _")
        if ref in defined:
            raise SuggestionError(f"{where}: ref '{ref}' is used twice")
    used = _refs_used(target_d, payload_d)
    for name in used:
        if name not in defined:
            raise SuggestionError(f"{where}: ref '{name}' is not made by an earlier line")
    base = None
    if entry.compares_base and not (target_d.get("ref") is not None):
        try:
            now = await entry.read_base(ctx, target, payload, False)
        except ValueError as exc:
            raise SuggestionError(f"{where}: {exc}") from exc
        if now is None:
            raise SuggestionError(f"{where}: its target was not found")
        given = raw.get("base")
        if given is not None:
            if not isinstance(given, dict) or set(given) != set(now):
                raise SuggestionError(f"{where}: base must have the fields {sorted(now)}")
            base = given
        else:
            base = now
    return SuggestionChange(seq=seq, op=op, entity=entity, target=target_d, payload=payload_d, base=base, ref=ref, status="pending")


# --- Create --------------------------------------------------------------------------------------------------------

async def _create(db, user_id: int, source: str, title: str, reason: str, lines: Sequence[dict], run_id: str | None,
                  today: date | None, checks: Sequence[Check]) -> SuggestionBundle:
    source, title, reason = (source or "").strip(), (title or "").strip(), (reason or "").strip()
    if not source or len(source) > 80:
        raise SuggestionError("source must be 1-80 characters")
    if not title or len(title) > 200:
        raise SuggestionError("title must be 1-200 characters")
    if len(reason) > MAX_REASON_CHARS:
        raise SuggestionError(f"reason is longer than {MAX_REASON_CHARS} characters")
    if run_id is not None and len(run_id) > 36:
        raise SuggestionError("run_id is longer than 36 characters")
    if not 1 <= len(lines) <= MAX_LINES:
        raise SuggestionError(f"a bundle has 1-{MAX_LINES} lines")
    # Count-then-insert would let two creates at once both pass: queue them per user on the user's row (NO KEY UPDATE, so
    # inserts that only reference the user are not held up). Postgres only; sqlite has one writer anyway.
    await db.execute(select(User.id).where(User.id == user_id).with_for_update(key_share=True))
    if await pending_count(db, user_id) >= MAX_PENDING:
        raise SuggestionError(f"{MAX_PENDING} suggestions are waiting: apply or reject some first")
    ctx = Ctx(db, user_id, today or local_today())
    changes, defined, checked = [], set(), []
    for seq, raw in enumerate(lines, start=1):
        change = await _prepare_line(ctx, seq, raw, defined)
        changes.append(change)
        if change.ref:
            defined.add(change.ref)
        checked.append((registry.lookup(change.entity, change.op), change.payload))
    run_checks(_all_checks(checks), source, title, reason, checked)
    await _rehearse(ctx, changes)
    bundle = SuggestionBundle(user_id=user_id, source=source, run_id=run_id, title=title, reason=reason, status="pending")
    db.add(bundle)
    await db.flush()
    for change in changes:
        change.bundle_id = bundle.id
    db.add_all(changes)
    await db.flush()
    return bundle


async def create(db, user_id: int, source: str, title: str, reason: str, lines: Sequence[dict], run_id: str | None = None, *,
                 today: date | None = None, checks: Sequence[Check] = ()) -> SuggestionBundle:
    """Add a bundle for a user from code (a plugin). Flushes; the caller commits. The source "owner" is the user's own."""
    if (source or "").strip() == OWNER:
        raise SuggestionError(f"the source '{OWNER}' is the signed-in user's own")
    return await _create(db, user_id, source, title, reason, lines, run_id, today, checks)


async def create_for_owner(db, user_id: int, title: str, reason: str, lines: Sequence[dict], run_id: str | None = None, *,
                           today: date | None = None) -> SuggestionBundle:
    return await _create(db, user_id, OWNER, title, reason, lines, run_id, today, ())


# --- Read ----------------------------------------------------------------------------------------------------------

async def _bundle(db, user_id: int, bundle_id: int, lock: bool = False) -> SuggestionBundle:
    query = select(SuggestionBundle).where(SuggestionBundle.id == bundle_id, SuggestionBundle.user_id == user_id)
    if lock:  # re-read the row, not the copy in the session: its status may have changed under us
        query = query.with_for_update().execution_options(populate_existing=True)
    row = (await db.execute(query)).scalar_one_or_none()
    if row is None:
        raise NotFound("no such suggestion")
    return row


async def _changes(db, bundle_id: int) -> list[SuggestionChange]:
    return list((await db.execute(select(SuggestionChange).where(SuggestionChange.bundle_id == bundle_id)
                                  .order_by(SuggestionChange.seq))).scalars().all())


async def get(db, user_id: int, bundle_id: int) -> tuple[SuggestionBundle, list[SuggestionChange]]:
    bundle = await _bundle(db, user_id, bundle_id)
    return bundle, await _changes(db, bundle.id)


async def list_bundles(db, user_id: int, status: str | None = None) -> list[tuple[SuggestionBundle, int]]:
    """Newest first, each with its number of lines."""
    query = select(SuggestionBundle).where(SuggestionBundle.user_id == user_id)
    if status:
        query = query.where(SuggestionBundle.status == status)
    bundles = list((await db.execute(query.order_by(SuggestionBundle.id.desc()))).scalars().all())
    counts = dict((await db.execute(select(SuggestionChange.bundle_id, func.count(SuggestionChange.id)).where(
        SuggestionChange.bundle_id.in_([b.id for b in bundles])).group_by(SuggestionChange.bundle_id))).all()) if bundles else {}
    return [(b, counts.get(b.id, 0)) for b in bundles]


async def pending_count(db, user_id: int) -> int:
    return (await db.execute(select(func.count(SuggestionBundle.id)).where(
        SuggestionBundle.user_id == user_id, SuggestionBundle.status == "pending"))).scalar_one()


# --- Apply ---------------------------------------------------------------------------------------------------------

class _Scope:
    """While a line applies: every row it writes must be one the entry named (else undo could not restore it), and no bulk
    UPDATE/DELETE runs. New rows are noted as created."""

    def __init__(self, db, allowed: set[RowRef]):
        self.session, self.allowed, self.created = db.sync_session, allowed, []

    def __enter__(self):
        event.listen(self.session, "after_flush", self._flush)
        event.listen(self.session, "do_orm_execute", self._execute)
        return self

    def __exit__(self, *exc):
        event.remove(self.session, "after_flush", self._flush)
        event.remove(self.session, "do_orm_execute", self._execute)

    def _flush(self, session, _ctx):
        fresh = [(o.__table__.name, o.id) for o in session.new if not o.__table__.name.startswith("suggestion_")]
        self.created += fresh
        self.allowed.update(fresh)  # a row this line made may be changed again by the same line
        for obj in [*(o for o in session.dirty if session.is_modified(o)), *session.deleted]:
            ref = (obj.__table__.name, obj.id)
            if ref not in self.allowed and not ref[0].startswith("suggestion_"):
                raise SuggestionError(f"a change reached a row outside its scope ({ref[0]} {ref[1]})")

    def _execute(self, state):
        if state.is_update or state.is_delete:
            raise SuggestionError("a bulk update or delete ran during apply")


def _delta(before: dict[RowRef, dict], after: dict[RowRef, dict]) -> list[dict]:
    """The rows that differ, as {t, id, kind, before, after}: what undo needs to put them back."""
    out = []
    for ref in sorted(set(before) | set(after)):
        b, a = before.get(ref), after.get(ref)
        if b == a:
            continue
        kind = "insert" if b is None else "delete" if a is None else "update"
        out.append({"t": ref[0], "id": ref[1], "kind": kind, "before": b, "after": a})
    return out


async def _apply_line(ctx: Ctx, change: SuggestionChange, created: dict[str, dict], dry: bool = False) -> bool:
    """Apply one line. False = stale (skipped, nothing written).

    `dry` is the create-time rehearsal: the same code runs (so it refuses what apply would refuse), but no row is locked and
    the line itself is left as it is; the caller rolls the writes back."""
    entry = registry.lookup(change.entity, change.op)
    assert entry is not None, f"{change.entity}.{change.op} is not in the registry"
    lock = not dry
    by_ref = change.target.get("ref") is not None
    target_raw, payload_raw = _resolve(change.target, change.payload, created)
    target = entry.target_model.model_validate(target_raw)
    payload = entry.payload_model.model_validate(payload_raw)
    if entry.compares_base and not by_ref:
        seen = await entry.read_base(ctx, target, entry.payload_model.model_validate(change.payload), lock)
        if seen is None or _plain(seen) != _plain(change.base):
            if not dry:
                change.status, change.error = "stale", "changed since this was suggested"
            return False
    touched = set(await entry.touched(ctx, target, payload, lock))
    before = await snapshot.read_rows(ctx.db, touched, lock=lock)
    with _Scope(ctx.db, touched) as scope:
        key = await entry.apply(ctx, target, payload)
        await ctx.db.flush()
    if change.ref and key:
        created[change.ref] = key
    if dry:
        return True
    after = await snapshot.read_rows(ctx.db, touched | set(scope.created))
    change.inverse = _delta(before, after)
    change.created_key = key
    change.status, change.error = "applied", None
    return True


class _Rehearsed(Exception):
    """Raised to leave the rehearsal's SAVEPOINT."""


async def _rehearse(ctx: Ctx, changes: Sequence[SuggestionChange]) -> None:
    """Run every line as apply would, in order, inside a SAVEPOINT that is always rolled back.

    Why this and not a `validate()` per entry: apply and create then share one code path, so create refuses a line with the
    message apply would give, and cannot drift from it when a service changes. It also sees what earlier lines of the bundle
    make (a new item, a moved stream). It is safe because the services only flush (nothing commits, nothing leaves the
    database) and `_Scope` already fences what a line may write."""
    created: dict[str, dict] = {}
    nested = await ctx.db.begin_nested()
    try:
        for change in changes:
            try:
                await _apply_line(ctx, change, created, dry=True)
            except IntegrityError as exc:
                raise SuggestionError(f"line {change.seq}: a unique rule would be broken by this change") from exc
            except ValueError as exc:
                raise SuggestionError(f"line {change.seq}: {exc}") from exc
    finally:
        await nested.rollback()


async def apply(db, user_id: int, bundle_id: int, lines: Sequence[int] | None = None, *, today: date,
                checks: Sequence[Check] = (), now: datetime | None = None) -> tuple[SuggestionBundle, list[SuggestionChange]]:
    """Apply the picked lines (all of them by default) in one transaction, in order; commits.

    A line whose base no longer matches is marked stale and skipped. Any error rolls everything back, marks that line
    failed in a second transaction and leaves the bundle pending (ApplyFailed)."""
    bundle = await _bundle(db, user_id, bundle_id, lock=True)
    if bundle.status != "pending":
        raise Conflict(f"this suggestion is {bundle.status}")
    changes = [c for c in await _changes(db, bundle.id)]
    seqs = {c.seq for c in changes}
    wanted = seqs if lines is None else set(lines)
    if not wanted or not wanted <= seqs:
        raise SuggestionError("pick at least one line of this suggestion")
    picked = [c for c in changes if c.seq in wanted and c.status in ("pending", "stale", "failed")]
    defined = {c.ref: c.seq for c in changes if c.ref}
    for change in picked:
        for name in _refs_used(change.target, change.payload):
            if defined[name] not in wanted:
                raise SuggestionError(f"line {change.seq} needs line {defined[name]}: pick it too")
    run_checks(_all_checks(checks), bundle.source, bundle.title, bundle.reason,
               [(registry.lookup(c.entity, c.op), c.payload) for c in picked])
    ctx, created, started = Ctx(db, user_id, today), {}, time.perf_counter()
    bundle_pk, current_id = bundle.id, None
    try:
        applied = 0
        for change in picked:
            current_id = change.id
            applied += await _apply_line(ctx, change, created)
        if applied:
            for change in changes:
                if change.status in ("pending", "failed") and change.seq not in wanted:
                    change.status = "skipped"
            everything = all(c.status == "applied" for c in changes)
            bundle.status = "applied" if everything else "partly_applied"
            bundle.decided_at = now or datetime.now(timezone.utc)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        message = str(exc) if isinstance(exc, ValueError) else (
            "a unique rule was broken by a change made at the same time" if isinstance(exc, IntegrityError) else f"unexpected error ({type(exc).__name__})")
        if not isinstance(exc, ValueError):
            log.exception("suggestions.apply bundle=%s failed", bundle_pk)
        if current_id is not None:
            # Re-take the bundle lock: it may have been rejected or applied by someone else since; only a pending one is marked.
            if (await _bundle(db, user_id, bundle_pk, lock=True)).status == "pending":
                row = await db.get(SuggestionChange, current_id)
                row.status, row.error = "failed", message[:500]
            await db.commit()
        raise ApplyFailed(message) from exc
    log.info("suggestions.apply bundle=%s lines=%s ms=%d", bundle_pk, len(picked), (time.perf_counter() - started) * 1000)
    return await get(db, user_id, bundle_pk)


# --- Reject --------------------------------------------------------------------------------------------------------

async def reject(db, user_id: int, bundle_id: int, *, now: datetime | None = None) -> tuple[SuggestionBundle, list[SuggestionChange]]:
    bundle = await _bundle(db, user_id, bundle_id, lock=True)
    if bundle.status != "pending":
        raise Conflict(f"this suggestion is {bundle.status}")
    bundle.status, bundle.decided_at = "rejected", now or datetime.now(timezone.utc)
    await db.commit()
    return await get(db, user_id, bundle_id)


# --- Undo ----------------------------------------------------------------------------------------------------------

# Where a table sits in a parent -> child order: children go first when rows are deleted, last when they are put back.
_RANK = {"vault_block_votes": 1}


def _rank(entry: dict) -> int:
    return _RANK.get(entry["t"], 0)


async def _line_undoable(db, user_id: int, rows: list[dict]) -> str | None:
    """None if every row of the line is still as apply left it; else why not."""
    current = await snapshot.read_rows(db, [(r["t"], r["id"]) for r in rows], lock=True)
    for r in rows:
        now = current.get((r["t"], r["id"]))
        if r["kind"] == "delete":
            if now is not None:
                return f"{r['t']} {r['id']} exists again"
        elif now != r["after"]:
            return f"{r['t']} {r['id']} changed since"
        if r["kind"] == "insert" and r["t"] == registry.TASKS and await registry.pointers_at_task(db, user_id, r["id"]):
            return f"item {r['id']} is used by something else now"
        if r["kind"] == "insert" and r["t"] == registry.QUARTERS and await registry.streams_in_quarter(
                db, user_id, r["after"]["label"], {x["id"] for x in rows if x["t"] == registry.STREAMS}):
            return f"quarter {r['after']['label']} has streams now"
    return None


async def _restore(db, rows: list[dict]) -> None:
    """Put one line's rows back. Order matters because of the unique week marker (one small domino per stream and week) and
    the parent link: created rows go, markers of restored rows are cleared, values are written, then markers come back."""
    created = sorted((r for r in rows if r["kind"] == "insert"), key=_rank, reverse=True)
    updated = [r for r in rows if r["kind"] == "update"]
    deleted = sorted((r for r in rows if r["kind"] == "delete"), key=_rank)
    for r in created:
        await snapshot.delete_row(db, r["t"], r["id"])
    await db.flush()
    for r in updated:
        if r["t"] == registry.TASKS:
            await snapshot.update_row(db, r["t"], r["id"], {"focus_week": None})
    for r in deleted:
        await snapshot.insert_row(db, r["t"], {**r["before"], **({"focus_week": None} if r["t"] == registry.TASKS else {})})
    await db.flush()
    for r in updated:
        await snapshot.update_row(db, r["t"], r["id"], r["before"])
    await db.flush()
    for r in deleted:
        if r["t"] == registry.TASKS and r["before"].get("focus_week") is not None:
            await snapshot.update_row(db, r["t"], r["id"], {"focus_week": r["before"]["focus_week"]})
    await db.flush()


async def undo(db, user_id: int, bundle_id: int, *, now: datetime | None = None) -> tuple[SuggestionBundle, list[SuggestionChange]]:
    """Put back what an applied bundle changed, line by line from the last, within 7 days.

    A line is restored only if every row it changed is still as the apply left it; otherwise it stays as it is and says why."""
    bundle = await _bundle(db, user_id, bundle_id, lock=True)
    if bundle.status not in ("applied", "partly_applied"):
        raise Conflict(f"this suggestion is {bundle.status}")
    now = now or datetime.now(timezone.utc)
    if _utc(bundle.decided_at) + timedelta(days=UNDO_DAYS) < now:
        raise Conflict(f"a suggestion can be undone for {UNDO_DAYS} days")
    changes = await _changes(db, bundle.id)
    try:
        for change in reversed(changes):
            if change.status != "applied":
                continue
            rows = change.inverse or []
            why = await _line_undoable(db, user_id, rows)
            if why is not None:
                change.error = f"left as it is: {why}"
                continue
            await _restore(db, rows)
            change.status, change.error = "undone", None
        if all(c.status in ("undone", "skipped", "stale", "failed", "pending") for c in changes):
            bundle.status = "undone"
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if not isinstance(exc, ValueError):
            log.exception("suggestions.undo bundle=%s failed", bundle_id)
        raise SuggestionError(str(exc) if isinstance(exc, ValueError) else f"unexpected error ({type(exc).__name__})") from exc
    return await get(db, user_id, bundle_id)
