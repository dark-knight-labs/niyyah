# Item tree (shadow phase): design note

Status: expand step. The tree is built and kept equal to the legacy planning tables, but nothing reads it yet.

## Why

The planner keeps one idea in several shapes: a goal is a JSON blob on a per-quarter stream row, a checkpoint is a three-letter
month inside that blob, "done" is a bool, a status, a lane and an objective flag, and a stream is re-declared every quarter. Every
new feature has to touch all of them. The target is one tree of items grouped by areas, where time (a quarter, a month, a week, a
horizon) and commitment are attributes of an item and not types.

The move is done as expand / shadow / switch / contract, because the live data is small but real and any image must survive a rollback:

1. **Expand (this step).** Add two tables and a shadow that mirrors legacy. Legacy stays the source of truth. No reader and no API
   response changes; golden tests pin that.
2. **Switch.** Read from the tree, then write to it, once the shadow has been proven equal on real data.
3. **Contract.** Drop the legacy tables and the shadow code.

## Model

`planner_areas`: one row per (user, slug): name, color, icon, slot, weekly, has_pipeline, in_note, position, archived. In the shadow
phase it is seeded from the latest quarter that defines the slug. Per-quarter display fields keep coming from legacy.

`planner_items`: an adjacency list (`parent_id`, ON DELETE CASCADE). Columns: area (slug), title, subtitle (a second line, used for the
Arabic line of the Super Objective), notes, tags, `period` (`2026-Q4`, `2026-10`, `2026-W45`), `horizon` (now | next | someday),
status (open | done | dropped), `commitment` (active | committed | paused | archived, quarter goals only), day, start_min, end_min,
weight, blocked_by, position, done_on, created_on, `legacy_ref`, unique per (user, legacy_ref).

An adjacency list is enough: depth is at most four and trees are read whole, per user. `ltree` is Postgres-only and the tests run on
SQLite; a closure table is a second structure to keep in sync.

## Kinds are derived, never stored

`app/services/item_rules.py` is the only place that decides what an item is:

| kind | rule |
|---|---|
| quarter goal | period is a quarter and no parent. With no area it is the quarter's Super Objective |
| checkpoint | parent is a quarter goal and period is a month (any month, also one outside the quarter) |
| checklist line | parent set, no period, no horizon |
| work item | horizon set and period is not a quarter. Horizon now plus a week period is a week focus |

Goals carry a commitment instead of a horizon, so one never shows up as work as well. A test fails when another module in `app/`
compares a period or horizon.

## Shadow phase

`app/services/tree_shadow.py`:

- `rebuild` computes the wanted tree from legacy rows and applies the difference: UPSERT keyed by (user, legacy_ref), unchanged rows
  are not written, orphans are deleted. Item ids are stable, so later children are never wiped by a rebuild.
- `project` reads the goal fields back out of the tree in the shape of `planner_store.quarter_data` (display fields come from legacy).
- `compare` lists every difference between that projection (plus rows and areas) and legacy. Empty means equal.
- A session hook collects the users whose `Quarter` or `QuarterStream` rows were touched in a flush and rebuilds them, with Core
  statements on the flush's own connection, inside a SAVEPOINT. A shadow failure is logged and never breaks the legacy write.
  `NIYYAH_TREE_SHADOW=off` disables the hook. A bulk delete is invisible to the hook, so the importer marks the user explicitly.
- `python -m app.cli tree-rebuild --user N|--all` backfills; `tree-check --user N|--all` is read-only and exits 1 on any difference.

The Alembic revision is DDL only. Backfill is an explicit `tree-rebuild` step, so the revision never depends on application code.

`legacy_ref` values: `q:<label>` (Super Objective), `qs:<label>:<slug>` (goal), `...:g:<id>` (goal line), `...:m:<mon>` (checkpoint),
`...:m:<mon>:<id>` (checkpoint line). Ids are kept verbatim. A repeated ref gets `:dup1`, `:dup2`, ...

## Known limits of the shadow

- Streams the note does not define (`in_note` false) get an area but no goal item, matching what `quarter_data` returns.
- A checkpoint whose month is not one of the twelve month keys cannot be represented; `compare` reports it.
- A writer that bypasses the ORM (Core `update()` or raw SQL on the quarter tables) would leave the shadow stale; a test greps for that.
- An old image does not run the hook, so after a rollback the shadow may be stale. Nothing reads it, and `tree-rebuild` fixes it.

## Not in this step

Reading from the tree, writing to it, the new UI, export v2, and dropping the legacy tables.
