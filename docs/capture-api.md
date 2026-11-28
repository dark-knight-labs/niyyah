# Capture API (device tokens): contract for capture clients

For the menu-bar app (`apps/menubar`) and any other client that holds a device token (`nyd_...`). Base path `/api/v1`. All bodies are JSON. OpenAPI: `/docs`.

## Scope of a device token

A device token opens exactly four routes and nothing else (every other route answers 403):

| Route | Use |
|---|---|
| `POST /vault/items` | create a task (write) |
| `GET /capture/options` | the stream picker (read) |
| `GET /capture/tasks` | list the tasks **this device** created (read) |
| `PATCH /capture/tasks/{client_id}` | change a task **this device** created (write) |

Isolation: a device sees and changes only tasks it created with a `client_id` (rows in `device_captures` for that token and that token's user). Another user's task, another device's task and a task made without a `client_id` all answer 404 on PATCH and never appear in the list. Revoking the token in the web app ends all four routes at once (401). A re-paired Mac gets a new token and therefore a fresh list; old tasks stay in Niyyah.

Rate limit: 60 requests a minute per token across all four routes (in-process per API pod, so a multi-pod deploy allows up to 60 per pod). Over it: `429` with `Retry-After`.

## Options: `GET /capture/options`

The picker is **streams** (Kahf, Alisha Noor, ...). `streams` lists every non-archived stream of the user: this quarter's, plus the latest earlier quarter's that this quarter has no row for yet (the Plan page copies those over when it loads). A stream needs no quarter goal or pipeline to be listed. Each stream carries its products, an optional second pick.

```json
{"streams": [
   {"slug": "kahf", "name": "Kahf", "color": "violet", "products": []},
   {"slug": "alisha", "name": "Alisha Noor", "color": "rose", "products": [{"slug": "cart", "name": "Cart"}]}],
 "blocks": [...], "products": [...], "day": "weekday"}
```

`color` is a colour key ("violet", "rose", ...; same keys as the stream colours in the web app). A stream has no short name in Niyyah, use `name`.

Why Kahf and Alisha Noor were missing before: the old `streams` list kept only streams with a quarter goal and a pipeline (`has_pipeline`), and did not look at an earlier quarter's streams until the Plan page had been opened in a new quarter. Both are fixed; archived streams (`status: archived`) stay out.

**Deprecated, kept so older clients keep working:** `blocks` (today's schedule rows) and `products` (flat list, `block` is a stream slug). Use `streams` and `streams[].products` instead.

Window names are not stored or accepted anywhere in Niyyah: an unknown field such as `window_title` on a create is ignored (FastAPI drops unknown fields), no column exists for it (test `test_window_names_are_never_stored_or_returned`). The app keeps them locally.

## Where a capture goes (device tokens)

`POST /vault/items` from a device token is a **task on a day with a stream**:

- `stream` (a slug from `streams`): the one link that matters. Unknown slug: 422. Missing: accepted (older clients); the task shows in the weekly log as **Unfiled**, so send it.
- `products`: optional tags, e.g. `["cart"]`.
- `day`: optional, default today (planner timezone).
- Ignored without an error, so an older client keeps working: `lane`, `parent_id` (a device cannot attach a task to another task), `checklist`, `start_min`, `end_min`, `weight`. Kept: `text`, `day`, `stream`, `products`, `description`, `status` and the extras below.
- `lane`: **removed from the contract.** No lane is required or defaulted and no pipeline item is made. An older client that still sends `lane` (`now`, `next`, `backlog`) is not refused: the field is ignored and the task is created as a day task. (`lane: "done"` is a 422 as before.)
- `status: "done"`: born done; `client_id`, `link`, `deadline_at`, `tracked_seconds`, `timer_started_at` as below.

Logins keep the old rule (exactly one of `day` and `lane`).

## Weekly log: `GET /vault/weekly-log?week=2026-W48`

Login only (a device token gets 403). `week` is optional (default: this week), Sunday to Saturday, numbered as the Plan page does; the year must be 2000 to 2100 (else 422). The Plan page's "Weekly log" section reads it.

```json
{"week": "2026-W48", "start": "2026-11-22", "end": "2026-11-28", "prev_week": "2026-W47", "next_week": "2026-W49",
 "streams": [{"stream": "kahf", "name": "Kahf", "color": "violet", "done": 3, "total": 5}],
 "days": [{"day": "2026-11-22", "entries": []},
          {"day": "2026-11-23", "entries": [{"id": 412, "text": "Call the bank", "stream": "kahf", "done": true, "on": "done",
                                              "link": null, "tracked_seconds": 90}]}]}
```

- A task sits on the day it was **finished** (`done_on`, `on: "done"`) or, while open, on the day it is **for** (`scheduled_on`; else the day it was added) with `on: "captured"`. A task planned three weeks ago and finished today shows today.
- `streams[].done` = finished this week; `total` = listed this week (finished + open). Only streams with something this week are listed.
- Left out: skipped tasks, week objectives, and tasks without a stream **unless a device captured them**: those are grouped as `{"stream": null, "name": "Unfiled"}` (entries carry `"stream": null`), listed last, so nothing a capture creates is invisible.
- `days` always has seven entries, Sunday first.

Why captures were not on the Plan page: it only lists pipeline items (rows with a lane under a stream with a pipeline), and a day task has no lane. The weekly log lists tasks by day and stream, so a capture shows there.

## Where each field lives

| Nextup field | Niyyah column (table `planner_tasks`) | Notes |
|---|---|---|
| id (UUID) | `client_id` in `device_captures` (unique per `(device token, client_id)`) | already in v1.33.0; makes a replay idempotent |
| name | `text` | max 300 |
| stream (picker) | `planner_tasks.stream` | the link the weekly log groups by; products are optional tags in `products` |
| done | `done` / `status` (`open`, `done`, `skipped`); `done_on` is the day it was finished | `status: "done"` is accepted at create |
| deadlineAt (ms, with time) | `deadline_at` timestamptz, **new** | `due_on` (date only) is untouched and not derived from it |
| link | `link` varchar(2048), **new** | absolute http or https only |
| trackedMs | `tracked_seconds` int, **new** | banked seconds, excluding the running segment; 0 to 315 360 000 |
| startedAt (running timer) | `timer_started_at` timestamptz, **new** | null = no timer running; elapsed now = `tracked_seconds + (now - timer_started_at)` |
| order | not stored | the app keeps its own order; `position` is a per-user counter used by Niyyah's own views |

Timestamps: send an ISO 8601 date-time **with a zone** (`2026-12-01T17:30:00Z` or `+06:00`); one without a zone is a 422. Responses are always UTC. Convert Nextup milliseconds to seconds (`floor(ms / 1000)`) and to an ISO instant.

## Create: `POST /vault/items`

Body: `text`, `stream`, optional `day`, `products`, `description`, `weight`, `status` (a `lane` is ignored, see above) plus optional, all new:

| Field | Type | Rule |
|---|---|---|
| `client_id` | UUID | retry key, per device token (already in v1.33.0) |
| `link` | string | http/https, no spaces or control characters, at most 2048 |
| `deadline_at` | date-time with zone | |
| `tracked_seconds` | int | 0 to 315 360 000 |
| `timer_started_at` | date-time with zone | not more than a day in the future |
| `status` | `open`, `done`, `skipped` | `done` makes the task born done |

A repeat with the same `client_id` from the same token returns the first task with **200** (new fields in the repeat are ignored); the first call returns **201**. The reply is the item (`ItemResponse`) with the new fields `link`, `deadline_at`, `tracked_seconds` (0 when none), `timer_started_at`.

## List: `GET /capture/tasks?include_done=false&limit=200`

`include_done` (default false: open tasks only), `limit` 1 to 500. Newest capture first.

```json
{"tasks": [{"client_id": "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11", "id": 412, "text": "Call the bank",
            "status": "open", "done": false, "link": "https://example.com/a", "deadline_at": "2026-12-01T11:30:00Z",
            "tracked_seconds": 90, "timer_started_at": null, "due_on": null, "scheduled_on": "2026-11-28",
            "lane": null, "stream": "kahf", "products": []}]}
```

## Patch: `PATCH /capture/tasks/{client_id}`

Only the fields sent change. Body fields, all optional: `done` (bool), `text` (1 to 300), `link`, `deadline_at`, `tracked_seconds`, `timer_started_at`. `null` clears `link`, `deadline_at` and `timer_started_at`; `null` for `done`, `text` or `tracked_seconds` is a 422. Returns the task in the list shape. Sending the same body twice changes nothing more than once (a second `done: true` keeps the first done date). Concurrency is last write wins: the server has no version number, so a client that replays an old queue should send the newest value last. A task an older client created with a `lane` is a pipeline item and keeps the pipeline's rules (`done: true` moves it to the Done lane, `done: false` back to Now).

## Errors

| Status | When |
|---|---|
| 401 | missing, malformed, unknown or revoked token (also an export `nyt_` token) |
| 403 | a login (no device) on the two sync routes; a device token on any other route |
| 404 | PATCH: no task for this `client_id` on this device (also another user's or device's) |
| 409 | not used by these routes |
| 422 | validation (also a date-time out of range such as year 1): bad link scheme or length, negative or huge `tracked_seconds`, date-time without zone, timer in the future, text over 300, null on a non-clearable field, malformed UUID, `limit` out of range. Body `{"detail": ...}` and nothing is saved |
| 429 | rate limit; wait `Retry-After` seconds |

## Examples

Placeholders: `TOKEN=nyd_...`, `HOST=https://niyyah.example`.

```bash
# create, already running a timer, with a link and a deadline
curl -sS -X POST "$HOST/api/v1/vault/items" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{
  "text": "Call the bank", "stream": "kahf", "client_id": "3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11",
  "link": "https://example.com/a", "deadline_at": "2026-12-01T17:30:00+06:00",
  "tracked_seconds": 0, "timer_started_at": "2026-11-28T09:00:00Z"}'

# list this device's open tasks
curl -sS "$HOST/api/v1/capture/tasks" -H "Authorization: Bearer $TOKEN"

# stop the timer, bank the time, tick it
curl -sS -X PATCH "$HOST/api/v1/capture/tasks/3f2b8c1e-6a0d-4a5e-9d57-1c2f0b7a9e11" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"tracked_seconds": 1800, "timer_started_at": null, "done": true}'
```

## Compatibility

Every new request field is optional and every new response field is additive, so the v1.33.0 server and the first menu-bar build keep working against this one. Against an older server, an unknown request field is ignored by FastAPI, so a new client talking to v1.33.0 loses the extras silently: check the `GET /capture/tasks` route (404 on v1.33.0) before relying on them.
