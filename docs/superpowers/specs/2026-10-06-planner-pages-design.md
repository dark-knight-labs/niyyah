# Planner pages: Quarter, Week, Pipelines - design

Date: 2026-10-06. The vault stays the single source of truth; Niyyah reads it and writes back (same path as /routine).

## Model: the domino chain (Keller, The ONE Thing)

```
Super Objective
 └ Quarter goal        one per stream, December northstar        (big domino)
    └ Month checkpoint   Oct / Nov / Dec
       └ Week objective    one per stream, Sunday-Saturday       (smallest domino)
          └ Today          Now lane of the stream that owns the OT slot
Pipeline: Backlog -> Next -> Now -> Done   (the supply of dominoes)
```

Streams (not blocks) carry goals. Streams are data: every `## <id>` section of the quarter note is a stream, so a new block (Errands, a second business) is added in the app or by hand, with its own goal, pipeline and weekly objective. The table below lists the built-ins, which only supply defaults. OT is one time slot serving two streams: Kahf on Sun-Thu, Alisha Noor on Fri-Sat.

| Stream | Slot | Quarter goal | Pipeline | Week objective |
|---|---|---|---|---|
| soul, body, kahf, alisha, distribution, fnf | yes | yes | yes | yes |
| finance | none (passive) | yes | yes | no |
| sleep | sleep | no | no | yes |

## Vault files

- `Calendar/Quarterly/<year>-Q<n>.md`: frontmatter `type: quarter`, then `# <Super Objective>` and one `## <stream>` section per stream with bullets `goal:`, `status:`, `oct:`, `nov:`, `dec:` (month keys follow the quarter). Editable in the app (goal, checkpoints, status, name, colour, icon, add and archive a block); reasoning still lives in Doctrine. Optional section keys: `name`, `color`, `icon`, `slot`, `weekly: yes|no`. A `status: archived` block is hidden everywhere but its notes stay.
- `Efforts/Pipeline/<stream>.md`: `## Now`, `## Next`, `## Backlog`, `## Done`, Obsidian Tasks lines `- [ ] text #nov ➕ 2026-10-02` (`#oct|#nov|#dec` ties the item to a month checkpoint; `➕` is the added date, `✅` the done date).
- `Calendar/Weekly/Objectives/<year>-Wnn.md`: existing note, one week = Sunday to Saturday (Sun-Thu weekdays, Fri-Sat weekend); stream ids replace the old block list (`OT` becomes `Kahf` and `Alisha`); a trailing `#nov` ties the objective to a checkpoint. A legacy `OT` line reads as Kahf.

## API (owner only, all under /vault)

- `GET /quarter`: super objective, quarter label, week-of-quarter, per-stream goal/status/checkpoints.
- `GET /pipelines`: every stream's items with `{path, line, hash, text, lane, checkpoint, added, done_on, age_days, stale}`.
- `POST /pipeline/{stream}/items`: add one or many lines to a lane (default backlog).
- `PUT /pipeline/move`: move an item to a lane. `PUT /pipeline/done`: tick or untick (moves to Done). `PUT /pipeline/checkpoint`: retag. `POST /pipeline/remove`.
- `PUT /objectives` gains `stream` ids and an optional `checkpoint`.
- Items are identified by path + line + hash of the line; a stale reference is refused (422) instead of editing the wrong line. Edits go through `commit_edits` (fetch, reset, apply, commit, push).

## Rules

- Now holds at most 3 open items (warning in the UI, not a hard block).
- An item with no checkpoint after 14 days is flagged stale: it may not be a domino.
- One week objective per stream; setting it from a Now item tags the objective with that item's checkpoint.

## Pages (full width, responsive)

- Sidebar: Routine, Week, Quarter, Pipelines, Vault (votes), Settings. The old Dashboard, Personas, Schedule, Principles and Tracker pages were removed in v0.10.1. Mobile gets a bottom tab bar (the sidebar was hidden below md).
- Quarter, Week, Pipelines as in the approved mock; each page shows the chain breadcrumb.
- Visual system: existing tokens plus per-stream colours (light and dark), Fraunces for page titles, Manrope for UI, Caveat for the focusing question, lucide icons per stream and a custom domino-chain SVG.

## Not in this slice

Reviews page, retiring the old DB-backed pages, drag-and-drop.

## Update 2026-10-07

- Week is Sunday to Saturday (`week_for`); old Sat-Fri weekly notes keep their stored period.
- Blocks are user-defined: `POST /quarter/stream` adds, `PUT /quarter/stream` edits or archives, `PUT /quarter` edits the Super Objective, `PUT /pipeline/text` renames an item. Colours and icons come from fixed lists the API returns.
- The OT slot still maps Sun-Thu to `kahf` and Fri-Sat to `alisha`; custom blocks have a free-text slot label only.

## Update 2026-10-07 (descriptions)

- A pipeline item can carry a description (details, context, links): the indented lines directly under its task line, so Obsidian shows them as the task's notes. They move and are removed with the item; `PUT /pipeline/description` replaces them (blank clears, max 4000 chars). `GET /pipelines` returns `description` per item. The card shows it (two lines, tap to expand) and a notes button edits it.

## Update 2026-10-07 (block notebook)

- Each block has a notebook for what the lanes cannot hold: ideas, brainstorms, links, meeting notes and blockers. File: `Efforts/Streams/<stream>.md`, one `##` entry per note, newest first, then `[kind:: meeting] [date:: 2026-10-07]` (blockers add `[status:: open|cleared]`) and free markdown. Obsidian reads the fields as Dataview inline fields. A `#`/`##` heading typed in a body is demoted to `###` so it cannot split the entry.
- API (owner only, under /vault): `GET /notebooks`; `POST /notebook/{stream}/entries {kind,title,body}`; `PUT /notebook/entry` (title, body); `PUT /notebook/blocker {open}`; `POST /notebook/remove`. Entries are identified by heading line plus a hash of the whole entry; a stale reference is refused (422), same as pipeline items. A blank title becomes the first body line, then the kind.
- Pipelines page: a Pipeline | Notebook tab bar, a red blocker bar above the lanes when the block has open blockers, and an "N blocked" count on the block pills. "Promote to backlog" on an idea, brainstorm or meeting adds its title to the Backlog lane.
- Notebook entries carry a stable `[id:: 3fa9c21b]` in their field line, assigned on creation and backfilled on any write (hand-typed entries get one at the next save). `GET /notebooks` returns it as `id`.
- Blocked by: a pipeline item can wait on notebook blockers by id. The link is a note line `blocked-by:: <id>` under the task (kept out of `description`, returned as `blocked_by`; `PUT /pipeline/blocked-by {ids}` replaces them, `PUT /pipeline/description` keeps them). The card shows a red chip per open blocker; a cleared blocker hides its chip, a deleted one shows a grey "blocker deleted" chip. Renaming a blocker keeps its links. The card's blocker icon opens a checklist of the block's blockers; one without an id yet is disabled until the note is next written.
