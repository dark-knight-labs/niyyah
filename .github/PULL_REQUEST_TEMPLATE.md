## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## Checklist

- [ ] Tests added or updated, and `python -m pytest -q` passes in `apps/api`
- [ ] `npx tsc --noEmit -p .` and `npm run lint` pass in `apps/web` (for web changes)
- [ ] A database change comes with an Alembic migration, tried against an empty Postgres
- [ ] New endpoints filter by `user_id` and have a test that a second user cannot see the first user's data
