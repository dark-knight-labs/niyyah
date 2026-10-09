# Self-hosting

## Requirements

Docker with Compose, a machine with about 1 GB of free memory, and (for a public installation) a domain with HTTPS in front.

## First start

```bash
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"    # run twice: SECRET_KEY and POSTGRES_PASSWORD
docker compose up --build
```

The API image applies database migrations when it starts. Open http://localhost:3000 and register; the first account is an ordinary account like any other.

## Behind a domain

Put a reverse proxy (Caddy, Traefik, nginx) in front of the web (port 3000) and API (port 8000) containers, both on HTTPS, and set in `.env`:

```
WEB_URL=https://niyyah.example.com
API_URL=https://niyyah-api.example.com
OPERATOR_NAME=Your Name
OPERATOR_CONTACT=you@example.com
TRUST_FORWARDED_FOR=true
```

`API_URL` is baked into the web bundle, so rebuild the web image (`docker compose up --build`) after changing it.

## Registration

`REGISTRATION=open` (default) lets anyone create an account. For a private installation create your own account, then set `REGISTRATION=closed` and restart the API.

## Backups and upgrades

Back up the `pgdata` volume with `pg_dump`:

```bash
docker compose exec db pg_dump -U niyyah niyyah > niyyah-$(date +%F).sql
```

Every user can also download their own data from `GET /api/v1/export` ([format](export-format.md)). To upgrade: `git pull`, take a backup, `docker compose up --build -d`. Migrations run on start.

## Mirroring into another tool

Create an API token in Settings and have your tool poll `GET /api/v1/export` with `Authorization: Bearer <token>`. A token can read the export and nothing else.
