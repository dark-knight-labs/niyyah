# Contributing

Bug reports and focused pull requests are welcome. For anything larger than a fix, open an issue first so we can agree on the direction.

## Setup

```bash
make dev
cd apps/api && python -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
APP_ENV=development python -m pytest -q          # uses a temporary sqlite file, no Postgres needed
cd ../web && npm ci && npx tsc --noEmit -p . && npm run lint
```

## Guidelines

- Add or change tests with the code. Run the API suite and `tsc` before opening a pull request.
- Database changes need an Alembic migration (`make migration msg="what changed"`). Tests create tables directly, so also run `alembic upgrade head` against an empty Postgres once.
- Planner data is per user: every query filters by `user_id`, and every new endpoint needs a test that a second user cannot see the first user's rows.
- Keep it simple: prefer plain code and the existing patterns (see `apps/api/app/services/planner_*.py`) over new abstractions.
- Commit messages: imperative mood, explain why.

By contributing you agree that your contribution is licensed under the MIT License.
