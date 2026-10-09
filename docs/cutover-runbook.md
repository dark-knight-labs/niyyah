# Cutover: move a vault-mode install to the database

For an install that runs `STORAGE_BACKEND=vault` and keeps its notes in an Obsidian vault. Every step has a check; stop and roll back at the first check that fails. The vault is only read by this procedure, never written.

1. **Back up the database.** `pg_dump` to a private file (mode 600) outside the repository. Check: the file is not empty and `pg_restore --list` reads it.
2. **Stop editing the vault.** Notes changed after the import will not be in the database.
3. **Apply the migrations** with `alembic upgrade head` before the new code runs; deploys do not run Alembic. Check: `alembic current` shows the head revision.
4. **Import the vault** into the owner's account from a fresh checkout: `python -m app.cli import-vault <email> <vault path>`. Check: read the report; the day, task, pipeline and note counts match what you expect.
5. **Switch.** Set `STORAGE_BACKEND=db` and restart the API. Check: Overview, Vault and Plan show the same days, votes, streams and pipelines as before; the Vault page says "N days logged".
6. **Connect the mirror (optional).** In Settings create an API token and give it to the mirror service, which polls `GET /api/v1/export`. See `export-format.md`.
7. **Roll back** at any point by setting `STORAGE_BACKEND=vault` and restarting. Changes made in the app after the switch stay in the database only.
