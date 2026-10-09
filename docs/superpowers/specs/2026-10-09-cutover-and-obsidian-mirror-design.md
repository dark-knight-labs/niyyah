# Cutover to the database and the optional Obsidian mirror (storage phase 5)

Date: 2026-10-09. Status: design agreed with the owner in conversation; plan in `docs/superpowers/plans/2026-10-09-cutover-and-obsidian-mirror.md`. Part of `2026-10-08-db-storage-design.md`.

## Goal

Production runs on the database like every other install, the vault runtime path is removed, and the owner keeps a mirror of their data in the xarvis Obsidian vault as an optional feature that other users never see or need.

## Decisions

| Question | Decision |
|---|---|
| Source of truth | The database, for everyone including the owner. |
| Obsidian | A read-only mirror for the owner. They stop typing into the mirrored notes. Changes flow database to vault only. No vault-to-database sync. |
| Where the mirror lives | A separate module (`obsidian_export`), off by default, switched on for one account by `OBSIDIAN_EXPORT_USER` (an email). The core app knows nothing about Obsidian or the owner's template. |
| How it writes | Idempotent and state-based: it marks what changed (a day, a stream's pipeline, a week) and later writes the current database state of that item into its note. It does not replay individual edits. |
| Protecting the notes | Notes the app generates completely (pipelines, notebooks, objectives, quarter, goals) are rewritten whole. Daily notes carry the owner's personalised template, so only their mode, vote ticks, Log entries and app-created tasks are edited and the rest of the note is untouched. |
| Drift | Each exported file's content hash is remembered. If the file in the vault no longer matches it (a change made in Obsidian), the exporter does not overwrite it. The file is flagged in Settings with two actions: overwrite from Niyyah, or keep the vault copy and stop mirroring that file. |
| Goals | Goals need an editor in the app, because Obsidian can no longer be where they are edited. Settings gets a Goals section (up to six, as today). |
| Cleanup | After a soak period the vault runtime is deleted (see Phase 5b): the vault storage mode, vault sync and webhook, the built-in Kahf/Alisha/Finance defaults, the old OT-slot rule, the name shortening in the week strip, and the legacy `vault_days` rows. The parsers stay as the import code. |

## What is mirrored

Mirrored: daily notes (mode, votes, Log, tasks created in the app), pipelines, stream notebooks, week objectives, the quarter note, goals.

Not mirrored, by design: tasks that live in other notes (the app shows them, edits are not written back), calendar feeds, the schedule, the block list, user settings. These are not Obsidian-shaped data, or the owner's template does not hold them.

A vote on a block that the owner's daily-note template has no callout for is skipped and reported, never forced into the template.

## Data

- `planner_export_state(user_id, path, sha, state, error, updated_at)`: one row per mirrored file; `state` is `ok`, `drift` or `error`.
- `planner_export_dirty(user_id, kind, key, marked_at)`: what needs writing. `kind` is `day`, `pipeline`, `notebook`, `objectives`, `quarter` or `goals`; `key` is a date, a stream, a week label, a quarter label or empty.
- `planner_goals` already exists; it gets a replace operation.

## How changes get marked

A SQLAlchemy `before_flush` listener inspects the session's new, changed and deleted planner rows and writes the matching dirty rows in the same transaction. Every current and future write path is covered without touching each endpoint. It is active only for the configured account, and the importer turns it off.

## The exporter

- Runs in the API process on an interval (`OBSIDIAN_EXPORT_INTERVAL`, default 60 seconds) and on demand. It takes the same file lock the vault writer uses, so two API pods never export at once.
- Per run: collect the dirty rows, group them by file, render each file from the database, check drift, and write them in one git commit through the existing `commit_edits` (which starts from the remote's main, so changes the owner pushed from Obsidian Git are kept). Dirty rows are cleared only for files that were written.
- A failed run leaves the dirty rows in place and records the error; the next run retries. A database write never waits for, or fails because of, the mirror.
- The importer records the hash of every mirrored file it reads, so the first export after the cutover can already tell whether a file changed since the import.

## API and Settings

- `GET /vault/config/goals`, `PUT /vault/config/goals` (up to six; title, value, caption, optional progress 0 to 100).
- `GET /vault/export/status` returns `{enabled, last_run, pending, files: [{path, state, error}]}`; it is `{enabled: false}` for everyone but the configured account.
- `POST /vault/export/run` runs one export now. `POST /vault/export/resolve` takes `{path, action: "overwrite" | "keep"}`.
- Settings gains Goals (everyone) and Obsidian (only when enabled).

## Cutover (Phase 5a)

A runbook, run with the owner's go-ahead, not code. In order: rotate `SECRET_KEY`; back up the database; freeze writes (tell the owner to stop editing); import the vault into the owner's account from the live checkout; set `STORAGE_BACKEND=db`, `OBSIDIAN_EXPORT_USER` and the interval; restart; compare what the app shows with the import report; let the exporter run and diff the vault commit; roll back by setting `STORAGE_BACKEND=vault` again (the vault is never deleted from).

## Phase 5b (after a soak, about two weeks)

Delete the vault runtime: `STORAGE_BACKEND` and its dispatch, `vault_git` writes for the app, `vault_sync` and `/sync*` and the webhook, `vault_calendar.sources(root)`, the built-in default streams and `legacy_stream`, the Kahf/Alisha shortening, and the legacy `vault_days` rows (those with no `user_id`). The importer and exporter remain. Rename the `line` request field to `id` at the same time. Written as its own plan once the soak has passed.

## Out of scope

Two-way sync, mirroring tasks that live in other notes, a mirror for other users, and anything that edits the owner's Obsidian template itself.

## Testing

- Round trips: for each generated file type, render from rows then parse with the existing parser and get the same items back; import then export a fixture vault and get files that parse to the same data.
- Daily note: after the surgical export, `parse_daily_note` returns the database's mode, votes and log, and the template lines outside those parts are byte-identical.
- Drift: change a mirrored file in the vault, mark it dirty, run the exporter: the file is untouched and flagged; resolving with overwrite writes it.
- Dirty marking: every write endpoint produces the expected dirty rows; none are produced for another account, with export disabled, or during import.
- A failing git push leaves the dirty rows in place and a later run succeeds.
