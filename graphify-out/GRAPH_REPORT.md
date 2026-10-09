# Graph Report - niyyah  (2026-10-07)

## Corpus Check
- 141 files · ~66,046 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1298 nodes · 3263 edges · 72 communities (61 shown, 11 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 214 edges (avg confidence: 0.93)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `781db934`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- vault/page.tsx
- VaultDay
- v1/auth.py
- parse_schedule
- Niyyah — Product Requirements Document
- dependencies
- User
- compilerOptions
- Niyyah Vault Dashboard — Design Spec
- devDependencies
- personas.py
- v1/tracker.py
- (app)/layout.tsx
- Base
- .next/**
- principles.py
- v1/schedule.py
- routine/page.tsx
- scripts
- update_settings
- Vault Votes Dashboard Implementation Plan
- Niyyah Vault Votes Dashboard — Design Spec (v2)
- test_google_calendar.py
- config.py
- shared-types/src/index.ts
- vault_quarter.py
- ui/package.json
- test_auth.py
- test_personas.py
- test_tracker.py
- button.tsx
- test_schedule.py
- shared-types/package.json
- get_dashboard
- README.md
- eslint.config.mjs
- postcss.config.mjs
- CLAUDE.md
- routine.ts
- v1/vault.py
- vault_pipeline.py
- week/page.tsx
- HTTPException
- vault-types.ts
- test_vault_notebook.py
- vault_write.py
- line_hash
- parse_daily_note
- test_vault_write.py
- post
- _quarter_response
- api-client.ts
- Planner pages: Quarter, Week, Pipelines - design
- web/package.json
- stream-editor.tsx
- Routine edit: mode, votes and notes written into the daily note - design
- _fresh_note
- @fontsource-variable/manrope
- @radix-ui/react-checkbox
- @radix-ui/react-dropdown-menu
- @radix-ui/react-progress
- @radix-ui/react-tabs
- @radix-ui/react-toast
- zustand

## God Nodes (most connected - your core abstractions)
1. `User` - 93 edges
2. `Base` - 30 edges
3. `_local_now()` - 24 edges
4. `VaultDay` - 23 edges
5. `parse_daily_note()` - 22 edges
6. `commit_edits()` - 21 edges
7. `parse_pipeline()` - 21 edges
8. `line_hash()` - 21 edges
9. `sync_vault()` - 19 edges
10. `add_items()` - 18 edges

## Surprising Connections (you probably didn't know these)
- `register()` --uses--> `User`  [INFERRED]
  apps/api/app/api/v1/auth.py → apps/api/app/models/user.py
- `me()` --uses--> `User`  [INFERRED]
  apps/api/app/api/v1/auth.py → apps/api/app/models/user.py
- `get_dashboard()` --uses--> `Persona`  [INFERRED]
  apps/api/app/api/v1/dashboard.py → apps/api/app/models/persona.py
- `get_dashboard()` --uses--> `ScheduleBlock`  [INFERRED]
  apps/api/app/api/v1/dashboard.py → apps/api/app/models/persona.py
- `get_dashboard()` --uses--> `DailyCheck`  [INFERRED]
  apps/api/app/api/v1/dashboard.py → apps/api/app/models/tracker.py

## Import Cycles
- None detected.

## Communities (72 total, 11 thin omitted)

### Community 0 - "vault/page.tsx"
Cohesion: 0.10
Nodes (33): currentMonth(), VaultPage(), DayHeader(), MODES, Props, Props, BlockCards(), BlockCardsProps (+25 more)

### Community 1 - "VaultDay"
Cohesion: 0.11
Nodes (46): VaultBlockVote, VaultDay, _ensure_repo(), AsyncSession, _run_git(), sync_vault(), SyncResult, AsyncClient (+38 more)

### Community 2 - "v1/auth.py"
Cohesion: 0.17
Nodes (28): login(), logout(), me(), AsyncSession, get, post, User, refresh() (+20 more)

### Community 3 - "parse_schedule"
Cohesion: 0.18
Nodes (18): parse_schedule(), ParsedSchedule, Parse the vault's Calendar/Schedule.md into a typed day-shape schedule. The…, ScheduleBlock, _split_row(), _valid_time(), AsyncClient, asyncio (+10 more)

### Community 4 - "Niyyah — Product Requirements Document"
Cohesion: 0.06
Nodes (33): 10. API Routes, 11. Frontend Pages, 12. Subscription Tiers, 13. Development Phases, 14. File & Folder Conventions, 15. Non-Functional Requirements, 16. Open Questions, 1. Vision (+25 more)

### Community 5 - "dependencies"
Cohesion: 0.12
Nodes (17): adhan, dependencies, adhan, @fontsource/caveat, @fontsource/fraunces, lucide-react, next, @radix-ui/react-dialog (+9 more)

### Community 6 - "User"
Cohesion: 0.13
Nodes (51): _can_edit(), _check_day(), _credential(), _day_edit(), _day_to_response(), edit_access(), get_blocks(), _get_day() (+43 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "Niyyah Vault Dashboard — Design Spec"
Cohesion: 0.07
Nodes (27): 10. Out of Scope (v1), 1. Purpose, 2. Architecture, 3. Vault Data Model, 4. API Endpoints, 5. Web Dashboard — Single Page, 6. What Gets Deleted, 7. What Gets Kept (+19 more)

### Community 9 - "devDependencies"
Cohesion: 0.12
Nodes (17): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+9 more)

### Community 10 - "personas.py"
Cohesion: 0.22
Nodes (23): add_milestone(), create_persona(), delete_milestone(), delete_persona(), get_persona(), list_personas(), AsyncSession, delete (+15 more)

### Community 11 - "v1/tracker.py"
Cohesion: 0.22
Nodes (23): check_item(), create_non_negotiable(), delete_non_negotiable(), get_today(), list_non_negotiables(), AsyncSession, delete, get (+15 more)

### Community 12 - "(app)/layout.tsx"
Cohesion: 0.14
Nodes (16): AppLayout(), nav, PUBLIC_PATHS, LoginPage(), handleSubmit(), RegisterPage(), handleSubmit(), useAuth() (+8 more)

### Community 13 - "Base"
Cohesion: 0.18
Nodes (14): do_run_migrations(), run_async_migrations(), run_migrations_online(), Base, get_db(), AsyncSession, get_current_user(), AsyncSession (+6 more)

### Community 14 - ".next/**"
Cohesion: 0.08
Nodes (17): nextConfig, metadata, metadata, metadata, ^build, .next/**, !.next/cache/**, dependsOn (+9 more)

### Community 15 - "principles.py"
Cohesion: 0.24
Nodes (15): create_principle(), delete_principle(), list_principles(), AsyncSession, delete, get, patch, post (+7 more)

### Community 16 - "v1/schedule.py"
Cohesion: 0.24
Nodes (15): create_block(), delete_block(), list_blocks(), AsyncSession, delete, get, patch, post (+7 more)

### Community 17 - "routine/page.tsx"
Cohesion: 0.10
Nodes (22): AddEventForm(), ConnectButton(), nextHalfHour(), plusHour(), Checkbox(), EditableRow(), Props, LogList() (+14 more)

### Community 18 - "scripts"
Cohesion: 0.12
Nodes (16): devDependencies, turbo, turbo, name, packageManager, private, scripts, build (+8 more)

### Community 19 - "update_settings"
Cohesion: 0.24
Nodes (9): get_settings(), AsyncSession, get, patch, User, update_settings(), BaseModel, UserSettingsResponse (+1 more)

### Community 20 - "Vault Votes Dashboard Implementation Plan"
Cohesion: 0.12
Nodes (15): Global Constraints, Post-Implementation Checklist, Task 10: Weekly Pulse + Monthly Heatmap, Task 11: Block Trends + Footer Stats (Final Page Assembly), Task 12: K8s Wiring, Migration Rollout, GitLab Webhook, Task 1: Vault DB Models, Task 2: Alembic Migration for Vault Tables, Task 3: Vault Markdown Parser (+7 more)

### Community 21 - "Niyyah Vault Votes Dashboard — Design Spec (v2)"
Cohesion: 0.13
Nodes (14): 10. Out of Scope (v1), 11. Environment Variables / Secrets, 12. Rollout Plan, 1. Purpose, 2. Why this supersedes the 2026-08-14 spec, 3. Architecture, 4. Data Model, 5. Vault Parsing Rules (+6 more)

### Community 22 - "test_google_calendar.py"
Cohesion: 0.07
Nodes (54): access_token(), _api(), build_auth_url(), exchange_code(), GoogleCalendarError, insert_event(), list_events(), make_state() (+46 more)

### Community 23 - "config.py"
Cohesion: 0.16
Nodes (12): Settings, health(), get, auth_client(), client(), event_loop(), override_get_db(), AsyncClient (+4 more)

### Community 24 - "shared-types/src/index.ts"
Cohesion: 0.17
Nodes (11): DailyCheck, DashboardData, Milestone, NonNegotiable, Persona, Principle, ScheduleBlock, Streak (+3 more)

### Community 25 - "vault_quarter.py"
Cohesion: 0.08
Nodes (46): _lookup(), parse_objectives(), date, Weekly objectives: one line per stream, one file per week (Sunday to Saturday).…, Names a line may carry (display name, id, old label) -> stream id; real names…, One {stream, text, done, checkpoint} per weekly stream in order; streams…, Set the text, done flag and/or checkpoint of one stream ('' clears the…, update_objective() (+38 more)

### Community 26 - "ui/package.json"
Cohesion: 0.18
Nodes (10): react, react-dom, main, name, peerDependencies, react, react-dom, private (+2 more)

### Community 27 - "test_auth.py"
Cohesion: 0.44
Nodes (10): AsyncClient, asyncio, test_login(), test_login_wrong_password(), test_logout(), test_me(), test_refresh_token(), test_refresh_token_survives_concurrent_use() (+2 more)

### Community 28 - "test_personas.py"
Cohesion: 0.50
Nodes (8): AsyncClient, asyncio, test_add_milestone(), test_create_persona(), test_delete_persona(), test_list_personas(), test_persona_not_found(), test_update_persona()

### Community 29 - "test_tracker.py"
Cohesion: 0.54
Nodes (7): AsyncClient, asyncio, test_check_item(), test_create_non_negotiable(), test_duplicate_check(), test_streak_increments(), test_today_endpoint()

### Community 30 - "button.tsx"
Cohesion: 0.32
Nodes (5): Button(), ButtonProps, sizes, variants, Spinner()

### Community 31 - "test_schedule.py"
Cohesion: 0.60
Nodes (5): AsyncClient, asyncio, test_create_schedule_block(), test_delete_schedule_block(), test_list_schedule()

### Community 32 - "shared-types/package.json"
Cohesion: 0.33
Nodes (5): main, name, private, types, version

### Community 33 - "get_dashboard"
Cohesion: 0.50
Nodes (4): get_dashboard(), AsyncSession, get, User

### Community 34 - "README.md"
Cohesion: 0.50
Nodes (3): Deploy on Vercel, Getting Started, Learn More

### Community 45 - "routine.ts"
Cohesion: 0.12
Nodes (43): RoutinePage(), CalendarCard(), FullScreenClock(), Props, NowCard(), RingGraphic(), RingGraphicProps, SideLabels() (+35 more)

### Community 46 - "v1/vault.py"
Cohesion: 0.11
Nodes (45): get_schedule(), CalendarEventIn, CalendarEventResponse, CalendarEventsResponse, EditAccessResponse, GoogleConnectResponse, GoogleStatusResponse, LogEntryIn (+37 more)

### Community 47 - "vault_pipeline.py"
Cohesion: 0.11
Nodes (47): add_items(), _clean(), _description(), _find(), find_focus(), _lane_of(), _lines(), move_item() (+39 more)

### Community 48 - "week/page.tsx"
Cohesion: 0.11
Nodes (33): LANES, MONTH_ORDER, PipelinesPage(), add(), run(), QuarterPage(), run(), save() (+25 more)

### Community 49 - "HTTPException"
Cohesion: 0.11
Nodes (42): _info(), _item_at(), _local_now(), _notebooks_response(), _objectives_response(), _pipelines_response(), post_notebook_entry(), post_pipeline_items() (+34 more)

### Community 50 - "vault-types.ts"
Cohesion: 0.12
Nodes (27): CardProps, KIND, KINDS, Notebook(), Props, Props, Props, message() (+19 more)

### Community 51 - "test_vault_notebook.py"
Cohesion: 0.14
Nodes (30): add_entry(), _blocks(), _clean(), _find(), notebook_path(), parse_notebook(), date, Stream notebooks: one note per stream, Efforts/Streams/<stream>.md, for what… (+22 more)

### Community 52 - "vault_write.py"
Cohesion: 0.10
Nodes (28): add_log_note(), _blank_section(), edit_log_entry(), _frontmatter_bounds(), _log_bounds(), log_entries(), _log_line(), _log_positions() (+20 more)

### Community 53 - "line_hash"
Cohesion: 0.13
Nodes (24): find_tasks(), _label(), line_hash(), _markdown_files(), Path, Obsidian Tasks lines for one day: find them across the vault and tick them off.…, Delete the task on 1-based `line`., Resolve a vault-relative markdown path, refusing anything outside the vault or… (+16 more)

### Community 54 - "parse_daily_note"
Cohesion: 0.14
Nodes (22): _extract_section(), _parse_blocks(), parse_daily_note(), ParsedDay, date, _split_frontmatter(), Make `stars` (0-3) the vote for `block`: tick that level, untick the others., set_vote() (+14 more)

### Community 55 - "test_vault_write.py"
Cohesion: 0.19
Nodes (23): add_task(), Add '- [ ] text ⏳ day' at the end of the note's '## Tasks' section (after its…, set_mode(), _git(), AsyncClient, asyncio, fixture, _remote_file() (+15 more)

### Community 56 - "post"
Cohesion: 0.12
Nodes (17): post_notebook_remove(), post_task_remove(), put_notebook_blocker(), put_notebook_entry(), put_pipeline_checkpoint(), put_pipeline_description(), put_pipeline_text(), post (+9 more)

### Community 57 - "_quarter_response"
Cohesion: 0.27
Nodes (13): _fields(), post_stream(), put_stream(), put_super_objective(), _quarter_response(), _save_quarter(), QuarterResponse, Fields of one stream to change; month checkpoints go in `checkpoints` keyed by… (+5 more)

### Community 58 - "api-client.ts"
Cohesion: 0.24
Nodes (8): SettingsPage(), UserSettings, api, ApiError, httpError(), refreshSession(), request(), RequestOptions

### Community 59 - "Planner pages: Quarter, Week, Pipelines - design"
Cohesion: 0.18
Nodes (10): API (owner only, all under /vault), Model: the domino chain (Keller, The ONE Thing), Not in this slice, Pages (full width, responsive), Planner pages: Quarter, Week, Pipelines - design, Rules, Update 2026-10-07, Update 2026-10-07 (block notebook) (+2 more)

### Community 60 - "web/package.json"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 61 - "stream-editor.tsx"
Cohesion: 0.36
Nodes (7): slug(), STATUSES, StreamEditor(), newId(), save(), colorVar(), ICONS

### Community 62 - "Routine edit: mode, votes and notes written into the daily note - design"
Cohesion: 0.33
Nodes (5): Access, How it is saved, Not done, Routine edit: mode, votes and notes written into the daily note - design, What

## Knowledge Gaps
- **221 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+216 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `User` to `get_dashboard`, `v1/auth.py`, `personas.py`, `v1/tracker.py`, `Base`, `v1/vault.py`, `principles.py`, `v1/schedule.py`, `HTTPException`, `update_settings`, `post`, `_quarter_response`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Why does `new_daily_note()` connect `vault_write.py` to `_fresh_note`, `v1/vault.py`, `test_vault_write.py`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `set_vote()` connect `parse_daily_note` to `vault_write.py`, `test_vault_write.py`, `v1/vault.py`, `User`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 77 inferred relationships involving `User` (e.g. with `me()` and `register()`) actually correct?**
  _`User` has 77 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `HTTPException` (e.g. with `login()` and `refresh()`) actually correct?**
  _`HTTPException` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `Base` (e.g. with `setup_db()` and `test_block_vote_unique_per_day()`) actually correct?**
  _`Base` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _221 weakly-connected nodes found - possible documentation gaps or missing edges._