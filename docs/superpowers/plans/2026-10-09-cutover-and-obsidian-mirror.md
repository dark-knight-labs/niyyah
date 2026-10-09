> **Superseded in part (2026-10-09).** The owner moved Obsidian out of Niyyah into a separate private service. Only Task 1 (goals editor) and the cutover tasks (9, 10) still apply. Tasks 2 to 8 (export tables, renderers, dirty listener, in-API exporter) move to the private `niyyah-obsidian` repo, and core gets the export endpoint and API tokens instead. See the revised spec; a new plan will replace this one.

# Cutover to the database and the optional Obsidian mirror (storage phase 5a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A goals editor in the app, an optional exporter that mirrors the owner's data into the xarvis vault (database to vault only, with drift detection), and a rehearsed runbook for switching production to the database.

**Architecture:** Two new tables (`planner_export_state`, `planner_export_dirty`). A SQLAlchemy `before_flush` listener marks what changed. `obsidian_export.run_once` renders each dirty item from the database, checks the target file for drift, and writes everything in one commit through the existing `vault_git.commit_edits`. Files the app generates completely (pipeline, notebook, objectives, quarter, goals) are rewritten whole; daily notes are edited surgically so the owner's template survives. All of it is inert unless `OBSIDIAN_EXPORT_USER` is set.

**Tech Stack:** FastAPI, SQLAlchemy 2 async (sync `Session` events), Alembic, pytest-asyncio, git; Next.js for the Settings sections.

Spec: `docs/superpowers/specs/2026-10-09-cutover-and-obsidian-mirror-design.md`.

## Global Constraints

- API in `/home/ubuntu/src/dark-knight/niyyah/apps/api`; tests `/tmp/niyyah-oss-venv/bin/python -m pytest -q` (235 pass today; if the venv is gone rebuild it from `requirements-dev.txt`). **Never run two pytest processes at once.** Web checks `../../node_modules/.bin/tsc --noEmit -p .` and `next build` in `apps/web`.
- Default behaviour does not change: with `OBSIDIAN_EXPORT_USER` empty nothing is marked, exported or shown, and `STORAGE_BACKEND` stays `vault` until Task 10.
- The core app never imports anything Obsidian-specific except through `app/services/obsidian_*.py` and the one registration line in `app/main.py`.
- A database write must never fail or wait because of the mirror: dirty marking only adds rows in the same transaction, and the exporter runs outside requests.
- `commit_edits` takes the vault file lock itself; never take `vault_lock` around it (it would deadlock).
- Branch `feature/obsidian-mirror` from `main`. Commit after each task, no AI attribution lines. Do not push or touch production until Task 10, which needs the owner's explicit go-ahead.
- Migrations are not run by CI; Task 10 lists the manual steps.

## File Structure

| File | Responsibility |
|---|---|
| `app/models/planner.py`, `alembic/versions/a3c5e7f90124_export_tables.py` | `PlannerExportState`, `PlannerExportDirty` |
| `app/core/config.py` | `obsidian_export_user`, `obsidian_export_interval` |
| `app/services/planner_config.py`, `app/schemas/vault.py`, `app/api/v1/vault.py` | goals replace + endpoint |
| `web/src/components/settings/goals-section.tsx`, `settings/page.tsx`, `lib/vault-api.ts`, `lib/vault-types.ts` | Goals in Settings |
| `app/services/vault_objectives.py` | extract `render_objectives` (pure refactor) |
| `app/services/obsidian_render.py` | whole-file renderers |
| `app/services/obsidian_daily.py` | surgical daily-note editor and its managed view |
| `app/services/obsidian_dirty.py` | the flush listener |
| `app/services/obsidian_export.py` | `run_once`, drift, resolve, loop |
| `app/api/v1/obsidian.py` | status, run, resolve endpoints |
| `app/services/vault_import.py` | baseline hashes |
| `web/src/components/settings/obsidian-section.tsx` | status and drift actions |
| `tests/test_goals_config.py`, `test_obsidian_render.py`, `test_obsidian_daily.py`, `test_obsidian_dirty.py`, `test_obsidian_export.py`, `test_cutover_rehearsal.py` | tests |
| `docs/cutover-runbook.md` | the runbook |

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

### Task 2: Export tables, config and migration

**Files:** modify `app/models/planner.py`, `app/core/config.py`; create `alembic/versions/a3c5e7f90124_export_tables.py`. Test `tests/test_planner_models.py` (extend).
**Interfaces:** Produces `PlannerExportState(user_id, path, sha, state, error, updated_at)` unique `(user_id, path)`; `PlannerExportDirty(user_id, kind, key, marked_at)` (no unique constraint: duplicates are allowed and merged by the exporter); settings `obsidian_export_user: str = ""`, `obsidian_export_interval: int = 60`.

- [ ] **Step 1:** Append to `tests/test_planner_models.py`:

```python
@pytest.mark.asyncio
async def test_export_rows_round_trip_and_state_is_unique_per_file():
    from app.models.planner import PlannerExportDirty, PlannerExportState
    async with TestSession() as db:
        db.add_all([PlannerExportState(user_id=1, path="Calendar/Goals.md", sha="abc", state="ok"),
                    PlannerExportDirty(user_id=1, kind="goals", key=""), PlannerExportDirty(user_id=1, kind="goals", key="")])
        await db.commit()
        db.add(PlannerExportState(user_id=1, path="Calendar/Goals.md", sha="def", state="ok"))
        with pytest.raises(IntegrityError):
            await db.commit()
```

- [ ] **Step 2:** Run (fails: ImportError). **Step 3:** Append to `planner.py` (add `DateTime` to the sqlalchemy import and `from datetime import datetime, timezone`):

```python
def _now() -> datetime:
    return datetime.now(timezone.utc)


class PlannerExportState(Base):
    """What the Obsidian mirror last wrote to one vault file, so a change made in Obsidian shows up as drift."""
    __tablename__ = "planner_export_state"
    __table_args__ = (UniqueConstraint("user_id", "path", name="uq_planner_export_state"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    sha: Mapped[str | None] = mapped_column(String(64), nullable=True)  # None = overwrite the next time
    state: Mapped[str] = mapped_column(String(10), default="ok", nullable=False)  # ok | drift | error | ignored
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class PlannerExportDirty(Base):
    """Something the mirror still has to write: a day, a stream's pipeline or notebook, a week, a quarter, the goals."""
    __tablename__ = "planner_export_dirty"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = _owner()
    kind: Mapped[str] = mapped_column(String(12), nullable=False)  # day | pipeline | notebook | objectives | quarter | goals
    key: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    marked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
```

In `config.py` after `storage_backend` add:

```python
    # Optional Obsidian mirror: the email of the one account whose data is written into the vault checkout. Empty = off.
    obsidian_export_user: str = ""
    obsidian_export_interval: int = 60
```

Migration `alembic/versions/a3c5e7f90124_export_tables.py` (revision `a3c5e7f90124`, down `f2b4d6a8c013`; confirm with `PYTHONPATH=. alembic heads`) creating both tables with the columns above, the unique constraint, and indexes `ix_planner_export_state_user_id` and `ix_planner_export_dirty_user_id`; downgrade drops both. Add `PlannerExportState, PlannerExportDirty` to the `USER_TABLES` tuple in `vault_import.py`. Verify on Postgres as before (`upgrade head`, `downgrade -1`, `upgrade head`, `alembic check`).
- [ ] **Step 4:** Run the models tests; commit `Add the export state and dirty tables`.

---

### Task 3: Whole-file renderers

**Files:** modify `app/services/vault_objectives.py`; create `app/services/obsidian_render.py`. Test `tests/test_obsidian_render.py`.
**Interfaces:** Produces `vault_objectives.render_objectives(day, items, names) -> str` (pure; `update_objective` now calls it) and, in `obsidian_render`: `pipeline_note(stream, name, items)`, `notebook_note(stream, name, entries)`, `objectives_note(day, items, streams)`, `quarter_note(label, quarter, streams)`, `goals_note(goals)`; each returns the whole file text. Inputs are the ORM rows (duck-typed by attribute).

- [ ] **Step 1: Refactor.** In `vault_objectives.update_objective` replace everything after the `if checkpoint is not None:` block with `return render_objectives(day, items, {s.id: s.name for s in wanted})` and add above it:

```python
def render_objectives(day: date, items: list[dict], names: dict[str, str]) -> str:
    """The whole weekly note for the week holding `day`: one line per weekly stream."""
    start, end, label = week_for(day)
    number = label.split("-W")[1]
    rows = []
    for i in items:
        tail = f" {i['text']}" if i["text"] else ""
        if i["text"] and i["checkpoint"]:
            tail += f" #{i['checkpoint']}"
        rows.append(f"- **{names[i['stream']]}**{' ✓' if i['done'] else ''}:{tail}")
    head = ["---", "type: weekly-objectives", f"week: {int(number)}", f"period: {start.isoformat()}/{end.isoformat()}", "---",
            f"# Objectives — W{number}", ""]
    return "\n".join([*head, *rows, ""])
```

Run `tests/test_vault_objectives.py` (unchanged behaviour).

- [ ] **Step 2: Failing tests** `tests/test_obsidian_render.py` (round trips through the existing parsers, using the fixture vault imported into the database):

```python
from datetime import date

import pytest
from sqlalchemy import select

from app.models.planner import Goal, NotebookEntry, PipelineItem, Quarter, QuarterStream, WeekObjective
from app.services import obsidian_render as R
from app.services.vault_import import import_vault
from app.services.vault_notebook import parse_notebook
from app.services.vault_objectives import parse_objectives, week_for
from app.services.vault_goals import parse_goals
from app.services.vault_pipeline import parse_pipeline
from app.services.vault_quarter import load_streams, parse_quarter, quarter_for
from tests.conftest import TestSession
from tests.vault_fixture import build_vault

TODAY = date(2026, 10, 7)


def _strip_pipeline(items):
    return [{k: v for k, v in i.items() if k not in ("line", "hash", "age_days", "stale")} for i in items]


@pytest.fixture
async def imported(tmp_path):
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        await import_vault(db, 1, tmp_path, TODAY)
        yield db, tmp_path


async def rows(db, model, **where):
    return list((await db.execute(select(model).filter_by(user_id=1, **where).order_by(model.position if hasattr(model, "position") else model.id))).scalars())


@pytest.mark.asyncio
async def test_pipeline_note_round_trips(imported):
    db, root = imported
    original = parse_pipeline((root / "Efforts/Pipeline/kahf.md").read_text(), TODAY)
    out = R.pipeline_note("kahf", "Kahf", await rows(db, PipelineItem, stream="kahf"))
    assert _strip_pipeline(parse_pipeline(out, TODAY)) == _strip_pipeline(original)
    assert "mirror: niyyah" in out


@pytest.mark.asyncio
async def test_notebook_note_round_trips(imported):
    db, root = imported
    original = parse_notebook((root / "Efforts/Streams/kahf.md").read_text())
    out = R.notebook_note("kahf", "Kahf", await rows(db, NotebookEntry, stream="kahf"))
    strip = lambda es: [{k: v for k, v in e.items() if k not in ("line", "hash")} for e in es]  # noqa: E731
    assert strip(parse_notebook(out)) == strip(original)


@pytest.mark.asyncio
async def test_objectives_note_round_trips(imported):
    db, root = imported
    label = week_for(TODAY)[2]
    streams = load_streams((root / f"Calendar/Quarterly/{quarter_for(TODAY)}.md").read_text())
    original = parse_objectives((root / f"Calendar/Weekly/Objectives/{label}.md").read_text(), streams)
    stored = {r.stream: r for r in await rows(db, WeekObjective, week=label)}
    items = [{"stream": i["stream"], "text": stored[i["stream"]].text if i["stream"] in stored else "",
              "done": stored[i["stream"]].done if i["stream"] in stored else False,
              "checkpoint": stored[i["stream"]].checkpoint if i["stream"] in stored else None} for i in original]
    out = R.objectives_note(TODAY, items, streams)
    assert parse_objectives(out, streams) == original


@pytest.mark.asyncio
async def test_quarter_note_round_trips(imported):
    db, root = imported
    label = quarter_for(TODAY)
    original = parse_quarter((root / f"Calendar/Quarterly/{label}.md").read_text())
    quarter = (await rows(db, Quarter, label=label))[0]
    streams = [s for s in await rows(db, QuarterStream, quarter=label) if s.in_note]
    parsed = parse_quarter(R.quarter_note(label, quarter, streams))
    assert (parsed["objective"], parsed["objective_ar"], parsed["starts"], parsed["ends"]) == (
        original["objective"], original["objective_ar"], original["starts"], original["ends"])
    pick = lambda d: [(s["stream"], s["info"], s["goal"], s["checkpoints"]) for s in d["streams"]]  # noqa: E731
    assert pick(parsed) == pick(original)


@pytest.mark.asyncio
async def test_goals_note_round_trips(imported):
    db, root = imported
    original = parse_goals((root / "Calendar/Goals.md").read_text())
    assert parse_goals(R.goals_note(await rows(db, Goal))) == original
    assert parse_goals(R.goals_note([])) == []
```

- [ ] **Step 3: Implement** `app/services/obsidian_render.py`:

```python
"""Whole-file renderers for the Obsidian mirror: the files Niyyah generates completely, written the way the vault parsers read them."""
from datetime import date

from app.services.vault_notebook import _render as render_entry
from app.services.vault_objectives import render_objectives, weekly_streams
from app.services.vault_pipeline import BLOCKED_BY, HEADINGS, LANES, _render as render_item
from app.services.vault_streams import MONTHS

MIRROR = "mirror: niyyah"


def _iso(value: date | None) -> str | None:
    return value.isoformat() if value else None


def pipeline_note(stream: str, name: str | None, items) -> str:
    lines = ["---", "type: pipeline", f"stream: {stream}", MIRROR, "---", f"# {name or stream.title()} pipeline", ""]
    for lane in LANES:
        lines += [f"## {HEADINGS[lane]}", ""]
        for it in (i for i in items if i.lane == lane):
            text = it.text + (f" [product:: {it.product}]" if it.product else "")
            lines.append(render_item(text, it.checkpoint, it.done, _iso(it.added_on), _iso(it.done_on), it.focus_week))
            notes = [f"{BLOCKED_BY}{b}" for b in (it.blocked_by or [])] + (it.description.split("\n") if it.description else [])
            lines += [f"  {n}".rstrip() if n.strip() else "  " for n in notes]
        lines.append("")
    return "\n".join(lines)


def notebook_note(stream: str, name: str | None, entries) -> str:
    lines = ["---", "type: stream-notes", f"stream: {stream}", MIRROR, "---", f"# {name or stream.title()} notebook", ""]
    for e in entries:
        status = None if e.kind != "blocker" else ("open" if e.is_open else "cleared")
        lines += render_entry(e.kind, e.title, e.body, e.entry_date or "", status, e.ext_id)
    return "\n".join(lines)


def objectives_note(day: date, items: list[dict], streams) -> str:
    return render_objectives(day, items, {s.id: s.name for s in weekly_streams(streams)})


def quarter_note(label: str, quarter, streams) -> str:
    lines = ["---", "type: quarter", f"quarter: {label}"]
    if quarter.starts:
        lines.append(f"starts: {quarter.starts.isoformat()}")
    if quarter.ends:
        lines.append(f"ends: {quarter.ends.isoformat()}")
    lines += [MIRROR, "---", f"# {quarter.objective}"]
    if quarter.objective_ar:
        lines.append(f"> {quarter.objective_ar}")
    for s in streams:
        lines += ["", f"## {s.slug}", f"- name: {s.name}", f"- color: {s.color}", f"- icon: {s.icon}", f"- slot: {s.slot}",
                  f"- weekly: {'yes' if s.weekly else 'no'}", f"- goal: {s.goal}", f"- status: {s.status}"]
        order = {m: n for n, m in enumerate(MONTHS)}
        lines += [f"- {c['month']}: {c['text']}" for c in sorted(s.checkpoints or [], key=lambda c: order.get(c["month"], 99))]
    lines.append("")
    return "\n".join(lines)


def goals_note(goals) -> str:
    lines = ["---", "type: goals", MIRROR, "---", "# Goals", ""]
    for g in goals:
        parts = [g.value]
        if g.caption or g.progress is not None:
            parts.append(g.caption)
        if g.progress is not None:
            parts.append(str(g.progress))
        lines.append(f"- **{g.title}**: {' | '.join(parts)}")
    lines.append("")
    return "\n".join(lines)
```

(`quarter_note` keeps checkpoints in month order. `parse_quarter` compares checkpoint lists in file order, so the test fixture's single checkpoint is unaffected; if a real quarter's checkpoints are not in calendar order the round trip may reorder them, which is harmless.)

- [ ] **Step 4:** Run the render tests; fix any parser mismatch in the renderer (never loosen the test). Commit `Render the generated Obsidian files from database rows`.

---

### Task 4: Surgical daily-note editor

**Files:** create `app/services/obsidian_daily.py`. Test `tests/test_obsidian_daily.py`.
**Interfaces:** Produces `managed_view(content, day: date) -> str` (stable text of the mode, votes and Log: what drift is checked against), `replace_log(content, texts) -> str`, `ensure_tasks(content, tasks, day_iso) -> str`, `apply_day(content, day, mode, votes, log, tasks) -> tuple[str, list[str]]` (new content, skipped notes), `fresh_note(root: Path, day: date) -> str`.

- [ ] **Step 1: Failing tests** `tests/test_obsidian_daily.py`:

```python
from datetime import date
from types import SimpleNamespace

import pytest

from app.services import obsidian_daily as D
from app.services.vault_parser import parse_daily_note
from app.services.vault_write import log_entries
from tests.vault_fixture import DAILY

DAY = date(2026, 10, 7)
NOTE = DAILY.format(day=DAY.isoformat()) + "\n## Tasks\n- [ ] Already here ⏳ 2026-10-07\n\n## Reflection\n- Win: kept my own words\n"


def task(text, done=False):
    return SimpleNamespace(text=text, done=done, done_on=DAY if done else None)


def test_apply_day_sets_mode_votes_log_and_tasks_and_leaves_the_rest():
    out, skipped = D.apply_day(NOTE, DAY, "yellow", {"soul": 3, "body": 0, "reading": 2}, ["07:00 one", "08:00 two"],
                               [task("Call the bank"), task("Already here", done=True)])
    parsed = parse_daily_note(out, DAY)
    assert parsed.mode == "yellow" and parsed.blocks["soul"] == 3 and parsed.blocks["body"] == 0
    assert [e["text"] for e in log_entries(out)] == ["07:00 one", "08:00 two"]
    assert "- [ ] Call the bank ⏳ 2026-10-07" in out and "- [x] Already here" in out and f"✅ {DAY.isoformat()}" in out
    assert "- Win: kept my own words" in out and "## Focus\n- Ship the router" in out
    assert any("reading" in s for s in skipped)


def test_apply_day_is_idempotent():
    args = (DAY, "full", {"soul": 2, "body": 1}, ["a", "b"], [task("Call the bank")])
    once, _ = D.apply_day(NOTE, *args)
    twice, _ = D.apply_day(once, *args)
    assert once == twice


def test_empty_log_keeps_a_placeholder_bullet():
    out, _ = D.apply_day(NOTE, DAY, "full", {}, [], [])
    assert log_entries(out) == [] and "## Log\n-\n" in out


def test_managed_view_ignores_edits_outside_the_managed_parts():
    edited = NOTE.replace("- Win: kept my own words", "- Win: something else").replace("- Ship the router", "- Ship the modem")
    assert D.managed_view(edited, DAY) == D.managed_view(NOTE, DAY)
    assert D.managed_view(NOTE.replace("mode: full", "mode: off"), DAY) != D.managed_view(NOTE, DAY)
    assert D.managed_view(NOTE.replace("- Second entry", "- Changed in Obsidian"), DAY) != D.managed_view(NOTE, DAY)


def test_fresh_note_copies_the_latest_layout(tmp_path):
    daily = tmp_path / "Calendar" / "Daily"
    daily.mkdir(parents=True)
    (daily / "2026-10-06.md").write_text(DAILY.format(day="2026-10-06"))
    out = D.fresh_note(tmp_path, DAY)
    assert "# " in out and "2026-10-07" in out and parse_daily_note(out, DAY).total == 0
    with pytest.raises(ValueError):
        D.fresh_note(tmp_path / "empty", DAY)
```

- [ ] **Step 2:** Run (fails). **Step 3: Implement:**

```python
"""Surgical edits to the owner's daily notes for the Obsidian mirror: only the mode, vote ticks, Log entries and app-created tasks change."""
import json
import re
from datetime import date
from pathlib import Path

from app.services.vault_parser import parse_daily_note
from app.services.vault_tasks import _TASK, _label, add_task, line_hash, set_task_done
from app.services.vault_write import _log_bounds, log_entries, new_daily_note, set_mode, set_vote


def managed_view(content: str, day: date) -> str:
    """What the mirror owns in a daily note. A change here made in Obsidian is drift; edits elsewhere in the note are not."""
    parsed = parse_daily_note(content, day)
    return json.dumps({"mode": parsed.mode, "votes": dict(sorted(parsed.blocks.items())),
                       "log": [e["text"] for e in log_entries(content)]}, sort_keys=True)


def replace_log(content: str, texts: list[str]) -> str:
    """Make the '## Log' bullets exactly `texts` (a lone '-' placeholder when there are none)."""
    lines = content.split("\n")
    bullets = [f"- {t}" for t in texts] or ["-"]
    bounds = _log_bounds(lines)
    if bounds is None:
        return content.rstrip("\n") + "\n\n## Log\n" + "\n".join(bullets) + "\n"
    first, end = bounds
    return "\n".join([*lines[:first], *bullets, "", *lines[end:]])


def ensure_tasks(content: str, tasks, day_iso: str) -> str:
    """Each app-created task is present once with the right tick; a task is matched by its label. Deletions are not mirrored."""
    for t in tasks:
        lines = content.split("\n")
        hit = next((n for n, l in enumerate(lines, 1) if (m := _TASK.match(l)) and "⭐" not in l and _label(m.group(4)) == t.text), None)
        if hit is None:
            content = add_task(content, t.text, day_iso)
            lines = content.split("\n")
            hit = next(n for n in range(len(lines), 0, -1) if (m := _TASK.match(lines[n - 1])) and _label(m.group(4)) == t.text)
        stamp = (t.done_on or date.fromisoformat(day_iso)).isoformat()
        content = set_task_done(content, hit, line_hash(lines[hit - 1]), t.done, stamp)
    return content


def apply_day(content: str, day: date, mode: str, votes: dict[str, int], log: list[str], tasks) -> tuple[str, list[str]]:
    """The note with the database's state written into it, and notes about what could not be written."""
    skipped: list[str] = []
    out = set_mode(content, mode)
    for block, stars in votes.items():
        try:
            out = set_vote(out, block, stars)
        except ValueError:
            skipped.append(f"vote on '{block}' skipped: the daily-note template has no callout for it")
    out = replace_log(out, log)
    return ensure_tasks(out, tasks, day.isoformat()), skipped


def fresh_note(root: Path, day: date) -> str:
    """A daily note that does not exist yet: the layout of the latest one in the vault, with no content."""
    daily = root / "Calendar" / "Daily"
    notes = sorted(p for p in daily.glob("*.md") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem)) if daily.is_dir() else []
    if not notes:
        raise ValueError("there is no daily note to copy the layout from")
    base = notes[-1]
    return new_daily_note(base.read_text(encoding="utf-8"), date.fromisoformat(base.stem), day)
```

- [ ] **Step 4:** Run the tests; if a test shows `replace_log` leaving a double blank line before the next heading, keep exactly one blank line (the code above emits one). Commit `Edit daily notes surgically for the Obsidian mirror`.

---

### Task 5: Dirty marking

**Files:** create `app/services/obsidian_dirty.py`; modify `app/main.py` (one import), `app/services/vault_import.py` (skip flag). Test `tests/test_obsidian_dirty.py`.
**Interfaces:** Produces `obsidian_dirty.targets(obj) -> list[tuple[str, str]]` and the registered `before_flush` listener; `export_user_id(session) -> int | None`.

- [ ] **Step 1: Failing tests** `tests/test_obsidian_dirty.py`:

```python
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.planner import PlannerExportDirty
from app.models.user import User
from tests.conftest import TestSession

V = "/api/v1/vault"


async def dirty(user_id=None):
    async with TestSession() as db:
        q = select(PlannerExportDirty.kind, PlannerExportDirty.key)
        if user_id:
            q = q.where(PlannerExportDirty.user_id == user_id)
        return sorted(set((await db.execute(q)).all()))


@pytest.mark.asyncio
async def test_nothing_is_marked_when_the_mirror_is_off(db_client):
    client, today = db_client
    await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    assert await dirty() == []


@pytest.mark.asyncio
async def test_writes_mark_what_they_changed(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(settings, "obsidian_export_user", "test@niyyah.app")
    await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["One"], "lane": "next"})
    await client.post(f"{V}/notebook/kahf/entries", json={"kind": "idea", "title": "x", "body": ""})
    await client.put(f"{V}/objectives", json={"stream": "alisha", "text": "Launch"})
    await client.put(f"{V}/quarter", json={"text": "New", "arabic": ""})
    await client.put(f"{V}/config/goals", json={"items": [{"title": "A", "value": "B"}]})
    await client.post(f"{V}/day/{today}/tasks", json={"text": "Call"})
    marks = await dirty()
    assert ("day", today.isoformat()) in marks and ("pipeline", "kahf") in marks and ("notebook", "kahf") in marks
    assert any(k == "objectives" for k, _ in marks) and any(k == "quarter" for k, _ in marks) and ("goals", "") in marks


@pytest.mark.asyncio
async def test_only_the_configured_account_is_marked(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(settings, "obsidian_export_user", "someone-else@niyyah.app")
    await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    assert await dirty() == []


@pytest.mark.asyncio
async def test_a_task_in_another_note_is_not_mirrored(db_client, monkeypatch):
    client, today = db_client
    monkeypatch.setattr(settings, "obsidian_export_user", "test@niyyah.app")
    first = (await client.get(f"{V}/day/{today}/tasks")).json()[0]  # lives in Efforts/todo.md
    await client.put(f"{V}/tasks", json={"path": first["path"], "line": first["line"], "hash": "", "done": True})
    assert await dirty() == []
```

- [ ] **Step 2:** Run (fails). **Step 3: Implement** `app/services/obsidian_dirty.py`:

```python
"""Marks what the Obsidian mirror has to write, in the same transaction as the change itself."""
import re

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerExportDirty, Quarter, QuarterStream, Task, WeekObjective,
)
from app.models.user import User
from app.models.vault import VaultDay

_DAILY_PATH = re.compile(r"^Calendar/Daily/(\d{4}-\d{2}-\d{2})\.md$")


def targets(obj) -> list[tuple[str, str]]:
    """(kind, key) of the mirrored item a changed row belongs to; empty for rows the mirror does not write."""
    if isinstance(obj, VaultDay):
        return [("day", obj.date.isoformat())]
    if isinstance(obj, LogEntry):
        return [("day", obj.day.isoformat())]
    if isinstance(obj, Task):
        m = _DAILY_PATH.match(obj.source_path or "")
        return [("day", m.group(1))] if m else []
    if isinstance(obj, PipelineItem):
        return [("pipeline", obj.stream)]
    if isinstance(obj, NotebookEntry):
        return [("notebook", obj.stream)]
    if isinstance(obj, WeekObjective):
        return [("objectives", obj.week)]
    if isinstance(obj, Quarter):
        return [("quarter", obj.label)]
    if isinstance(obj, QuarterStream):
        return [("quarter", obj.quarter)]
    if isinstance(obj, Goal):
        return [("goals", "")]
    return []


def export_user_id(session: Session) -> int | None:
    email = settings.obsidian_export_user.strip()
    if not email:
        return None
    with session.no_autoflush:
        return session.execute(select(User.id).where(User.email == email)).scalar_one_or_none()


def _mark(session: Session, flush_context, instances) -> None:
    if session.info.get("skip_export") or not settings.obsidian_export_user.strip():
        return
    wanted: set[tuple[int, str, str]] = set()
    for obj in [*session.new, *session.dirty, *session.deleted]:
        user_id = getattr(obj, "user_id", None)
        if user_id is None or isinstance(obj, PlannerExportDirty):
            continue
        for kind, key in targets(obj):
            wanted.add((user_id, kind, key))
    if not wanted:
        return
    exporter = export_user_id(session)
    for user_id, kind, key in wanted:
        if user_id == exporter:
            session.add(PlannerExportDirty(user_id=user_id, kind=kind, key=key))


event.listen(Session, "before_flush", _mark)
```

(`WeekObjective` must be in the model import list: add it.) In `app/main.py` add `from app.services import obsidian_dirty  # noqa: F401` (registers the listener). In `vault_import.import_vault` set `db.info["skip_export"] = True` as the first statement and delete it in a `finally`. Note: `VaultDay.date` of a `LogEntry`-only change is covered by `LogEntry.day`; votes change the day's `total`, which dirties the `VaultDay`.

- [ ] **Step 4:** Run `tests/test_obsidian_dirty.py` and `tests/test_db_day_writes.py` (the listener must not disturb normal writes). Commit `Mark what the mirror has to write`.

---

### Task 6: The exporter

**Files:** create `app/services/obsidian_export.py`. Test `tests/test_obsidian_export.py`.
**Interfaces:** Produces `async run_once(db, user_id, workdir=None) -> ExportReport(written: list[str], drift: list[str], errors: list[str], skipped: list[str])`, `async status(db, user_id) -> dict`, `async resolve(db, user_id, path, action) -> None`, `path_to_target(path) -> tuple[str, str] | None`, `sha(text) -> str`.

- [ ] **Step 1: Failing tests** `tests/test_obsidian_export.py` (uses `git_vault` from `tests/test_writes_parity.py` for a real git remote):

```python
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.core.config import settings
from app.models.planner import PlannerExportDirty, PlannerExportState
from app.models.user import User
from app.services import obsidian_export as X
from app.services.vault_import import import_vault
from app.services.vault_parser import parse_daily_note
from tests.conftest import TestSession
from tests.test_writes_parity import git_vault

V = "/api/v1/vault"


@pytest.fixture
async def mirrored(auth_client, tmp_path, monkeypatch):
    today = _local_now().date()
    work = git_vault(tmp_path, today)
    monkeypatch.setattr(settings, "vault_workdir", str(work))
    monkeypatch.setattr(settings, "storage_backend", "db")
    async with TestSession() as db:
        uid = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, uid, tmp_path / "seed", today)
    monkeypatch.setattr(settings, "obsidian_export_user", "test@niyyah.app")
    return auth_client, today, work, uid


async def run(uid):
    async with TestSession() as db:
        return await X.run_once(db, uid)


def head_files(work: Path, ref="origin/main") -> str:
    subprocess.run(["git", "fetch", "-q", "origin", "main"], cwd=work, check=True)
    return subprocess.run(["git", "show", f"{ref}:Efforts/Pipeline/kahf.md"], cwd=work, capture_output=True, text=True).stdout


@pytest.mark.asyncio
async def test_changes_reach_the_vault_in_one_commit(mirrored):
    client, today, work, uid = mirrored
    await client.put(f"{V}/day/{today}/vote", json={"block": "body", "stars": 3})
    await client.post(f"{V}/day/{today}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Shipped"})
    await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["Buy cables #nov"], "lane": "next"})
    await client.put(f"{V}/config/goals", json={"items": [{"title": "Zero debt", "value": "70% paid", "progress": 70}]})
    report = await run(uid)
    assert report.errors == [] and report.drift == []
    assert {"Efforts/Pipeline/kahf.md", "Calendar/Goals.md", f"Calendar/Daily/{today.isoformat()}.md"} <= set(report.written)
    subprocess.run(["git", "fetch", "-q", "origin", "main"], cwd=work, check=True)
    assert "Buy cables" in head_files(work)
    note = subprocess.run(["git", "show", f"origin/main:Calendar/Daily/{today.isoformat()}.md"], cwd=work, capture_output=True, text=True).stdout
    parsed = parse_daily_note(note, today)
    assert parsed.blocks["body"] == 3 and "Shipped" in (parsed.log or "")
    async with TestSession() as db:
        assert (await db.execute(select(PlannerExportDirty))).scalars().all() == []
        states = {s.path: s.state for s in (await db.execute(select(PlannerExportState))).scalars()}
        assert states["Calendar/Goals.md"] == "ok"
    assert (await run(uid)).written == []  # nothing left to do


@pytest.mark.asyncio
async def test_a_file_changed_in_obsidian_is_not_overwritten(mirrored):
    client, today, work, uid = mirrored
    # someone edits the pipeline note in Obsidian and pushes
    pipeline = work / "Efforts/Pipeline/kahf.md"
    pipeline.write_text(pipeline.read_text() + "\n- [ ] Typed in Obsidian\n")
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "obsidian"], cwd=work, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=work, check=True)
    await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["From Niyyah"], "lane": "next"})
    report = await run(uid)
    assert report.drift == ["Efforts/Pipeline/kahf.md"] and "Efforts/Pipeline/kahf.md" not in report.written
    assert "Typed in Obsidian" in head_files(work) and "From Niyyah" not in head_files(work)
    async with TestSession() as db:
        assert (await X.status(db, uid))["files"][0]["state"] == "drift"
        await X.resolve(db, uid, "Efforts/Pipeline/kahf.md", "overwrite")
    again = await run(uid)
    assert "Efforts/Pipeline/kahf.md" in again.written and "From Niyyah" in head_files(work)


@pytest.mark.asyncio
async def test_keep_stops_mirroring_a_file(mirrored):
    client, today, work, uid = mirrored
    pipeline = work / "Efforts/Pipeline/kahf.md"
    pipeline.write_text(pipeline.read_text() + "\n- [ ] Typed in Obsidian\n")
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "obsidian"], cwd=work, check=True)
    subprocess.run(["git", "push", "-q", "origin", "HEAD:main"], cwd=work, check=True)
    await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["From Niyyah"], "lane": "next"})
    await run(uid)
    async with TestSession() as db:
        await X.resolve(db, uid, "Efforts/Pipeline/kahf.md", "keep")
    await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["And again"], "lane": "next"})
    report = await run(uid)
    assert "Efforts/Pipeline/kahf.md" not in report.written and "And again" not in head_files(work)


@pytest.mark.asyncio
async def test_a_failed_push_keeps_the_work_for_the_next_run(mirrored, monkeypatch):
    client, today, work, uid = mirrored
    await client.put(f"{V}/config/goals", json={"items": [{"title": "A", "value": "B"}]})
    from app.services import vault_git
    real = vault_git.commit_edits
    monkeypatch.setattr(X, "commit_edits", lambda *a, **k: (_ for _ in ()).throw(vault_git.VaultWriteError("push refused")))
    report = await run(uid)
    assert report.written == [] and report.errors and "push refused" in report.errors[0]
    async with TestSession() as db:
        assert len((await db.execute(select(PlannerExportDirty))).scalars().all()) >= 1
    monkeypatch.setattr(X, "commit_edits", real)
    assert "Calendar/Goals.md" in (await run(uid)).written
```

- [ ] **Step 2:** Run (fails: no module). **Step 3: Implement** `app/services/obsidian_export.py`:

```python
"""The optional Obsidian mirror: writes the database's state into the owner's vault checkout, one way only.

What to write is recorded in planner_export_dirty (see obsidian_dirty). A run renders each dirty item, refuses to overwrite a
file that changed in Obsidian since the last export (drift) and commits everything it could write as one git commit.
"""
import asyncio
import hashlib
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerExportDirty, PlannerExportState, Quarter, QuarterStream, Task,
    WeekObjective,
)
from app.models.vault import VaultDay
from app.services import obsidian_daily, obsidian_render
from app.services.planner_store import streams_for
from app.services.vault_git import VaultWriteError, commit_edits
from app.services.vault_goals import GOALS_PATH
from app.services.vault_notebook import notebook_path
from app.services.vault_objectives import objectives_path, week_for
from app.services.vault_pipeline import pipeline_path
from app.services.vault_quarter import quarter_path

_DAILY = re.compile(r"^Calendar/Daily/(\d{4}-\d{2}-\d{2})\.md$")


def sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class ExportReport:
    written: list[str] = field(default_factory=list)
    drift: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)


def path_for(kind: str, key: str) -> str:
    return {"day": lambda: f"Calendar/Daily/{key}.md", "pipeline": lambda: pipeline_path(key), "notebook": lambda: notebook_path(key),
            "objectives": lambda: objectives_path(key), "quarter": lambda: quarter_path(key), "goals": lambda: GOALS_PATH}[kind]()


def path_to_target(path: str) -> tuple[str, str] | None:
    if m := _DAILY.match(path):
        return "day", m.group(1)
    for kind, pattern in (("pipeline", r"^Efforts/Pipeline/([a-z][a-z0-9-]*)\.md$"), ("notebook", r"^Efforts/Streams/([a-z][a-z0-9-]*)\.md$"),
                          ("objectives", r"^Calendar/Weekly/Objectives/(\d{4}-W\d{2})\.md$"), ("quarter", r"^Calendar/Quarterly/(\d{4}-Q[1-4])\.md$")):
        if m := re.match(pattern, path):
            return kind, m.group(1)
    return ("goals", "") if path == GOALS_PATH else None


async def _all(db, stmt) -> list:
    return list((await db.execute(stmt)).scalars().all())


async def _plan(db: AsyncSession, user_id: int, kind: str, key: str):
    """(render, drift_view): render(existing, root) -> new text; drift_view(text) -> the part of a file the mirror owns."""
    today = datetime.now(timezone.utc).date()
    if kind == "day":
        day = date.fromisoformat(key)
        row = (await db.execute(select(VaultDay).where(VaultDay.user_id == user_id, VaultDay.date == day))).scalars().first()
        if row is None:
            return None
        await db.refresh(row, ["block_votes"])
        log = [e.text for e in await _all(db, select(LogEntry).where(LogEntry.user_id == user_id, LogEntry.day == day).order_by(LogEntry.position))]
        tasks = await _all(db, select(Task).where(Task.user_id == user_id, Task.source_path == f"Calendar/Daily/{key}.md").order_by(Task.position))
        votes = {v.block: v.stars for v in row.block_votes}
        notes: list[str] = []

        def render(existing, root):
            base = existing if existing is not None else obsidian_daily.fresh_note(root, day)
            out, skipped = obsidian_daily.apply_day(base, day, row.mode, votes, log, tasks)
            notes.extend(skipped)
            return out

        return render, (lambda text: obsidian_daily.managed_view(text, day)), notes
    if kind == "pipeline":
        items = await _all(db, select(PipelineItem).where(PipelineItem.user_id == user_id, PipelineItem.stream == key).order_by(PipelineItem.position))
        names = {s.id: s.name for s in await streams_for(db, user_id, today)}
        return (lambda existing, root: obsidian_render.pipeline_note(key, names.get(key), items)), sha, []
    if kind == "notebook":
        entries = await _all(db, select(NotebookEntry).where(NotebookEntry.user_id == user_id, NotebookEntry.stream == key).order_by(NotebookEntry.position))
        names = {s.id: s.name for s in await streams_for(db, user_id, today)}
        return (lambda existing, root: obsidian_render.notebook_note(key, names.get(key), entries)), sha, []
    if kind == "objectives":
        streams = await streams_for(db, user_id, today)
        stored = {r.stream: r for r in await _all(db, select(WeekObjective).where(WeekObjective.user_id == user_id, WeekObjective.week == key))}
        items = [{"stream": s.id, "text": stored[s.id].text if s.id in stored else "", "done": stored[s.id].done if s.id in stored else False,
                  "checkpoint": stored[s.id].checkpoint if s.id in stored else None} for s in streams if s.weekly and not s.archived]
        year, number = key.split("-W")
        monday_of_week = date.fromisocalendar(int(year), int(number), 1)
        return (lambda existing, root: obsidian_render.objectives_note(monday_of_week, items, streams)), sha, []
    if kind == "quarter":
        quarter = (await db.execute(select(Quarter).where(Quarter.user_id == user_id, Quarter.label == key))).scalars().first()
        if quarter is None:
            return None
        streams = [s for s in await _all(db, select(QuarterStream).where(QuarterStream.user_id == user_id, QuarterStream.quarter == key).order_by(QuarterStream.position)) if s.in_note]
        return (lambda existing, root: obsidian_render.quarter_note(key, quarter, streams)), sha, []
    goals = await _all(db, select(Goal).where(Goal.user_id == user_id).order_by(Goal.position))
    return (lambda existing, root: obsidian_render.goals_note(goals)), sha, []


async def run_once(db: AsyncSession, user_id: int, workdir: str | None = None) -> ExportReport:
    report = ExportReport()
    dirty = await _all(db, select(PlannerExportDirty).where(PlannerExportDirty.user_id == user_id))
    if not dirty:
        return report
    root = Path(workdir or settings.vault_workdir)
    states = {s.path: s for s in await _all(db, select(PlannerExportState).where(PlannerExportState.user_id == user_id))}
    wanted = sorted({(d.kind, d.key) for d in dirty})
    edits, outcome, notes = {}, {}, []
    for kind, key in wanted:
        path = path_for(kind, key)
        if states.get(path) and states[path].state == "ignored":
            report.skipped.append(path)
            continue
        plan = await _plan(db, user_id, kind, key)
        if plan is None:
            continue
        render, view, plan_notes = plan
        notes.append(plan_notes)

        def edit(existing, path=path, render=render, view=view):
            state = states.get(path)
            force = state is not None and state.sha is None
            if existing is not None and not force and (state is None or state.sha != sha(view(existing))):
                outcome[path] = ("drift", None)
                return existing
            new = render(existing, root)
            outcome[path] = ("ok", sha(view(new)))
            return new

        edits[path] = edit
    if not edits:
        await db.execute(delete(PlannerExportDirty).where(PlannerExportDirty.id.in_([d.id for d in dirty])))
        await db.commit()
        return report
    try:
        await asyncio.to_thread(commit_edits, edits, f"Niyyah: mirror {len(edits)} file(s)", str(root))
    except (VaultWriteError, ValueError) as exc:
        report.errors.append(str(exc))
        return report  # the dirty rows stay; the next run retries
    now = datetime.now(timezone.utc)
    for path, (state, digest) in outcome.items():
        row = states.get(path)
        if row is None:
            row = PlannerExportState(user_id=user_id, path=path, sha=digest, state=state)
            db.add(row)
        row.sha, row.state, row.error, row.updated_at = (digest if state == "ok" else row.sha), state, None, now
        (report.written if state == "ok" else report.drift).append(path)
    report.skipped.extend(n for group in notes for n in group)
    await db.execute(delete(PlannerExportDirty).where(PlannerExportDirty.id.in_([d.id for d in dirty])))
    await db.commit()
    return report


async def status(db: AsyncSession, user_id: int) -> dict:
    rows = await _all(db, select(PlannerExportState).where(PlannerExportState.user_id == user_id).order_by(PlannerExportState.path))
    pending = len(await _all(db, select(PlannerExportDirty).where(PlannerExportDirty.user_id == user_id)))
    last = max((r.updated_at for r in rows), default=None)
    return {"enabled": True, "last_run": last.isoformat() if last else None, "pending": pending,
            "files": [{"path": r.path, "state": r.state, "error": r.error} for r in rows if r.state != "ok"]}


async def resolve(db: AsyncSession, user_id: int, path: str, action: str) -> None:
    target = path_to_target(path)
    row = (await db.execute(select(PlannerExportState).where(PlannerExportState.user_id == user_id, PlannerExportState.path == path))).scalars().first()
    if target is None or row is None:
        raise ValueError("that file is not mirrored")
    if action == "keep":
        row.state = "ignored"
    elif action == "overwrite":
        row.state, row.sha = "ok", None  # the next run writes it whatever the file holds
        db.add(PlannerExportDirty(user_id=user_id, kind=target[0], key=target[1]))
    else:
        raise ValueError("action must be overwrite or keep")
    await db.commit()
```

(`status()` lists only the files that need attention: drift, error or ignored.)

- [ ] **Step 4:** Run `tests/test_obsidian_export.py`. Expect to fix details: the daily note drift baseline in these tests comes from Task 8 (the importer's baselines); until Task 8 lands, first-time files with no state row count as drift when the file exists. Implement Task 8 immediately after this task and rerun; keep the tests as written. Commit `Add the Obsidian exporter` once green.

---

### Task 7: Export API, background loop and Settings section

**Files:** create `app/api/v1/obsidian.py`, `web/src/components/settings/obsidian-section.tsx`; modify `app/main.py`, `web/src/app/(app)/settings/page.tsx`, `web/src/lib/vault-api.ts`, `vault-types.ts`. Test `tests/test_obsidian_api.py`.
**Interfaces:** `GET /vault/export/status`, `POST /vault/export/run`, `POST /vault/export/resolve`; `async export_loop()` started when the mirror is configured.

- [ ] **Step 1: Failing tests** `tests/test_obsidian_api.py`:

```python
import pytest

from app.core.config import settings

E = "/api/v1/vault/export"


@pytest.mark.asyncio
async def test_status_is_off_unless_this_account_is_the_mirrored_one(db_client, monkeypatch):
    client, _ = db_client
    assert (await client.get(f"{E}/status")).json() == {"enabled": False}
    monkeypatch.setattr(settings, "obsidian_export_user", "someone-else@niyyah.app")
    assert (await client.get(f"{E}/status")).json() == {"enabled": False}
    assert (await client.post(f"{E}/run")).status_code == 404
    monkeypatch.setattr(settings, "obsidian_export_user", "test@niyyah.app")
    body = (await client.get(f"{E}/status")).json()
    assert body["enabled"] is True and body["pending"] == 0 and body["files"] == []


@pytest.mark.asyncio
async def test_resolve_rejects_unknown_files_and_actions(db_client, monkeypatch):
    client, _ = db_client
    monkeypatch.setattr(settings, "obsidian_export_user", "test@niyyah.app")
    assert (await client.post(f"{E}/resolve", json={"path": "Nope.md", "action": "keep"})).status_code == 422
    assert (await client.post(f"{E}/resolve", json={"path": "Calendar/Goals.md", "action": "burn"})).status_code == 422
```

- [ ] **Step 2: Implement** `app/api/v1/obsidian.py`:

```python
"""Status and controls for the optional Obsidian mirror. Everything here is invisible to every account but the configured one."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.services import obsidian_export

router = APIRouter(prefix="/vault/export", tags=["obsidian"])


def _mirrored(user: User) -> bool:
    return bool(settings.obsidian_export_user.strip()) and user.email == settings.obsidian_export_user.strip()


class ResolveIn(BaseModel):
    path: str
    action: str


@router.get("/status")
async def get_status(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _mirrored(user):
        return {"enabled": False}
    return await obsidian_export.status(db, user.id)


@router.post("/run")
async def run_now(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _mirrored(user):
        raise HTTPException(status_code=404, detail="not found")
    report = await obsidian_export.run_once(db, user.id)
    return {"written": report.written, "drift": report.drift, "errors": report.errors, "skipped": report.skipped}


@router.post("/resolve")
async def resolve(data: ResolveIn, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _mirrored(user):
        raise HTTPException(status_code=404, detail="not found")
    try:
        await obsidian_export.resolve(db, user.id, data.path, data.action)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return await obsidian_export.status(db, user.id)
```

Add to `obsidian_export.py`:

```python
async def export_loop() -> None:
    """Background task: run the mirror on an interval. Errors are logged, never raised into the app."""
    import logging

    from app.core import database
    from app.services.obsidian_dirty import export_user_id

    log = logging.getLogger(__name__)
    while True:
        await asyncio.sleep(max(10, settings.obsidian_export_interval))
        try:
            async with database.async_session() as db:
                user_id = await db.run_sync(export_user_id)
                if user_id is not None:
                    report = await run_once(db, user_id)
                    if report.errors or report.drift:
                        log.warning("obsidian mirror: errors=%s drift=%s", report.errors, report.drift)
        except Exception:  # the mirror must never take the API down
            log.exception("obsidian mirror run failed")
```

In `app/main.py`: include the router (`app.include_router(obsidian.router, prefix="/api/v1")`) and add a lifespan that starts `asyncio.create_task(export_loop())` only when `settings.obsidian_export_user.strip()` is set (cancel on shutdown). Pass `lifespan=` to `FastAPI(...)`.

- [ ] **Step 3: Web.** `vault-types.ts`: `export interface ExportStatusData { enabled: boolean; last_run?: string | null; pending?: number; files?: { path: string; state: string; error: string | null }[] }`; `vault-api.ts`: `exportStatus: () => api.get<ExportStatusData>("/vault/export/status")`, `exportRun: () => api.post<unknown>("/vault/export/run", {})`, `exportResolve: (path: string, action: "overwrite" | "keep") => api.post<ExportStatusData>("/vault/export/resolve", { path, action })`. Create `obsidian-section.tsx`: loads the status; renders nothing when `!enabled`; otherwise a `SettingsSection` titled "Obsidian mirror" with: "Last written {time}" and "{pending} waiting" in the aside, a "Write now" button, and for each file needing attention its path, a state tag (`Changed in Obsidian` for drift, `Not mirrored` for ignored, the error text for errors) and buttons "Overwrite from Niyyah" and "Keep the vault copy" (calling `exportResolve` then refreshing). Add `<ObsidianSection />` at the end of the Settings page (before Appearance). Same visual patterns as `feeds-section.tsx`.
- [ ] **Step 4:** Run `tests/test_obsidian_api.py`, `tsc`, `next build`. Commit `Show and control the Obsidian mirror`.

---

### Task 8: The importer records baselines

**Files:** modify `app/services/vault_import.py`. Test: extend `tests/test_vault_import.py`.
**Interfaces:** After an import every mirrored file the importer read has a `planner_export_state` row (`state="ok"`, `sha` = the hash the exporter would compute for that file's current content).

- [ ] **Step 1:** Add to `tests/test_vault_import.py`:

```python
@pytest.mark.asyncio
async def test_import_records_a_baseline_for_every_mirrored_file(tmp_path):
    from app.models.planner import PlannerExportState
    from app.services import obsidian_daily, obsidian_export as X
    build_vault(tmp_path, TODAY)
    async with TestSession() as db:
        await import_vault(db, 1, tmp_path, TODAY)
        states = {s.path: s.sha for s in (await db.execute(select(PlannerExportState).where(PlannerExportState.user_id == 1))).scalars()}
    assert states["Calendar/Goals.md"] == X.sha((tmp_path / "Calendar/Goals.md").read_text())
    assert states["Efforts/Pipeline/kahf.md"] == X.sha((tmp_path / "Efforts/Pipeline/kahf.md").read_text())
    daily = tmp_path / "Calendar/Daily" / f"{TODAY.isoformat()}.md"
    assert states[f"Calendar/Daily/{TODAY.isoformat()}.md"] == X.sha(obsidian_daily.managed_view(daily.read_text(), TODAY))
    assert not any(p.startswith("Efforts/todo") for p in states)  # only mirrored files
```

- [ ] **Step 2:** Implement in `vault_import.py`: add `_baselines(root, user_id) -> list[PlannerExportState]` that, for every file the importer parses, returns a row with the hash described above, using `obsidian_export.sha` and `obsidian_daily.managed_view` (import them lazily inside the function to avoid a cycle): daily notes (`Calendar/Daily/*.md` with an ISO-date stem), `Efforts/Pipeline/*.md`, `Efforts/Streams/*.md`, `Calendar/Weekly/Objectives/*.md`, `Calendar/Quarterly/*.md`, `Calendar/Goals.md`. Add `"export_baselines": _baselines(root, user_id)` to `groups` and update the expected counts in `test_import_copies_every_kind_of_note` (add the new key with the number of files the fixture has: 2 daily + 1 pipeline + 1 notebook + 1 objectives + 1 quarter + 1 goals = 7) and in `test_import_twice_does_not_duplicate`'s mapping if it enumerates keys.
- [ ] **Step 3:** Run the import tests, then `tests/test_obsidian_export.py` (now green). Commit `Record baselines when importing a vault`.

---

### Task 9: Cutover rehearsal and runbook

**Files:** create `tests/test_cutover_rehearsal.py`, `docs/cutover-runbook.md`.

- [ ] **Step 1: The rehearsal test.** One test that does the whole cutover on the fixture vault: `git_vault` -> `import_vault` -> `STORAGE_BACKEND=db` with the mirror on -> through the API: vote, add a log note, add a task, add a pipeline item, move it to Now, set an objective, add a notebook entry, replace goals, edit the quarter -> `run_once` -> read every written file back from `origin/main` and assert the parsers return what the API now returns (`/pipelines`, `/notebooks`, `/objectives`, `/quarter`, `/goals`, the day's votes and log). Finally edit the pipeline note in the vault, make another change, and assert it is flagged as drift and left alone. This is the parity proof for the mirror, the way `test_writes_parity.py` is for writes.
- [ ] **Step 2: The runbook** `docs/cutover-runbook.md`, written as a checklist the operator can follow without this plan: (1) tell the owner to stop editing the vault notes and wait; (2) rotate `SECRET_KEY` and confirm the new value is not a placeholder; (3) backup (`pg_dump -Fc` through a fresh port-forward to `shared-pg-rw` into `~/backups`, mode 600; a forward serves one connection only); (4) apply any pending migrations with `alembic upgrade head`; (5) take a final vault pull and import into the owner's account from the live checkout with `python -m app.cli import-vault /app/data/vault-sync --user <email> --replace` run in the API pod (`kubectl exec`), compare the printed counts with the last parity run; (6) set `STORAGE_BACKEND=db`, `OBSIDIAN_EXPORT_USER=<email>`, `OBSIDIAN_EXPORT_INTERVAL=60` in the `niyyah-config` secret and restart both deployments; (7) smoke checks: sign in, Overview, Vault, Plan, Settings, a vote, a task; (8) press Write now in Settings and diff the new commit in the xarvis repo against the previous one: only the mirrored files should change; (9) rollback: set `STORAGE_BACKEND=vault`, remove `OBSIDIAN_EXPORT_USER`, restart; nothing in the vault is ever deleted by the mirror; changes made in the database since the cutover that were mirrored are in the vault already, others are not.
- [ ] **Step 3:** Run the rehearsal and the full suite alone. Commit `Rehearse the cutover and write the runbook`.

---

### Task 10: Run the cutover (needs the owner's explicit go-ahead)

Do not start this task without the owner's yes in the conversation. It touches production data and configuration.

- [ ] **Step 1:** Merge `feature/obsidian-mirror` into `main`, back up, apply the migration (`a3c5e7f90124`), push with a minor tag, wait for both rollouts; production is still on `vault` mode.
- [ ] **Step 2:** Follow `docs/cutover-runbook.md` step by step with the owner present, reporting each step's result before the next. Stop and roll back at any check that does not match.
- [ ] **Step 3:** After the first successful mirror commit, record the date in the spec (`Result` section) so the soak for phase 5b starts, and update the memory note.

---

## Self-review against the spec

- Goals editor: Task 1. Tables and config: Task 2. Generated-file mirror: Task 3. Surgical daily mirror with managed-region drift: Task 4. Marking: Task 5. Exporter with drift, one commit, retry, overwrite and keep: Task 6. API, loop and Settings: Task 7. Baselines: Task 8. Rehearsal and runbook: Task 9. Cutover: Task 10. Phase 5b is out of this plan by design (after the soak).
- The mirror is inert unless `OBSIDIAN_EXPORT_USER` is set; the core imports only `obsidian_dirty` (registration) and the router.
- Type check: `run_once(db, user_id, workdir=None)`, `status`, `resolve(db, user_id, path, action)`, `path_for`, `path_to_target`, `sha`, `managed_view(content, day)`, `apply_day(content, day, mode, votes, log, tasks)`, `fresh_note(root, day)` and the `*_note` renderers are used with the same names and argument orders in every task.
