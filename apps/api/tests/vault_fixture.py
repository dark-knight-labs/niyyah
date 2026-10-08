"""A small but realistic vault for the importer and parity tests."""
from datetime import date, timedelta
from pathlib import Path

from app.services.vault_notebook import add_entry, parse_notebook
from app.services.vault_objectives import week_for
from app.services.vault_quarter import quarter_for
from app.services.vault_streams import MONTHS

DAILY = """---
id: {day}-daily
type: daily
mode: full
stars: 0
possible: 21
---
# {day}

## Votes

> [!soul]+ Soul
> - [ ] ⭐ Bare Minimum
> - [x] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

> [!body]+ Body
> - [x] ⭐ Bare Minimum
> - [ ] ⭐⭐ Average
> - [ ] ⭐⭐⭐ Best

## Focus
- Ship the router

## Log
- 06:10 Fixed the router
- Second entry
"""

TASKS = """# Todo
- [ ] Pay invoice 📅 {today}
- [x] Renew domain ⏳ {today} ✅ {today}
- [ ] Undated idea
- [ ] ⭐ vote line 📅 {today}
- [ ] Future thing 📅 {later}
"""

QUARTER = """---
quarter: {quarter}
starts: {starts}
ends: {ends}
---
# Allah SWT's satisfaction
> رضا الله

## kahf
- name: Kahf
- slot: OT · Sun to Thu
- goal: Ship DNS
- status: committed
- {month}: Router live

## alisha
- goal: Launch the store
"""

PIPELINE = """---
type: pipeline
stream: kahf
---
# Kahf pipeline

## Now

- [ ] Wire the router [product:: Router] ➕ {added} 🎯 {week} #{month}
  Check the SFP module first.
  blocked-by:: {blocker}

## Next

- [ ] Plan the DNS cutover ➕ {old}

## Backlog

- [ ] Replace the switch

## Done

- [x] Order the modem ➕ {old} ✅ {today}
"""

SCHEDULE = """---
city: Dhaka
lat: 23.8
lon: 90.4
tz: Asia/Dhaka
method: ISNA
madhab: hanafi
---
## weekday
| Block | Start | End | What |
|---|---|---|---|
| soul | fajr | sunrise | Quran |
| ot | 08:00 | 16:00 | Deep work |

## weekend
| Block | Start | End | What |
|---|---|---|---|
| soul | fajr | sunrise | Quran |
"""


def _write(root: Path, rel: str, text: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build_vault(root: Path, today: date) -> dict:
    quarter = quarter_for(today)
    week = week_for(today)[2]
    month = MONTHS[today.month - 1]
    first = date(today.year, 3 * ((today.month - 1) // 3) + 1, 1)

    for day in (today, today - timedelta(days=1)):
        _write(root, f"Calendar/Daily/{day.isoformat()}.md", DAILY.format(day=day.isoformat()))
    _write(root, "Efforts/todo.md", TASKS.format(today=today.isoformat(), later=(today + timedelta(days=9)).isoformat()))
    _write(root, "Calendar/Goals.md",
           "- **Zero debt**: 62% paid | what it is for | 62\n- **Life simple**: Fewer things\n")
    _write(root, f"Calendar/Quarterly/{quarter}.md", QUARTER.format(
        quarter=quarter, starts=first.isoformat(), ends=(first + timedelta(days=90)).isoformat(), month=month))
    _write(root, f"Calendar/Weekly/Objectives/{week}.md",
           f"- **Kahf**: Wire the router #{month}\n- **Alisha Noor** ✓: Launch page\n")

    notebook = add_entry(None, "kahf", "Kahf", "blocker", "Waiting on legal", "owner: legal https://example.com/doc", today)
    notebook = add_entry(notebook, "kahf", "Kahf", "idea", "Passkeys", "cheaper than SSO", today)
    blocker_id = next(e["id"] for e in parse_notebook(notebook) if e["kind"] == "blocker")
    _write(root, "Efforts/Streams/kahf.md", notebook)

    _write(root, "Efforts/Pipeline/kahf.md", PIPELINE.format(
        added=(today - timedelta(days=2)).isoformat(), old=(today - timedelta(days=30)).isoformat(),
        today=today.isoformat(), week=week, month=month, blocker=blocker_id))
    _write(root, "Calendar/Schedule.md", SCHEDULE)
    return {"blocker_id": blocker_id, "week": week, "quarter": quarter}
