#!/usr/bin/env bash
# Browser run of the Overview items: a fresh SQLite dev DB (one user + the sample account), the API on the calendar
# fixture, a production build of the web app, then the Playwright spec. Results, logs and screenshots go to e2e/out.
#   apps/web/e2e/run.sh            (SKIP_BUILD=1 reuses .next; API_PORT / WEB_PORT change the ports; extra args or E2E_ARGS="-g name" go to playwright)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WEB="$(dirname "$HERE")"
API="$(cd "$WEB/../api" && pwd)"
PW_VERSION=1.63.0
API_PORT="${API_PORT:-8017}"
WEB_PORT="${WEB_PORT:-3017}"
OUT="$HERE/out"
EMAIL=e2e@niyyah.app
PASSWORD=e2e-pass-123

rm -rf "$OUT" && mkdir -p "$OUT"
[ -x "$API/.venv/bin/python" ] || { python3 -m venv "$API/.venv" && "$API/.venv/bin/pip" install -q -r "$API/requirements-dev.txt"; }
[ -d "$WEB/node_modules" ] || (cd "$WEB" && npm ci)

export APP_ENV=development STORAGE_BACKEND=db APP_TIMEZONE=Asia/Dhaka
export DATABASE_URL="sqlite+aiosqlite:///$OUT/e2e.db"
export CALENDAR_FIXTURE_FILE="$API/tests/fixtures/calendar.ics"
export CORS_ORIGINS="http://localhost:$WEB_PORT"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

wait_for() { for _ in $(seq 1 120); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done; echo "timed out waiting for $1" >&2; return 1; }

(cd "$API" && PYTHONPATH=. .venv/bin/python "$HERE/seed.py" "$EMAIL" "$PASSWORD") | tee "$OUT/seed.log"
(cd "$API" && exec .venv/bin/uvicorn app.main:app --port "$API_PORT" > "$OUT/api.log" 2>&1) & pids+=($!)

cd "$WEB"
if [ "${SKIP_BUILD:-}" != 1 ]; then NEXT_PUBLIC_API_URL="http://localhost:$API_PORT" npm run build > "$OUT/build.log" 2>&1 || { tail -30 "$OUT/build.log"; exit 1; }; fi
(exec ./node_modules/.bin/next start -p "$WEB_PORT" > "$OUT/web.log" 2>&1) & pids+=($!)
wait_for "http://localhost:$API_PORT/health"
wait_for "http://localhost:$WEB_PORT/login"

npx -y "playwright@$PW_VERSION" install chromium > "$OUT/browser-install.log" 2>&1
# The spec imports @playwright/test, which is not a dependency of the app: resolve it from the pinned npx install.
PW_MODULES="$(npx -y -p "@playwright/test@$PW_VERSION" sh -c 'cd "$(dirname "$(command -v playwright)")/.." && pwd' 2>/dev/null | tail -n 1)"
set +e
# shellcheck disable=SC2086  # E2E_ARGS is split on purpose
NODE_PATH="$PW_MODULES" E2E_WEB_URL="http://localhost:$WEB_PORT" E2E_API_URL="http://localhost:$API_PORT" E2E_EMAIL="$EMAIL" E2E_PASSWORD="$PASSWORD" \
  npx -y -p "@playwright/test@$PW_VERSION" playwright test -c e2e/playwright.config.ts ${E2E_ARGS:-} "$@"
status=$?
set -e

# A pass/fail table from the JSON report.
node -e '
const r = require(process.argv[1]);
const rows = [];
const walk = (s, path) => { for (const c of s.suites ?? []) walk(c, [...path, c.title]); for (const spec of s.specs ?? []) for (const t of spec.tests) {
  const last = t.results[t.results.length - 1] ?? {}; rows.push([last.status === "passed" ? "PASS" : (last.status ?? "?").toUpperCase(), spec.title, `${((last.duration ?? 0) / 1000).toFixed(1)}s`]); } };
walk(r, []);
const lines = ["| result | test | time |", "|---|---|---|", ...rows.map((x) => `| ${x.join(" | ")} |`), "", `passed ${rows.filter((x) => x[0] === "PASS").length} / ${rows.length}`];
require("fs").writeFileSync(process.argv[2], lines.join("\n") + "\n");
console.log(lines.join("\n"));
' "$OUT/results.json" "$OUT/results.txt"
exit $status
