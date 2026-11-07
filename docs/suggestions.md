# Suggestions

A suggestion is a bundle of proposed changes to your plan. You read it, pick the lines you want, apply them in one go, and can undo them for 7 days. Nothing changes until you apply. Bundles come from you (`POST /api/v1/suggestions`) or from code running inside the server (a plugin calling `app.services.suggestions.create`).

Every line goes through the same service the screens call, so a line gives the same rows as making the edit by hand.

## API

All routes need a sign-in (a login token); an API token (`nyt_...`) gets 401.

| Route | What it does |
|---|---|
| `GET /api/v1/suggestions?status=` | Your bundles, newest first, with the number waiting (`pending`). `status`: `pending`, `applied`, `partly_applied`, `rejected`, `undone` |
| `GET /api/v1/suggestions/{id}` | One bundle with its lines |
| `POST /api/v1/suggestions` | Write a bundle: `{title, reason?, run_id?, lines: [...]}`. The source is always `owner` |
| `POST /api/v1/suggestions/{id}/apply` | `{lines: [seq, ...]}` (all when omitted). One transaction, lines in order |
| `POST /api/v1/suggestions/{id}/reject` | Close a pending bundle |
| `POST /api/v1/suggestions/{id}/undo` | Put back what an applied bundle changed (within 7 days) |

Limits: 40 lines to a bundle, 30 pending bundles per user, the same field caps as the screens.

When a bundle is made, every line is tried as apply would try it, inside a transaction that is rolled back: a line that could only fail at apply (a week out of range, a checkpoint on an item that is not in a pipeline, an unknown stream) is refused then, with the message apply would give. A line whose base has changed is not an error; it is marked `stale` at apply.

A **line** is `{entity, op, target, payload, base?, ref?}`:

| Entity.op | `target` | `payload` (what changes) | Same as |
|---|---|---|---|
| `compass.update` | `{}` | `mission`, `vision`, `vision_horizon` | `PUT /compass` |
| `quarter_objective.update` | `{quarter}` (this quarter) | `text`, `arabic?` | `PUT /vault/quarter` |
| `checkpoint.update` | `{stream, month}` | `checklist: [{id?, text, done}]` | `PUT /vault/quarter/stream` (`month_checklists`) |
| `week_objective.update` | `{week, stream}` | `text?`, `done?`, `checkpoint?` | `PUT /vault/objectives` (with `week`) |
| `item.create` | `{}` | `text`, then `day` or `lane` + `stream`; `description`, `checklist`, `products`, `start_min`, `end_min`, `parent_id` or `parent_ref` | `POST /vault/items` |
| `item.update` | `{id}` or `{ref}` | any of `text`, `description`, `checklist`, `products`, `checkpoint`, `stream`, `day`, `unschedule`, `start_min`, `end_min`, `parent_id` or `parent_ref`, `status` (`open`/`done`) | `PATCH /vault/items/{id}` (`checkpoint`: `PUT /vault/pipeline/checkpoint`) |
| `item.move` | `{id}` or `{ref}` | `lane` | `PUT /vault/pipeline/move` |
| `item.focus` | `{id}` or `{ref}` | `{}` | `PUT /vault/pipeline/focus` |
| `log_note.create` | `{day}` | `clock` (`HH:MM`), `section`, `span`, `text` | `POST /vault/day/{day}/notes` |

A week objective can be set from 4 weeks back to 13 weeks ahead; only this week's moves the small-domino item with it, other weeks are text only. There is no delete.

**Refs.** An `item.create` line may carry `ref` (1-8 letters, digits, `-`, `_`). A later line can use `{"ref": ...}` as its target or `parent_ref` in its payload. Picking such a line needs the line it points at.

**Base.** `base` is what the author saw (the fields the line changes). When it is left out it is read at creation. At apply, if the current value differs, the line is marked `stale` and skipped. `item.create` and `log_note.create` only add, so they have no base.

## Statuses

Bundle: `pending` → `applied` (every line applied), `partly_applied` (some were skipped or stale), `rejected`, `undone`. Line: `pending`, `applied`, `skipped` (not picked), `stale`, `failed`, `undone`.

If a picked line fails, everything in that apply is rolled back, the line is marked `failed` with the error, and the bundle stays pending. If every picked line is stale, nothing is applied and the bundle stays pending.

## Undo

For each applied line the server keeps the rows it changed, before and after. Undo goes line by line from the last: if every row of the line is still exactly as the apply left it, the line is restored; otherwise it is left as it is and says why. A created item is deleted only when nothing points at it (a piece, a Map node or connector). A quarter row that an applied objective line created is kept if the quarter has streams now. Undo works for 7 days after applying.

Suggestions are working state, not part of your data: they are not in the export and an import does not touch them.

## Plugins

A plugin may define `suggestion_check(self, text: str) -> str | None`. Core registers the hook of every loaded plugin at startup and calls it on the title, the reason and every free-text field of a bundle made by code (any source other than `owner`), when it is created and again when it is applied; a returned message refuses the bundle. A `checks=` argument to `create` or `apply` adds checks, it never replaces the registered ones. The hook is optional and additive, so `PLUGIN_API_VERSION` stays 1. See [plugins.md](plugins.md).
