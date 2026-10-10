#!/usr/bin/env bash
# MANUAL check, not run in CI: needs network access for pip.
# Builds a throwaway plugin, installs it into a temporary venv with core's requirements, and checks that
# discovery mounts its route (and that the route is gone after uninstalling). The image layer is not tested.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mkdir -p "$tmp/plugin/niyyah_attachcheck"
cat > "$tmp/plugin/pyproject.toml" <<'EOF'
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "niyyah-attachcheck"
version = "0.0.1"

[project.entry-points."niyyah.plugins"]
attachcheck = "niyyah_attachcheck:Plugin"
EOF
cat > "$tmp/plugin/niyyah_attachcheck/__init__.py" <<'EOF'
from fastapi import APIRouter

from app.core.plugins import PLUGIN_API_VERSION


class Plugin:
    name = "attachcheck"
    api_version = PLUGIN_API_VERSION

    def routers(self):
        router = APIRouter()

        @router.get("/attachcheck/ping")
        async def ping():
            return {}

        return [router]
EOF

python3 -m venv "$tmp/venv"
"$tmp/venv/bin/pip" install --quiet -r "$root/apps/api/requirements.txt"
"$tmp/venv/bin/pip" install --quiet --no-deps "$tmp/plugin"

probe='from app.main import app; from app.core.plugins import flat_routes; print(("/api/v1/attachcheck/ping", "GET") in flat_routes(app.routes))'
run_probe() {
  (cd "$root/apps/api" && APP_ENV=development PYTHONPATH="$root/apps/api" "$tmp/venv/bin/python" -c "$probe")
}

[ "$(run_probe)" = "True" ] || { echo "FAIL: plugin route was not mounted" >&2; exit 1; }
"$tmp/venv/bin/pip" uninstall --quiet --yes niyyah-attachcheck
[ "$(run_probe)" = "False" ] || { echo "FAIL: route still present after uninstall" >&2; exit 1; }
echo "OK: plugin attached and detached"
