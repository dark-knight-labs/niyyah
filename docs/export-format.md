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
| `goals` | `title`, `value`, `caption`, `checklist` (lines, below), `progress` (from the checklist when there is one, else the typed number, or `null`) |
| `quarters` | per quarter: `label`, `starts`, `ends`, `objective`, `objective_ar`, `streams` (`slug`, `name`, `color`, `icon`, `slot`, `weekly`, `has_pipeline`, `in_note`, `goal`, `goal_checklist`, `status`, `checkpoints`) |
| `week_objectives` | `week`, `stream`, `text`, `done`, `checkpoint` |
| `pipeline_items` | `id`, `stream`, `lane` (`now`, `next`, `backlog`, `done`), `text`, `description`, `products` (tag list), `product` (the first tag, for older readers), `checkpoint`, `added_on`, `done_on`, `focus_week`, `done`, `blocked_by` (notebook entry ids) |
| `notebook_entries` | `stream`, `id`, `kind` (`idea`, `meeting`, `blocker`), `title`, `body`, `date`, `open` |
| `days` | per day, oldest first: `date`, `mode`, `possible`, `total`, `focus`, `votes` (`{block: stars}`), `log` (list of lines) |
| `habits` | `name`, `block` (a key from `blocks`), `anchor`, `per_week`, `minimum`, `stage` (`installing`, `rails`, `retired`), `stream`, `gate_pct`, `gate_weeks`, `trip_pct`, `trip_weeks`, `started_on`, `checks` (`{date: "done" or "min"}`); optional on import |
| `tasks` | `id`, `text`, `done`, `due_on`, `scheduled_on`, `start_on`, `done_on`, `source_path`, `stream`, `products` (tags), `description`, and the item fields: `status` (`open`, `done`, `skipped`), `start_min`, `end_min` (minutes from midnight on `scheduled_on`; both `null` = all day), `weight` (0-3), `checklist` (sub-tasks, lines as below) |
| `item_overlays` | what you added to calendar events, sorted by `key`: `key` (the event key, below), `calendar`, `title` and `day` (cached from the last time it was annotated), `status`, `weight`, `stream`, `products`, `description`, `checklist` |

Dates are ISO `YYYY-MM-DD`. Lists are in a stable order, so the same data always produces the same bytes and the same `ETag`.

## Importing

`POST /api/v1/import?replace=true` (signed-in session only; an API token cannot write) loads a snapshot into your account and **replaces all your planner data**. It accepts what the export produces, so an export from one account or install imports into another. A few differences:

- `feeds[].url` is optional and never exported (it is a secret). An import carries it only when another tool supplies it; a feed without one is skipped. It must be `https`.
- Unknown fields are ignored; unknown block keys used by votes or the schedule are created as plain blocks.
- Everything is validated first (lengths, lane and kind values, duplicate days or notebook ids). A refused import changes nothing.
- `done` decides a task's status: an older export without `status` imports a done task as `done`, and a `status` that disagrees with `done` is ignored (`skipped` is kept only on a task that is not done). A task with a time needs a `scheduled_on` date.
- `item_overlays` is optional. Overlays are matched to events by key, so they reattach once you add the same calendars again.

From a file on the server: `python -m app.cli import-snapshot export.json --user you@example.com --replace`.

## Checklists

A stream's quarter goal (`goal_checklist`), each month's checkpoint (`checkpoints[].checklist`) and each goal card (`goals[].checklist`) hold lines: `{id, text, done}`. `id` is a short stable string, `text` is one line of at most 400 characters, at most 15 lines to a list. The older `goal` and `checkpoints[].text` fields stay as a summary: the lines joined with ` · `. An import accepts either form: a snapshot with only the plain text (an export from before checklists) becomes one line per goal or month.

## Items and event keys

A task's time belongs to its `scheduled_on` date only: a task that is also due or starts on other days shows there all day.
Sub-tasks (`tasks[].checklist`, `item_overlays[].checklist`) use the line shape above with at most 50 lines of 200 characters; a task or overlay holds at most 12 tags.

An event key names one calendar event across feeds, moves and re-imports, and never includes which feed it came from:

- `<UID>` for a one-off event (it keeps the key when moved);
- `<UID>|<original start>` for one occurrence of a repeating event: `YYYYMMDDTHHMMSSZ` (UTC) for timed events, `YYYYMMDD` for all-day ones, `YYYYMMDDTHHMMSS` (wall clock) for floating times. A moved occurrence keeps the key of its original start. Google's Calendar API and its iCal export give the same key;
- `t|<title>|<day>|<start minute or all>` for an event without a UID (weaker: it changes when the event does).

The same UID in two feeds shares one overlay.
