# Settings and user-defined blocks (storage phase 4)

Date: 2026-10-09. Status: built (see Result at the end); design and mock approved by the owner (mock: https://claude.ai/artifact/Q7Ffwr4FHcRkEXxjQqLcpR). Part of `2026-10-08-db-storage-design.md`, phase 4.

## Goal

A new user can make Niyyah theirs without touching code: set their location and prayer method, define the blocks of their day, lay those blocks out on a weekly schedule, say which stream owns a slot, and add their calendars. Everything the app still hard-codes for the owner's routine becomes data.

## What is hard-coded today

- Two overlapping block lists: vote blocks (`CANONICAL_BLOCKS` in the API, `BLOCK_ORDER`, `BLOCK_LABELS`, `BLOCK_COLORS` in `vault-constants.ts`) and clock blocks (`SCHEDULE_BLOCKS` in the API, `ROUTINE_BLOCKS` and `RING_NAMES` in the web app). Ring names and colours are code constants. One OT block replaces the older ONE Thing and OPS pair for 2026-10-06 to 2026-12-31.
- The weekend is Friday and Saturday (`dayTypeFor`).
- The OT slot belongs to Kahf on Sunday to Thursday and Alisha Noor on Friday and Saturday (`otStreamFor`).
- The star ceiling of a day comes from a mode table written for seven blocks, scaled by 6/7 when the merged OT block is present.

## Decisions

| Question | Decision |
|---|---|
| Block model | One per-user list of blocks replaces both lists. A block has a key, a label, a short ring name, a colour (one of the 12 stream colour keys) and a "counts for stars" switch. It appears on the clock when the schedule uses it and in votes when it counts for stars. Retired blocks are archived, never deleted, so old votes still resolve. |
| Stream owner of a slot | An optional `stream` on each schedule row. It replaces `otStreamFor`. |
| Weekend | A list of weekdays in the schedule settings. New accounts default to Saturday and Sunday. The owner's import sets Friday and Saturday. |
| Star ceiling | `round(mode_factor * 3 * counted_blocks)` where `mode_factor = base / 21` from the existing mode table. This gives the same numbers as today for seven blocks (legacy days) and for six (merged OT days), and works for any block list. |
| New accounts | Registration in `db` mode seeds a starter template: Soul, Body, Deep work, Planning, Family and friends, Sleep, with a prayer-anchored weekday and weekend schedule. Location starts empty and the clock asks for it. The owner's personal block names and streams are not in the template. |
| Streams | No new editor. The Plan page already edits them; Settings links there. |
| Theme | Stays in the existing `/settings` endpoint (`UserSettings.theme`) and `useTheme`. The old super-objective and latitude fields leave the page; the Plan page and the schedule settings own those. |
| Production | `STORAGE_BACKEND` stays `vault`. In vault mode the new read endpoints return the default block list, `weekend_days = [fri, sat]` and the legacy OT-stream rule applied server-side, so the owner's pages keep their behaviour on the new frontend. The write endpoints answer 501 in vault mode. |

## Data

- `planner_blocks(user_id, key, label, ring_name, color, counts_for_stars, position, archived)`, unique `(user_id, key)`.
- `planner_schedule_blocks` gains `stream` (nullable slug).
- `planner_schedule_settings.meta` gains `weekend_days` (list of `mon`..`sun`); `lat`, `lon`, `tz`, `method`, `madhab` may be null on a new account.
- `planner_calendar_feeds` already exists (phase 3).

## API (all under `/vault/config`, signed-in user, own rows only)

- `GET /blocks` returns the ordered list including archived blocks. `PUT /blocks` takes the whole ordered list; the server creates, updates, reorders and archives. A key that existing votes or schedule rows use is never deleted: omitting it archives it. Keys are slugs and cannot change after creation.
- `PUT /schedule` takes `{meta, weekday: [...], weekend: [...]}`. It validates times (`HH:MM` or a prayer anchor with an offset), that each block exists and is not archived, that each stream is a stream of the current quarter, and that the location and `weekend_days` are valid. Overlap warnings are computed in the web app only, because prayer anchors are resolved there.
- `GET /feeds` lists feeds with the URL masked to its host. `POST /feeds` adds one (https only). `DELETE /feeds/{id}` removes one. The full URL is never returned.
- `GET /vault/schedule` rows gain `stream`; its `meta` gains `weekend_days`.
- In `db` mode vote validation, the new-day layout and the `/vault/blocks?days=` series use the user's blocks. A new day is created with the user's current counted, non-archived blocks.

## Web

- `BlocksProvider` and `useBlocks()` replace every hard-coded list: labels, colours, ring names, order, "which blocks does a day show". Unknown keys (old data) render with their key as the label and a neutral colour.
- `resolveDay` reads block keys from the provider, the weekend from `meta.weekend_days`, and each row's `stream`. The Overview and the Plan week strip find a slot's stream from the schedule row.
- A new account without a location sees a "Set your location" prompt where the clock goes.
- The Settings page follows the approved mock: Location and prayers with weekend days, Blocks, Weekly schedule with a live clock preview, Calendars, Appearance.

## Out of scope

User-defined modes, a seven-day schedule, a streams editor in Settings, export, and the cutover of the owner's data (phase 5).

## Testing

- API: block replace (create, rename, reorder, archive, refuse to delete used keys), schedule validation (bad time, unknown block, unknown stream, overlap warning), feeds masking, seeding at registration, the star ceiling for 2, 6 and 7 blocks, votes on a custom block, a new day built from current blocks, and isolation between two users.
- A new-account journey test: register, seeded, set location, add a block, schedule it, vote on it, read the Vault series.
- Web: `tsc` and `next build`; then the app run locally in `db` mode and the pages driven in a browser (Overview, Vault, Plan, Settings) at desktop and phone widths, light and dark.

## Result (2026-10-09)

Built as specified, with these changes found while building and running it:

- Block keys are at most 20 characters, the width of the existing `block` columns on votes and schedule rows.
- A block that a day does not have yet joins that day on its first vote, so adding a block mid-day works.
- A new day is created from the user's current counted blocks, not by copying the previous day. The star ceiling is `round(mode_base * counted_blocks / 7)`.
- Calendar addresses are fetched by the server, so they are checked to be https, on the standard port, and to resolve only to public hosts; every redirect hop is checked again and the response is capped at 5 MB.
- A new account is never lent the owner's built-in streams. Its first look at the Plan page creates the quarter with the placeholder objective and no streams.
- In db mode the Vault page shows "N days logged" and no Sync button; `POST /vault/sync` answers 409.
- `GET /vault/schedule` rows carry `stream` and its `meta` carries `weekend_days` in both modes; vault mode derives them from the old rules, so the owner's pages behave as before.

Checked by running the app locally: a new account in db mode (register, set location, add a block, schedule it, vote on it, archive refusal, calendar address masking) and the same pages in vault mode against a fixture vault (public clock, Overview, Vault, Plan). No horizontal overflow at 390 px on Overview, Plan, Vault or Settings; dark mode checked on Overview.

Not done, and left for later: an editor for the Overview goals in db mode (the table and read path exist), user-defined modes, and one word for two things: the Plan page calls a stream a "block" while Settings uses "block" for a part of the day.
