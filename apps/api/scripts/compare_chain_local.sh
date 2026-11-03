#!/usr/bin/env bash
# Rehearse the planning-rows change locally: OLD code (git ref, default c3d9d9e) and NEW code (this checkout) on two SQLite
# copies of the same seeded data, then scripts/compare_chain.py against both. Touches only a temp directory.
#
#   cd apps/api && .venv/bin/pip install -r requirements-dev.txt && scripts/compare_chain_local.sh
#
# Steps: build the OLD schema and seed it through the OLD server (compare_chain_seed.py) -> copy the database ->
# stamp the copy at the old head and `alembic upgrade head` with the NEW code -> serve OLD on :8101 (database A) and NEW
# on :8102 (database B) -> compare_chain.py reads, write replay, reads, once per stream -> stop the servers.
set -euo pipefail
OLD_REF="${OLD_REF:-c3d9d9e}"
NEW="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PY:-$NEW/.venv/bin/python}"
WORK="$(mktemp -d /tmp/niyyah-chain.XXXXXX)"
mkdir -p "$WORK/old"
git -C "$NEW" archive "$OLD_REF" . | tar -x -C "$WORK/old"
OLD="$WORK/old"
export APP_ENV=development
PIDS=()
cleanup() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

serve() {  # dir db port
  (cd "$1" && DATABASE_URL="sqlite+aiosqlite:///$2" "$PY" -m uvicorn app.main:app --port "$3" >"$WORK/server-$3.log" 2>&1 & echo $! >"$WORK/pid-$3")
  PIDS+=("$(cat "$WORK/pid-$3")")
  for _ in $(seq 40); do curl -sf "http://127.0.0.1:$3/health" >/dev/null && return 0; sleep 0.5; done
  echo "server on $3 did not start" >&2; cat "$WORK/server-$3.log" >&2; exit 2
}

(cd "$OLD" && DATABASE_URL="sqlite+aiosqlite:///$WORK/A.db" "$PY" - <<'PYEOF'
import asyncio
from app.core.database import Base, engine
from app.models import user, persona, principle, tracker, vault, google, planner  # noqa: F401
async def main():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
asyncio.run(main())
PYEOF
)
serve "$OLD" "$WORK/A.db" 8100
(cd "$NEW" && PYTHONPATH="$NEW" "$PY" scripts/compare_chain_seed.py http://127.0.0.1:8100 --email chain@example.com --password chainpass123)
kill "$(cat "$WORK/pid-8100")"; sleep 1
cp "$WORK/A.db" "$WORK/B.db"
(cd "$NEW" && DATABASE_URL="sqlite+aiosqlite:///$WORK/B.db" "$PY" -m alembic stamp e8f0a2c4b6d1 && DATABASE_URL="sqlite+aiosqlite:///$WORK/B.db" "$PY" -m alembic upgrade head)
serve "$OLD" "$WORK/A.db" 8101
serve "$NEW" "$WORK/B.db" 8102

token() { curl -s -X POST "http://127.0.0.1:$1/api/v1/auth/login" -H 'content-type: application/json' \
  -d '{"email":"chain@example.com","password":"chainpass123"}' | "$PY" -c "import sys,json;print(json.load(sys.stdin)['access_token'])"; }
T1="$(token 8101)"; T2="$(token 8102)"
status=0
for stream in studio shop; do
  echo "=== replay on stream: $stream"
  (cd "$NEW" && "$PY" scripts/compare_chain.py --old http://127.0.0.1:8101 --old-token "$T1" --new http://127.0.0.1:8102 --new-token "$T2" --stream "$stream") || status=1
done
echo "work dir: $WORK"
exit $status
