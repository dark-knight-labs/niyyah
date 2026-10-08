"""Copy a vault checkout into the database for one user: the one-way door from Obsidian to Niyyah's own storage.

Re-running replaces that user's imported rows, so an import is safe to repeat; it never touches other users' rows
or the legacy vault_days rows (user_id NULL) that STORAGE_BACKEND=vault reads.
"""
import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.planner import (
    Goal, LogEntry, NotebookEntry, PipelineItem, PlannerCalendarFeed, Quarter, QuarterStream, PlannerScheduleBlock, PlannerScheduleSetting, Task,
    WeekObjective,
)
from app.models.vault import VaultBlockVote, VaultDay
from app.services.vault_calendar import sources
from app.services.vault_goals import GOALS_PATH, parse_goals
from app.services.vault_notebook import _new_id as new_entry_id, parse_notebook
from app.services.vault_objectives import parse_objectives
from app.services.vault_parser import parse_daily_note
from app.services.vault_pipeline import parse_pipeline
from app.services.vault_quarter import load_streams, parse_quarter, quarter_for
from app.services.vault_schedule import parse_schedule
from app.services.vault_streams import SLUG, default_streams
from app.services.vault_tasks import _TASK, _label, _markdown_files
from app.services.vault_write import log_entries

_MARK = re.compile(r"([📅⏳🛫])\s*(\d{4}-\d{2}-\d{2})")
_DONE_ON = re.compile(r"✅\s*(\d{4}-\d{2}-\d{2})")
_COLUMN = {"📅": "due_on", "⏳": "scheduled_on", "🛫": "start_on"}
_QUARTER = re.compile(r"^\d{4}-Q[1-4]$")
_WEEK = re.compile(r"^\d{4}-W\d{2}$")

USER_TABLES = (PlannerCalendarFeed, Task, LogEntry, Goal, Quarter, QuarterStream, WeekObjective, PipelineItem, NotebookEntry,
               PlannerScheduleSetting, PlannerScheduleBlock)


@dataclass
class ImportReport:
    counts: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def _iso(value: str | None) -> date | None:
    try:
        return date.fromisoformat(value or "")
    except ValueError:
        return None


def _notes(folder: Path):
    return sorted(folder.glob("*.md")) if folder.is_dir() else []


def _days(root: Path, user_id: int, report: ImportReport) -> tuple[list[VaultDay], list[LogEntry]]:
    days: list[VaultDay] = []
    logs: list[LogEntry] = []
    for path in _notes(root / "Calendar" / "Daily"):
        day = _iso(path.stem)
        if day is None:
            continue  # not a YYYY-MM-DD daily note
        try:
            content = path.read_text(encoding="utf-8")
            parsed = parse_daily_note(content, day)
            entries = log_entries(content)
        except Exception as exc:  # one bad note must not abort the import
            report.errors.append(f"{path.name}: {exc}")
            continue
        row = VaultDay(user_id=user_id, date=day, mode=parsed.mode, possible=parsed.possible, total=parsed.total,
                       focus=parsed.focus, log=parsed.log)
        row.block_votes = [VaultBlockVote(block=b, stars=s) for b, s in parsed.blocks.items()]
        days.append(row)
        logs += [LogEntry(user_id=user_id, day=day, position=n, text=e["text"]) for n, e in enumerate(entries)]
    return days, logs


def _tasks(root: Path, user_id: int) -> list[Task]:
    """Tasks carrying a due, scheduled or start date; ⭐ vote lines are skipped, as the vault's own query does."""
    rows: list[Task] = []
    for path in _markdown_files(root):
        rel = path.relative_to(root).as_posix()
        for line in path.read_text(encoding="utf-8").split("\n"):
            m = _TASK.match(line)
            if not m or "⭐" in line:
                continue
            body = m.group(4)
            dates: dict[str, date] = {}
            for emoji, value in _MARK.findall(body):
                parsed = _iso(value)
                if parsed:
                    dates.setdefault(_COLUMN[emoji], parsed)
            if not dates:
                continue
            done_on = _DONE_ON.search(body)
            rows.append(Task(user_id=user_id, text=_label(body), done=m.group(2) != " ", source_path=rel,
                             done_on=_iso(done_on.group(1)) if done_on else None, position=len(rows), **dates))
    return rows


def _goals(root: Path, user_id: int) -> list[Goal]:
    note = root / GOALS_PATH
    content = note.read_text(encoding="utf-8") if note.is_file() else None
    return [Goal(user_id=user_id, position=n, title=g["title"], value=g["value"], caption=g["caption"], progress=g["progress"])
            for n, g in enumerate(parse_goals(content))]


def _quarters(root: Path, user_id: int, report: ImportReport) -> tuple[list[Quarter], list[QuarterStream], dict[str, str]]:
    quarters: list[Quarter] = []
    streams: list[QuarterStream] = []
    contents: dict[str, str] = {}
    for path in _notes(root / "Calendar" / "Quarterly"):
        label = path.stem
        if not _QUARTER.match(label):
            continue
        try:
            content = path.read_text(encoding="utf-8")
            data = parse_quarter(content)
            loaded = load_streams(content)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        contents[label] = content
        quarters.append(Quarter(user_id=user_id, label=label, starts=_iso(data["starts"]), ends=_iso(data["ends"]),
                                objective=data["objective"], objective_ar=data["objective_ar"]))
        in_note = {s["stream"]: s for s in data["streams"]}
        for pos, s in enumerate(loaded):
            sec = in_note.get(s.id)
            streams.append(QuarterStream(
                user_id=user_id, quarter=label, slug=s.id, name=s.name, color=s.color, icon=s.icon, slot=s.slot,
                weekly=s.weekly, has_pipeline=s.goal, in_note=sec is not None, goal=sec["goal"] if sec else "",
                status=s.status, checkpoints=sec["checkpoints"] if sec else [], position=pos))
    return quarters, streams, contents


def _objectives(root: Path, user_id: int, streams, report: ImportReport) -> list[WeekObjective]:
    rows: list[WeekObjective] = []
    for path in _notes(root / "Calendar" / "Weekly" / "Objectives"):
        if not _WEEK.match(path.stem):
            continue
        try:
            items = parse_objectives(path.read_text(encoding="utf-8"), streams)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        rows += [WeekObjective(user_id=user_id, week=path.stem, stream=i["stream"], text=i["text"], done=i["done"],
                               checkpoint=i["checkpoint"])
                 for i in items if i["text"] or i["done"] or i["checkpoint"]]
    return rows


def _pipelines(root: Path, user_id: int, today: date, report: ImportReport) -> list[PipelineItem]:
    rows: list[PipelineItem] = []
    for path in _notes(root / "Efforts" / "Pipeline"):
        if not SLUG.match(path.stem):
            continue
        try:
            items = parse_pipeline(path.read_text(encoding="utf-8"), today)
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        rows += [PipelineItem(
            user_id=user_id, stream=path.stem, lane=i["lane"], text=i["text"], description=i["description"],
            product=i["product"], checkpoint=i["checkpoint"], added_on=_iso(i["added"]), done_on=_iso(i["done_on"]),
            focus_week=i["focus"], done=i["done"], blocked_by=i["blocked_by"], position=n) for n, i in enumerate(items)]
    return rows


def _notebooks(root: Path, user_id: int, report: ImportReport) -> list[NotebookEntry]:
    rows: list[NotebookEntry] = []
    for path in _notes(root / "Efforts" / "Streams"):
        if not SLUG.match(path.stem):
            continue
        try:
            entries = parse_notebook(path.read_text(encoding="utf-8"))
        except Exception as exc:
            report.errors.append(f"{path.name}: {exc}")
            continue
        seen: set[str] = set()
        for n, e in enumerate(entries):
            ext_id = e["id"] if e["id"] and e["id"] not in seen else new_entry_id()
            seen.add(ext_id)
            rows.append(NotebookEntry(user_id=user_id, stream=path.stem, ext_id=ext_id, kind=e["kind"], title=e["title"],
                                      body=e["body"], entry_date=e["date"], is_open=e["open"], position=n))
    return rows


def _schedule(root: Path, user_id: int, report: ImportReport) -> tuple[list[PlannerScheduleSetting], list[PlannerScheduleBlock]]:
    note = root / "Calendar" / "Schedule.md"
    if not note.is_file():
        return [], []
    parsed = parse_schedule(note.read_text(encoding="utf-8"))
    report.errors += [f"Schedule.md: {e}" for e in parsed.errors]
    meta = json.loads(json.dumps(parsed.meta, default=str))
    blocks = [PlannerScheduleBlock(user_id=user_id, day_type=day, block=b.block, start=b.start, end=b.end, what=b.what, position=n)
              for day, listed in parsed.days.items() for n, b in enumerate(listed)]
    return [PlannerScheduleSetting(user_id=user_id, meta=meta)], blocks


async def _wipe(db: AsyncSession, user_id: int) -> None:
    day_ids = select(VaultDay.id).where(VaultDay.user_id == user_id)
    await db.execute(delete(VaultBlockVote).where(VaultBlockVote.vault_day_id.in_(day_ids)))
    await db.execute(delete(VaultDay).where(VaultDay.user_id == user_id))
    for model in USER_TABLES:
        await db.execute(delete(model).where(model.user_id == user_id))


async def import_vault(db: AsyncSession, user_id: int, root: Path, today: date) -> ImportReport:
    report = ImportReport()
    days, logs = _days(root, user_id, report)
    quarters, quarter_streams, contents = _quarters(root, user_id, report)
    # Weekly objective lines are matched to streams by name; use the quarter that holds today, else the newest, else built-ins.
    pick = contents.get(quarter_for(today)) or (contents[max(contents)] if contents else None)
    streams = load_streams(pick) if pick is not None else default_streams()
    settings_rows, schedule_blocks = _schedule(root, user_id, report)
    groups = {
        "days": days, "log_entries": logs, "tasks": _tasks(root, user_id), "goals": _goals(root, user_id),
        "quarters": quarters, "quarter_streams": quarter_streams,
        "objectives": _objectives(root, user_id, streams, report),
        "pipeline_items": _pipelines(root, user_id, today, report),
        "notebook_entries": _notebooks(root, user_id, report),
        "schedule_blocks": schedule_blocks,
        "calendar_feeds": [PlannerCalendarFeed(user_id=user_id, name=f["name"], url=f["url"], color=f["color"], email=f["email"], position=n)
                           for n, f in enumerate(sources(root))],
    }
    await _wipe(db, user_id)
    for rows in groups.values():
        db.add_all(rows)
    db.add_all(settings_rows)
    await db.commit()
    report.counts = {name: len(rows) for name, rows in groups.items()}
    return report
