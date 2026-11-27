## What and why

<!-- What does this change, and why is it needed? Link the issue if there is one. -->

## Checklist

- [ ] Tests added or updated, and `python -m pytest -q` passes in `apps/api`
- [ ] `npx tsc --noEmit -p .`, `npm run lint` and `npm test` pass in `apps/web` (for web changes)
- [ ] For UI changes: `apps/web/e2e/run.sh` passes (CI runs it too); paste the pass count and any failures below
- [ ] A database change comes with an Alembic migration, tried against an empty Postgres
- [ ] New endpoints filter by `user_id` and have a test that a second user cannot see the first user's data
