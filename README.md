<div align="center">

# Niyyah

**A calm, self-hosted planner for people who plan their day around prayer and intention.**

Your day as a 24-hour ring, a few honest votes at night, one quarter objective that everything else serves, and a pipeline that says what is next. Nothing else.

[Run it](#run-it) · [What's inside](#whats-inside) · [Your data](#your-data-stays-yours) · [Develop](#develop) · [Docs](docs/)

![The Overview page: the day as a ring with prayer times, votes, tasks, log and the work table](docs/images/overview.png)

</div>

## Why

*Niyyah* (نِيَّة) is intention: the idea that what you do counts for what you meant by it. Most planners are built around deadlines. Niyyah is built around **a day with a shape** (prayers, work, family, sleep), **an honest look back** at how it went, and **one objective per quarter** that the small things add up to.

It is small on purpose. No notifications, no streak guilt, no feed. You open it, see your day, vote on it, move one thing forward, and close it.

## What's inside

| | |
|---|---|
| **Overview** | Today at a glance: your day on a 24-hour ring with prayer times and the block you are in now, the day's mode, a vote per block, tasks, a timestamped log, calendar events and your goals. |
| **Plan** | One objective for the quarter. Streams of work under it, each with a goal and month checkpoints, a weekly objective (the *small domino*), a pipeline (Now / Next / Backlog / Done) and a notebook for ideas, meetings and blockers. |
| **Vault** | The long view: this week's spread, a monthly heatmap, block trends over 30 days, the modes you have chosen, and streaks. |
| **Settings** | Where you are and how prayer times are calculated, the blocks of your day, the weekly schedule with a live preview of the ring, calendars, goals, API tokens and theme. |

<table>
<tr>
<td width="50%"><img src="docs/images/plan.png" alt="The Plan page"></td>
<td width="50%"><img src="docs/images/vault.png" alt="The Vault page"></td>
</tr>
<tr>
<td><img src="docs/images/settings.png" alt="Settings"></td>
<td><img src="docs/images/overview-mobile.png" alt="Overview on a phone" width="260"></td>
</tr>
</table>

### The ideas, in one minute

- **Blocks** are the parts of your day (Soul, Body, Deep work, Family, Sleep, whatever yours are). You define them, give each a colour, and lay them out on a weekly schedule. Prayer times anchor the schedule (`fajr`, `dhuhr+25`, `asr-15`), so the ring follows the sun.
- **Votes and stars.** At the end of a block you give it 0 to 3 stars. A day's ceiling comes from its **mode** (full, yellow, compressed, minimal, off, ramadan, fasting): a hard day has a lower bar, and you are measured against it, not against a perfect day.
- **Streams** are the long-running threads of your life or work. Each has one goal per quarter, month checkpoints, one **small domino** per week, and a pipeline. A stream can own a slot of your schedule, so the Overview knows what today's deep-work block is *for*.
- **Pipeline lanes** keep you honest: at most three things in *Now*, a queue in *Next*, and a *Backlog* that tells you when an item has gone stale.
- **Blockers** in a stream's notebook link to the pipeline items they hold up, so "waiting on legal" shows on the card.

New accounts start from a sensible template (Soul, Body, Deep work, Planning, Family and friends, Sleep, with a prayer-anchored schedule). Everything is editable and nothing is hard-coded.

## Run it

You need Docker with Compose.

```bash
git clone https://github.com/dark-knight-labs/niyyah.git && cd niyyah
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # run twice: put the results in SECRET_KEY and POSTGRES_PASSWORD
docker compose up --build
```

Open <http://localhost:3000>, create an account, and open **Settings** to set your location. The first start creates the database schema.

Going public with a domain, turning registration off, backups and upgrades are in [docs/self-hosting.md](docs/self-hosting.md).

## Your data stays yours

- **Per-user isolation.** Every row belongs to a user and every query filters by it. Many people can share one installation without seeing each other.
- **Export everything.** `GET /api/v1/export` returns your whole account as JSON ([format](docs/export-format.md)). It is versioned, supports `ETag`, and never includes calendar addresses.
- **Import it back.** `POST /api/v1/import?replace=true` loads such a file into an account, which is how you move between installations or from another tool.
- **Mirror it elsewhere.** Create a read-only **API token** in Settings and let a tool of your own poll the export. A token can read your export and nothing else; revoke it and it stops at once. (The author uses this to keep a read-only copy in an Obsidian vault.)

## Security

- The API **refuses to start** in production with a placeholder or short `SECRET_KEY`.
- Passwords are bcrypt-hashed; access tokens are short-lived and refresh tokens are opaque and stored hashed.
- Sign-in endpoints are **rate limited**, per address and per account. Behind a reverse proxy, set `TRUSTED_PROXY_HOPS` so limits see real visitors (a client cannot spoof its way around them).
- Registration can be closed (`REGISTRATION=closed`).
- Calendar feeds are fetched by the server only after an **SSRF check** (https, port 443, public addresses only, every redirect re-checked, size capped).
- Secrets scanning runs in CI.

Found a problem? See [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SECRET_KEY` | none (required) | Signs login tokens. At least 32 random characters. |
| `DATABASE_URL` | local Postgres | `postgresql+asyncpg://user:password@host:5432/db` |
| `APP_ENV` | `production` | `development` allows placeholder secrets for local work. |
| `APP_TIMEZONE` | `UTC` | Decides what "today" is, e.g. `Europe/London`. |
| `REGISTRATION` | `open` | `closed` turns account creation off. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated web origins allowed to call the API. |
| `TRUSTED_PROXY_HOPS` | `0` | Number of reverse proxies in front of the API, for rate limits. |
| `RUN_MIGRATIONS` | `0` | The Docker image runs `alembic upgrade head` on start when `1`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | Optional: add events to Google Calendar from the Overview. |

The web build also takes `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_OPERATOR_CONTACT` and `NEXT_PUBLIC_SITE_URL` (see `.env.example`); they are baked in at build time.

## How it's built

```
browser ──► web (Next.js)  ──► api (FastAPI) ──► PostgreSQL
                                  ▲
        tools of your own ────────┘  GET /api/v1/export  (read-only API token)
```

- **API** (`apps/api`): FastAPI, SQLAlchemy 2 (async), Alembic, bcrypt and JWT. Planner logic is in small service modules (`app/services/planner_*.py`) over a shared vocabulary (`rules.py`).
- **Web** (`apps/web`): Next.js (App Router), Tailwind, self-hosted fonts, CSS-variable theming.
- Details: [docs/architecture.md](docs/architecture.md).

## Develop

```bash
make dev                                    # Postgres on 127.0.0.1:5432
cd apps/api && pip install -r requirements-dev.txt && APP_ENV=development python -m pytest -q
cd apps/web && npm install && npm run dev
```

The API tests run on a throwaway SQLite file and need no Postgres. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## Credits and licence

Created and maintained by [Alamin Mahamud](https://github.com/alamin-mahamud).

Released under the [MIT License](LICENSE). Use it, change it, host it, ship it; just keep the copyright notice. Dependency licences are listed in [docs/licenses.md](docs/licenses.md).
