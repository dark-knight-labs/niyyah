#!/bin/sh
# RUN_MIGRATIONS=1 brings the database schema up to date before the API starts (what docker compose sets).
set -eu
if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
  alembic upgrade head
fi
exec "$@"
