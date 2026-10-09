# Graph Report - niyyah  (2026-10-05)

## Corpus Check
- 101 files · ~36,387 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 737 nodes · 1452 edges · 45 communities (42 shown, 3 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 117 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a0f5ce2f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- vault/page.tsx
- VaultDay
- v1/auth.py
- parse_daily_note
- Niyyah — Product Requirements Document
- dependencies
- v1/vault.py
- compilerOptions
- Niyyah Vault Dashboard — Design Spec
- devDependencies
- personas.py
- User
- (app)/layout.tsx
- Base
- tasks
- principles.py
- v1/schedule.py
- dashboard/page.tsx
- scripts
- get_current_user
- Vault Votes Dashboard Implementation Plan
- Niyyah Vault Votes Dashboard — Design Spec (v2)
- test_vault_endpoints.py
- main.py
- shared-types/src/index.ts
- tracker/page.tsx
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

## God Nodes (most connected - your core abstractions)
1. `User` - 55 edges
2. `Base` - 28 edges
3. `VaultDay` - 23 edges
4. `sync_vault()` - 18 edges
5. `Niyyah — Product Requirements Document` - 17 edges
6. `Persona` - 16 edges
7. `parse_daily_note()` - 16 edges
8. `compilerOptions` - 16 edges
9. `parse_schedule()` - 15 edges
10. `Vault Votes Dashboard Implementation Plan` - 15 edges

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

## Communities (45 total, 3 thin omitted)

### Community 0 - "vault/page.tsx"
Cohesion: 0.05
Nodes (67): Milestone, Persona, PersonasPage(), Principle, PrinciplesPage(), RoutinePage(), SettingsPage(), UserSettings (+59 more)

### Community 1 - "VaultDay"
Cohesion: 0.14
Nodes (33): VaultBlockVote, VaultDay, _ensure_repo(), AsyncSession, _run_git(), sync_vault(), SyncResult, asyncio (+25 more)

### Community 2 - "v1/auth.py"
Cohesion: 0.15
Nodes (30): login(), logout(), me(), AsyncSession, get, post, User, refresh() (+22 more)

### Community 3 - "parse_daily_note"
Cohesion: 0.11
Nodes (30): _extract_section(), _parse_blocks(), parse_daily_note(), ParsedDay, date, _split_frontmatter(), parse_schedule(), ParsedSchedule (+22 more)

### Community 4 - "Niyyah — Product Requirements Document"
Cohesion: 0.06
Nodes (33): 10. API Routes, 11. Frontend Pages, 12. Subscription Tiers, 13. Development Phases, 14. File & Folder Conventions, 15. Non-Functional Requirements, 16. Open Questions, 1. Vision (+25 more)

### Community 5 - "dependencies"
Cohesion: 0.06
Nodes (31): adhan, dependencies, adhan, @fontsource/caveat, @fontsource/fraunces, @fontsource-variable/manrope, lucide-react, next (+23 more)

### Community 6 - "v1/vault.py"
Cohesion: 0.19
Nodes (28): _day_to_response(), get_blocks(), _get_day(), _get_days_range(), get_month(), get_schedule(), get_streaks(), get_today() (+20 more)

### Community 7 - "compilerOptions"
Cohesion: 0.07
Nodes (28): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+20 more)

### Community 8 - "Niyyah Vault Dashboard — Design Spec"
Cohesion: 0.07
Nodes (27): 10. Out of Scope (v1), 1. Purpose, 2. Architecture, 3. Vault Data Model, 4. API Endpoints, 5. Web Dashboard — Single Page, 6. What Gets Deleted, 7. What Gets Kept (+19 more)

### Community 9 - "devDependencies"
Cohesion: 0.08
Nodes (25): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node, @types/react, @types/react-dom (+17 more)

### Community 10 - "personas.py"
Cohesion: 0.22
Nodes (23): add_milestone(), create_persona(), delete_milestone(), delete_persona(), get_persona(), list_personas(), AsyncSession, delete (+15 more)

### Community 11 - "User"
Cohesion: 0.23
Nodes (23): check_item(), create_non_negotiable(), delete_non_negotiable(), get_today(), list_non_negotiables(), AsyncSession, delete, get (+15 more)

### Community 12 - "(app)/layout.tsx"
Cohesion: 0.13
Nodes (14): AppLayout(), nav, LoginPage(), handleSubmit(), RegisterPage(), handleSubmit(), useAuth(), User (+6 more)

### Community 13 - "Base"
Cohesion: 0.24
Nodes (10): do_run_migrations(), run_async_migrations(), run_migrations_online(), Base, get_db(), AsyncSession, DailyCheck, Streak (+2 more)

### Community 14 - "tasks"
Cohesion: 0.11
Nodes (15): nextConfig, metadata, ^build, .next/**, !.next/cache/**, dependsOn, outputs, cache (+7 more)

### Community 15 - "principles.py"
Cohesion: 0.24
Nodes (15): create_principle(), delete_principle(), list_principles(), AsyncSession, delete, get, patch, post (+7 more)

### Community 16 - "v1/schedule.py"
Cohesion: 0.24
Nodes (15): create_block(), delete_block(), list_blocks(), AsyncSession, delete, get, patch, post (+7 more)

### Community 17 - "dashboard/page.tsx"
Cohesion: 0.20
Nodes (10): DashboardData, DashboardPage(), timeToMinutes(), Block, Persona, SchedulePage(), ScheduleBlock, timeToMinutes() (+2 more)

### Community 18 - "scripts"
Cohesion: 0.12
Nodes (16): devDependencies, turbo, turbo, name, packageManager, private, scripts, build (+8 more)

### Community 19 - "get_current_user"
Cohesion: 0.17
Nodes (14): get_settings(), AsyncSession, get, patch, User, update_settings(), get_current_user(), AsyncSession (+6 more)

### Community 20 - "Vault Votes Dashboard Implementation Plan"
Cohesion: 0.12
Nodes (15): Global Constraints, Post-Implementation Checklist, Task 10: Weekly Pulse + Monthly Heatmap, Task 11: Block Trends + Footer Stats (Final Page Assembly), Task 12: K8s Wiring, Migration Rollout, GitLab Webhook, Task 1: Vault DB Models, Task 2: Alembic Migration for Vault Tables, Task 3: Vault Markdown Parser (+7 more)

### Community 21 - "Niyyah Vault Votes Dashboard — Design Spec (v2)"
Cohesion: 0.13
Nodes (14): 10. Out of Scope (v1), 11. Environment Variables / Secrets, 12. Rollout Plan, 1. Purpose, 2. Why this supersedes the 2026-08-14 spec, 3. Architecture, 4. Data Model, 5. Vault Parsing Rules (+6 more)

### Community 22 - "test_vault_endpoints.py"
Cohesion: 0.38
Nodes (13): AsyncClient, asyncio, fixture, seed_day(), test_blocks_accepts_max_bound_days(), test_blocks_rejects_out_of_range_days(), test_blocks_returns_date_aligned_series_and_averages(), test_month_filters_and_computes_mode_distribution() (+5 more)

### Community 23 - "main.py"
Cohesion: 0.21
Nodes (10): health(), get, auth_client(), client(), event_loop(), override_get_db(), AsyncClient, AsyncSession (+2 more)

### Community 24 - "shared-types/src/index.ts"
Cohesion: 0.17
Nodes (11): DailyCheck, DashboardData, Milestone, NonNegotiable, Persona, Principle, ScheduleBlock, Streak (+3 more)

### Community 25 - "tracker/page.tsx"
Cohesion: 0.25
Nodes (10): DailyCheck, NonNegotiable, Streak, TrackerDay, TrackerPage(), handleCheck(), handleCreate(), handleDeleteNN() (+2 more)

### Community 26 - "ui/package.json"
Cohesion: 0.18
Nodes (10): react, react-dom, main, name, peerDependencies, react, react-dom, private (+2 more)

### Community 27 - "test_auth.py"
Cohesion: 0.47
Nodes (9): AsyncClient, asyncio, test_login(), test_login_wrong_password(), test_logout(), test_me(), test_refresh_token(), test_register() (+1 more)

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

## Knowledge Gaps
- **208 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+203 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `User` connect `User` to `get_dashboard`, `v1/auth.py`, `v1/vault.py`, `personas.py`, `Base`, `principles.py`, `v1/schedule.py`, `get_current_user`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `Base` connect `Base` to `VaultDay`, `v1/auth.py`, `personas.py`, `User`, `principles.py`, `v1/schedule.py`, `main.py`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Why does `VaultDay` connect `VaultDay` to `Base`, `v1/vault.py`, `test_vault_endpoints.py`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Are the 39 inferred relationships involving `User` (e.g. with `me()` and `register()`) actually correct?**
  _`User` has 39 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `Base` (e.g. with `setup_db()` and `test_block_vote_unique_per_day()`) actually correct?**
  _`Base` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `VaultDay` (e.g. with `_day_to_response()` and `_get_day()`) actually correct?**
  _`VaultDay` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `sync_vault()` (e.g. with `_ensure_repo()` and `Path`) actually correct?**
  _`sync_vault()` has 2 INFERRED edges - model-reasoned connections that need verification._