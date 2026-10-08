# Niyyah: database storage instead of the Obsidian vault

Date: 2026-10-08. Status: design approved by the owner. Phases 1 and 2 built on branch `feature/db-storage` (plan: `docs/superpowers/plans/2026-10-08-db-storage-phases-1-2.md`); phases 3 to 6 not started.

## Goal

Open-source Niyyah so other people can run it. Today the owner's Obsidian vault (the xarvis git repo) is the source of truth and the API parses markdown on every request. After this work the database is the source of truth, every user's data lives in it, and the vault is only an import and export format.

## Decisions

| Question | Decision |
|---|---|
| Role of the vault | Import and export only. No live sync in either direction. |
| Audience | Self-hosted, many users per install. Strict per-user isolation. Registration can be switched off. No hosted-service concerns (billing, quotas). |
| Blocks, streams, schedule | User-defined, edited in Settings. New accounts are seeded from a default template. |
| Storage approach | Relational tables per entity (approach A). Storing markdown documents in the DB (approach B) was rejected: it keeps whole-note rewrites, lost concurrent edits and line-hash addressing. |
| Frontend | Unchanged apart from the points under "API and auth". Routes and response shapes stay. |

## Data model

Every table has an indexed `user_id`; every query filters on it.

Config (new, per user):
- `blocks`: key, label, colour, order, weekly time-slot layout.
- `streams`: pipeline streams, each linked to a block.
- `schedule_slots`: the weekly schedule that `vault_schedule` reads today.

Daily:
- `days` and `block_votes` already exist; they gain `user_id` (the unique key on date becomes `(user_id, date)`).
- The day's notes and log entries move into the DB.

Work:
- `tasks`: text, done, scheduled and due date.
- `pipeline_items`: stream, lane (now, next, backlog, done), text, description, product, focus week, checkpoint, added date, done date, position.
- `item_blockers`: links an item to a blocker.
- `notebook_entries`: kind (idea, meeting, blocker), open flag, `external_id` (the id items reference).

Planning:
- `goals`, `objectives`, `quarter_plans` with per-stream monthly checkpoints.

Unchanged:
- Google Calendar events are fetched live; tokens are stored per user.

Identifiers: rows have stable integer ids. The vault-era `line` and `hash` addressing is removed, so stale-hash failures disappear. The web sends ids.

## API and auth

- Routes stay under `/vault`; the response schemas stay as they are, except where ids replace `line` and `hash`.
- `require_editor` and `edit-access` are removed. Every logged-in user reads and writes their own data only.
- `/sync`, `/sync/webhook`, `/sync/status`, `vault_git` and `vault_sync` are removed from the runtime.
- The Vault page's "synced X ago" line becomes "last activity". This is a small frontend change.
- Open registration stops exposing the owner's data because rows are per user.

## Defaults for new users

- A template file seeds a new account with the owner's Soul, Body, OT and Planning layout, labelled as an example.
- Settings gets editors for blocks, streams and the schedule.
- The Overview clock reads its blocks from the DB, not from constants.

## Import and export

- `niyyah import-vault <path> --user <email>` reuses the existing parsers once, writes rows, and prints per-table counts (days, tasks, items, entries) for checking against the vault.
- Export writes the same markdown layout as a zip so users can leave, and Obsidian users can read their data.
- The parsers stay in the codebase as the import and export code only, not as the runtime path.

## Phases

Each phase ships on its own. Production keeps running on the vault until phase 5.

1. Schema and repositories: new tables, per-user scoping helpers, and tests proving user A cannot read or write user B's rows.
2. Reads: GET endpoints read from the DB. The owner's vault is imported and every endpoint's DB output is compared to the vault parser output.
3. Writes: tasks, log, pipeline, notebook, goals, objectives, quarter, votes and notes.
4. Config and onboarding: blocks, streams and schedule in the DB, the seed template, Settings editors.
5. Cutover: import the owner's vault, switch production, keep the vault read-only as a backup, remove git sync.
6. Open-source hardening: required `SECRET_KEY`, rate limiting, a registration on/off switch, a non-root Dockerfile, a README with a docker-compose quick start, and a licence.

## Testing

- The vault parser output is the ground truth. For every endpoint, a parity test runs the same fixture through the parser and through the DB path and compares responses.
- Isolation tests for every router: two users, each request touches only the caller's rows.
- Import test: a fixture vault imported twice does not duplicate rows.

## Risks

- Parity gaps between parsers and DB behaviour. Mitigated by the parity tests and the phase 2 comparison on real data.
- Cutover. The vault is untouched until phase 5; rollback is redeploying the previous image.
- Size. Phases 1 to 5 are the bulk of the work; phase 6 is small but blocks publishing.

## Out of scope

Hosted-service features, live two-way vault sync, mobile apps, and any change to the visual design.

## Amendments (found while building phases 1 and 2)

1. No separate `streams` table. A stream's name, colour, icon, slot, status, goal and month checkpoints are defined per quarter in the vault, so they live in `planner_quarter_streams` (one row per user, quarter and stream). Phase 4 adds editors on top.
2. `blocked_by` is a JSON list of blocker ids on `planner_pipeline_items`, not an `item_blockers` table: a blocker's id is its notebook entry's `ext_id`, so a link table would hold the same strings with no useful foreign key.
3. Config tables are `planner_schedule_settings` (one JSON `meta` row per user) and `planner_schedule_blocks`. The user-defined `blocks` table is deferred to phase 4.
4. New tables are prefixed `planner_` (a `schedule_blocks` table already exists); the legacy `vault_days` rows keep `user_id NULL` and belong to `STORAGE_BACKEND=vault`.
5. In `db` mode `line` carries the row id and `hash` is empty until phase 3 moves the frontend to ids. Vault-backed writes answer 501 in `db` mode.

## Phase 2 result on the owner's real vault (2026-10-08)

Imported 85 days, 57 log entries, 15 dated tasks, 3 goals, 1 quarter (8 streams), 6 objectives, 40 pipeline items, 4 notebook entries and 11 schedule blocks with 0 errors. Tasks, log (for today), goals, objectives, quarter, pipelines, notebooks and schedule returned identical JSON from the vault path and the database path once `line` and `hash` were removed. Not yet compared: day aggregates (week, month, streaks), which are asserted against fixture values only, and tasks or log for days other than today.
