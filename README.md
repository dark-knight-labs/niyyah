# Niyyah

A personal planner built around intention (*niyyah*): a clock of your day, your goals, the streams of work you are pushing forward, and a daily log. It is self-hosted, supports many users per installation with strict per-user isolation, and keeps everything in your own PostgreSQL database.

Created and maintained by [Alamin Mahamud](https://github.com/alamin-mahamud). Released under the [MIT License](LICENSE): use it, change it, ship it, keep the copyright notice.

## What it does

- **Overview**: today's mode and votes, a 24-hour ring of your blocks with prayer times, tasks, a timestamped log, calendar events (iCal feeds, optional Google Calendar) and your goals.
- **Plan**: a quarter objective, streams with month checkpoints, a weekly objective per stream, and a pipeline (Now / Next / Backlog / Done) with a notebook for ideas, meetings and blockers.
- **Vault**: your history, streaks and star totals.
- **Settings**: your location and prayer method, the blocks of your day, the weekly schedule, calendars, goals, API tokens and theme. A new account starts from a sensible template and everything is editable.
- **Your data is yours**: `GET /api/v1/export` returns all of it as JSON ([format](docs/export-format.md)), and read-only API tokens let a tool of your own copy it elsewhere.

## Run it

You need Docker with Compose.

```bash
cp .env.example .env
# put two generated secrets in .env (SECRET_KEY and POSTGRES_PASSWORD), see the comments in the file
docker compose up --build
```

Open http://localhost:3000 and create an account. The first start creates the database schema. More in [docs/self-hosting.md](docs/self-hosting.md): putting it behind a domain, turning registration off, backups, upgrades.

## Develop

```bash
make dev                     # Postgres on 127.0.0.1:5432
cd apps/api && pip install -r requirements-dev.txt && python -m pytest -q
cd apps/web && npm install && npm run dev
```

`apps/api` is FastAPI with SQLAlchemy and Alembic; `apps/web` is Next.js. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

The API refuses to start in production with a placeholder or short `SECRET_KEY`. Sign-in endpoints are rate limited, registration can be closed, and API tokens work only on the export endpoint. Report a vulnerability as described in [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SECRET_KEY` | none (required) | Signs login tokens. At least 32 random characters. |
| `DATABASE_URL` | local Postgres | `postgresql+asyncpg://user:password@host:5432/db` |
| `APP_ENV` | `production` | `development` allows placeholder secrets for local work. |
| `STORAGE_BACKEND` | `vault` | Use `db`. The `vault` mode is a legacy single-owner mode that is being removed. |
| `REGISTRATION` | `open` | `closed` turns account creation off. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated web origins allowed to call the API. |
| `TRUST_FORWARDED_FOR` | `false` | Trust `X-Forwarded-For` from your reverse proxy for rate limits. |
| `RUN_MIGRATIONS` | `0` | The Docker image runs `alembic upgrade head` on start when `1`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | Optional Google Calendar. |
