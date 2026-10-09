# Architecture

```
browser ──► web (Next.js)  ──► api (FastAPI) ──► PostgreSQL
                                  ▲
        tools of your own ────────┘  GET /api/v1/export  (read-only API token)
```

## API (`apps/api`)

- **Auth**: email and password, bcrypt hashes. Short-lived JWT access tokens (`SECRET_KEY`) and opaque refresh tokens stored hashed. Sign-in endpoints are rate limited in process. Registration can be closed (`REGISTRATION=closed`).
- **Planner data** lives in `planner_*` tables, every one scoped by `user_id`: tasks, log entries, goals, quarters and their streams, weekly objectives, pipeline items, notebook entries, blocks, schedule settings and rows, calendar feeds. Day records (mode, votes) are `vault_days` rows with a `user_id`. Services in `app/services/planner_*.py` read and write them; endpoints are under `/api/v1/vault/*`.
- **Per-user defaults**: a new account is seeded with a starter set of blocks and a prayer-anchored schedule (`planner_defaults.py`). Blocks, schedule, weekend days, streams and goals are all user-defined.
- **Calendar feeds**: iCal addresses are private and are fetched by the server only after an SSRF check (https, port 443, public addresses only, redirects re-checked, 5 MB cap).
- **Export and tokens**: `GET /api/v1/export` returns one user's data as versioned JSON ([format](export-format.md)). API tokens (`nyt_...`) are hashed at rest, can be revoked, and are accepted on that endpoint only.
- **Migrations**: Alembic (`apps/api/alembic`). The Docker image applies them on start when `RUN_MIGRATIONS=1`.

`STORAGE_BACKEND=vault` is a legacy single-owner mode that reads notes from a git checkout of a markdown vault. It is being removed; use `db`.

## Web (`apps/web`)

Next.js (App Router) with Tailwind and CSS variables for the theme. `lib/blocks.tsx` supplies the user's blocks to every page; `lib/vault-api.ts` is the typed API client. Pages: Overview, Plan, Vault, Settings.

## Data flow rules

- Every query filters by `user_id`; there is no shared planner data.
- Writes go through service functions that flush and let the endpoint commit once; bad input is a `ValueError` the endpoint turns into a 422 and a rollback.
