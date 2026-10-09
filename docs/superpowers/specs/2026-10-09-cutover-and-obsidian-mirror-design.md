# Cutover to the database, and Obsidian as a separate private service (storage phase 5)

Date: 2026-10-09. Status: design agreed with the owner in conversation; supersedes the first draft (an exporter inside the API). Part of `2026-10-08-db-storage-design.md`.

## Goal

Niyyah is useful from day one for any user and knows nothing about Obsidian. The owner's mirror into the xarvis vault is a separate, private service that reads Niyyah through its public API. Production moves to the database like every other install.

## Decisions

| Question | Decision |
|---|---|
| Source of truth | The database, for everyone including the owner. |
| Obsidian | Not part of Niyyah. No Obsidian code, setting, table or Settings section in the open-source repo (the vault importer is the one exception until phase 5b). |
| The mirror | A separate private service (`niyyah-obsidian`, its own private repo, its own deployment). It reads Niyyah over HTTP and writes the vault. It is not open source. |
| Direction | One way first: Niyyah to vault. Vault to Niyyah comes later, as a second job of the same service. |
| Contract between them | A versioned JSON snapshot of one user's data: `GET /api/v1/export` (and later `POST /api/v1/import` with the same shape). It is also a feature in its own right: every user can download their data. |
| Access | Read-only personal API tokens (`Authorization: Bearer nyt_...`), created and revoked in Settings, stored hashed. The service holds one token for the owner. |
| Change detection | The service polls the snapshot, renders each target file, and compares with what it last wrote. No dirty-marking in Niyyah. |
| Protecting notes | Generated notes (pipelines, notebooks, objectives, quarter, goals) are rewritten whole. Daily notes carry the owner's template, so only mode, vote ticks, Log and app-created tasks are edited. |
| Drift | The service remembers the hash of each file it wrote. If the vault copy differs, it does not overwrite; it records the file as drifted and offers overwrite or keep (its own small CLI and status endpoint). |
| Goals | Need an editor in Niyyah (Obsidian is no longer where they are edited). |
| Cleanup | After a soak, delete the vault runtime from Niyyah (phase 5b). The vault parsers move to the private repo; the one-time import becomes "parse the vault, POST the snapshot". |

## Niyyah core changes (open source, generic)

1. **Goals editor**: `PUT /vault/config/goals` (up to six; title, value, caption, optional progress 0 to 100) and a Goals section in Settings.
2. **Export**: `GET /api/v1/export` returns `{version, exported_at, user, blocks, schedule, feeds (host only), quarter, streams, week_objectives, pipeline_items, notebook_entries, goals, days: [{date, mode, votes, log, tasks}], tasks}`. Supports `ETag` and `If-None-Match` so an unchanged poll costs one hash and a 304. The schema is documented in `docs/export-format.md`.
3. **API tokens**: table `planner_api_tokens(id, user_id, name, token_hash, scope='read', created_at, last_used_at, revoked_at)`. `POST/GET/DELETE /api/v1/tokens`. The raw token is shown once. `require_planner_user` accepts a token on read endpoints only; write endpoints refuse read-scoped tokens. A Settings section lists and revokes tokens.

Nothing else changes in core for the mirror: no listener, no export tables, no `OBSIDIAN_*` settings.

## The private service (`niyyah-obsidian`)

- Python, small. Config: `NIYYAH_URL`, `NIYYAH_TOKEN`, vault git remote, interval.
- Loop: fetch snapshot (If-None-Match) → for each target file render the desired content → compare with the file in a fresh checkout and with the stored hash of what it last wrote → write the changed ones in one git commit and push (pull --rebase --autostash, as the vault rules require).
- State (file hashes, drift flags, last run) in a small JSON/SQLite file on its own volume, not in Niyyah's database.
- Reuses the formats the existing parsers read, so a round trip (render then parse) returns the same data; that is its main test.
- Skips, and reports, a vote on a block the owner's daily-note template has no callout for.
- Not mirrored: tasks that live in other notes, feeds, schedule, block list, settings.

## Cutover (5a)

A runbook, run with the owner's go-ahead: rotate `SECRET_KEY`; back up the database; ask the owner to stop editing the vault; import the vault into the owner's account with the existing importer; set `STORAGE_BACKEND=db`; restart; compare the app with the import report; create the owner's token; start the service with the drift check on (the importer's file hashes seed its state so it can tell what changed since); review its first commit; roll back by setting `STORAGE_BACKEND=vault` (the vault is never deleted from).

## Phase 5b (after about two weeks)

Delete the vault runtime from Niyyah: `STORAGE_BACKEND` dispatch, `vault_git` app writes, `vault_sync`, `/sync*`, the webhook, `vault_calendar.sources(root)`, the built-in default streams, `legacy_stream`, the Kahf/Alisha shortening, legacy `vault_days` rows. Move the parsers and importer to the private repo and add `POST /api/v1/import`. Rename the `line` request field to `id`.

## Out of scope

Two-way sync (next, in the private service), mirroring other-note tasks, mirrors for other users, editing the owner's Obsidian template.

## Testing

- Core: export of a seeded account matches the DB; ETag returns 304 when unchanged and a new tag after any write; a read token reads, is refused on every write endpoint, is refused once revoked, and never reaches another user's data; token hash only in the database.
- Service: render then parse round trips for each file type; surgical daily-note edit leaves every other byte unchanged; drift detection leaves a changed file alone and flags it; an unreachable remote leaves state untouched and a later run succeeds.
