# Export format (version 1)

`GET /api/v1/export` returns everything one user has in Niyyah as JSON. Use it to back up your data, move to another install, or feed a tool that mirrors it elsewhere.

## Access

- Needs `STORAGE_BACKEND=db` (otherwise `409`).
- `Authorization: Bearer <login token>` or `Authorization: Bearer nyt_...` (an API token made in Settings). An API token works on this endpoint only; it cannot read or change anything else.
- The response carries an `ETag`. Send it back as `If-None-Match` and an unchanged export answers `304` with no body, so polling is cheap.
- Calendar feed addresses are private and are never exported, only their host.

## Shape

| Key | Contents |
|---|---|
| `version` | `1`. Changes only when a field is removed or its meaning changes; new fields can appear without a bump. |
| `user` | `email`, `timezone` |
| `blocks` | `key`, `label`, `ring_name`, `color`, `counts_for_stars`, `archived`, in display order |
| `schedule` | `null`, or `{meta, days: {weekday: [...], weekend: [...]}}`; rows are `block`, `start`, `end`, `what`, `stream` |
| `feeds` | `name`, `host`, `color`, `email` |
| `goals` | `title`, `value`, `caption`, `progress` (0 to 100 or `null`) |
| `quarters` | per quarter: `label`, `starts`, `ends`, `objective`, `objective_ar`, `streams` (`slug`, `name`, `color`, `icon`, `slot`, `weekly`, `has_pipeline`, `in_note`, `goal`, `status`, `checkpoints`) |
| `week_objectives` | `week`, `stream`, `text`, `done`, `checkpoint` |
| `pipeline_items` | `id`, `stream`, `lane` (`now`, `next`, `backlog`, `done`), `text`, `description`, `product`, `checkpoint`, `added_on`, `done_on`, `focus_week`, `done`, `blocked_by` (notebook entry ids) |
| `notebook_entries` | `stream`, `id`, `kind` (`idea`, `meeting`, `blocker`), `title`, `body`, `date`, `open` |
| `days` | per day, oldest first: `date`, `mode`, `possible`, `total`, `focus`, `votes` (`{block: stars}`), `log` (list of lines) |
| `tasks` | `id`, `text`, `done`, `due_on`, `scheduled_on`, `start_on`, `done_on`, `source_path` |

Dates are ISO `YYYY-MM-DD`. Lists are in a stable order, so the same data always produces the same bytes and the same `ETag`.
