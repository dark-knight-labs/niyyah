# Architecture

```
browser ──► web (Next.js)  ──► api (FastAPI) ──► PostgreSQL
                                  ▲
        tools of your own ────────┘  GET /api/v1/export  (read-only API token)
```

## API (`apps/api`)

- **Auth**: email and password, bcrypt hashes. Short-lived JWT access tokens (`SECRET_KEY`) and opaque refresh tokens stored hashed. Sign-in endpoints are rate limited in process. Registration can be closed (`REGISTRATION=closed`).
- **Planner data** lives in `planner_*` tables, every one scoped by `user_id`: tasks, log entries, goals, quarters and their streams, weekly objectives, pipeline items, notebook entries, blocks, schedule settings and rows, calendar feeds. Day records (mode, votes) are `vault_days` rows with a `user_id`. Services in `app/services/planner_*.py` read and write them, `rules.py` holds the vocabulary and validation they share; endpoints are under `/api/v1/vault/*` (the name comes from the Vault history page).
- **Per-user defaults**: a new account is seeded with a starter set of blocks and a prayer-anchored schedule (`planner_defaults.py`). Blocks, schedule, weekend days, streams and goals are all user-defined.
- **Calendar feeds**: iCal addresses are private and are fetched by the server only after an SSRF check (https, port 443, public addresses only, redirects re-checked, 5 MB cap).
- **Export, import and tokens**: `GET /api/v1/export` returns one user's data as versioned JSON ([format](export-format.md)). `POST /api/v1/import?replace=true` is its inverse (signed-in session only). API tokens (`nyt_...`) are hashed at rest, can be revoked, and are accepted on the export endpoint only.
- **Migrations**: Alembic (`apps/api/alembic`). The Docker image applies them on start when `RUN_MIGRATIONS=1`.

Everything lives in the database. Moving in from a folder of markdown notes (an Obsidian vault, for instance) is a one-time conversion to the export format, done by a separate tool, then `POST /api/v1/import`; mirroring out again is a separate tool reading the export.

## Web (`apps/web`)

Next.js (App Router) with Tailwind and CSS variables for the theme. `lib/blocks.tsx` supplies the user's blocks to every page; `lib/vault-api.ts` is the typed API client. Pages: Overview, Plan, Vault, Settings.

## Data flow rules

- Every query filters by `user_id`; there is no shared planner data.
- Writes go through service functions that flush and let the endpoint commit once; bad input is a `ValueError` the endpoint turns into a 422 and a rollback.
