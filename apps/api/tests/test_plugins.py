import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.core.database import get_db
from app.core.plugins import PLUGIN_API_VERSION, PluginError, flat_routes, load_plugins, parse_specs
from app.main import create_app
from tests.conftest import override_get_db

API_DIR = Path(__file__).resolve().parent.parent
FAKE = "tests.fake_plugin:FakePlugin"
NO_EPS = lambda: []  # noqa: E731

# Observed with the FastAPI in requirements.txt at the time of writing; HTTPBearer has returned 403 in other versions.
MISSING_HEADER_STATUS = 401


def core_routes() -> set[tuple[str, str]]:
    return {(p, m) for p, m in json.loads((API_DIR / "tests" / "core_routes.json").read_text())}


@pytest_asyncio.fixture
async def plugin_client():
    clients = []

    async def make(specs, entry_points=NO_EPS):
        fresh = create_app(plugin_specs=specs, entry_points=entry_points)
        fresh.dependency_overrides[get_db] = override_get_db
        c = AsyncClient(transport=ASGITransport(app=fresh), base_url="http://test")
        clients.append(c)
        await c.post("/api/v1/auth/register", json={"email": "p@niyyah.app", "password": "testpass123"})
        resp = await c.post("/api/v1/auth/login", json={"email": "p@niyyah.app", "password": "testpass123"})
        c.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
        return c

    yield make
    for c in clients:
        await c.aclose()


def test_settings_plugins_default_and_parse(monkeypatch):
    monkeypatch.delenv("PLUGINS", raising=False)
    assert Settings(_env_file=None).plugins == ""
    assert parse_specs("") == []
    assert parse_specs(" a:B, c.d:E ,") == ["a:B", "c.d:E"]


def test_zero_plugins_routes_equal_core_plus_plugins_endpoint():
    expected = core_routes() | {("/api/v1/plugins", "GET")}
    assert flat_routes(create_app(plugin_specs=[], entry_points=NO_EPS).routes) == expected


async def test_zero_plugins_endpoint_is_empty_and_authenticated(plugin_client):
    c = await plugin_client([])  # isolated from installed niyyah-* packages and PLUGINS
    resp = await c.get("/api/v1/plugins")
    assert resp.status_code == 200
    assert resp.json() == []
    del c.headers["Authorization"]
    assert (await c.get("/api/v1/plugins")).status_code == MISSING_HEADER_STATUS


async def test_fake_plugin_mounted_and_listed(plugin_client):
    c = await plugin_client([FAKE])
    assert (await c.get("/api/v1/plugins")).json() == [{"name": "fake", "api_version": PLUGIN_API_VERSION}]
    resp = await c.get("/api/v1/fake/ping")
    assert resp.status_code == 200 and resp.json() == {"pong": True}


async def test_plugin_routes_require_auth(plugin_client):
    c = await plugin_client([FAKE])
    del c.headers["Authorization"]
    assert (await c.get("/api/v1/fake/ping")).status_code == MISSING_HEADER_STATUS
    assert (await c.get("/api/v1/plugins")).status_code == MISSING_HEADER_STATUS


async def test_entry_point_discovery_and_dedup(plugin_client):
    eps = lambda: [SimpleNamespace(name="fake", value=FAKE)]  # noqa: E731
    c = await plugin_client([FAKE], entry_points=eps)  # same plugin via both routes loads once
    assert (await c.get("/api/v1/plugins")).json() == [{"name": "fake", "api_version": PLUGIN_API_VERSION}]
    assert (await c.get("/api/v1/fake/ping")).status_code == 200


def test_wrong_version_names_both_versions():
    with pytest.raises(PluginError, match=r"WrongVersionPlugin.*version 2.*version 1"):
        load_plugins(["tests.fake_plugin:WrongVersionPlugin"], NO_EPS)


@pytest.mark.parametrize("spec", ["nocolon", ":Class", "mod:", "a:b:c"])
def test_bad_spec(spec):
    with pytest.raises(PluginError, match="module:Class"):
        load_plugins([spec], NO_EPS)


def test_import_failure_and_missing_attribute():
    with pytest.raises(PluginError, match="nonexistent.mod"):
        load_plugins(["nonexistent.mod:X"], NO_EPS)
    with pytest.raises(PluginError, match="Missing"):
        load_plugins(["tests.fake_plugin:Missing"], NO_EPS)


def test_duplicate_name():
    with pytest.raises(PluginError, match="'fake'"):
        load_plugins([FAKE, "tests.fake_plugin:DuplicateNamePlugin"], NO_EPS)


def test_routers_exception():
    with pytest.raises(PluginError, match="broken"):
        create_app(plugin_specs=["tests.fake_plugin:BrokenRoutersPlugin"], entry_points=NO_EPS)


def test_collision_with_core():
    with pytest.raises(PluginError, match="POST /api/v1/auth/login"):
        create_app(plugin_specs=["tests.fake_plugin:CollidingPlugin"], entry_points=NO_EPS)


def test_param_route_overlapping_core_literal_is_not_detected():
    # Pins the limitation documented in docs/plugins.md "Known limitation": GET /api/v1/auth/{item_id} overlaps the
    # core literal GET /api/v1/auth/me yet loads without PluginError. If this changes, change it deliberately.
    app = create_app(plugin_specs=["tests.fake_plugin:ParamOverlapPlugin"], entry_points=NO_EPS)
    assert ("/api/v1/auth/{item_id}", "GET") in flat_routes(app.routes)


def _run(code: str, plugins: str):
    env = {**os.environ, "APP_ENV": "development", "PLUGINS": plugins}
    return subprocess.run([sys.executable, "-c", code], cwd=API_DIR, env=env, capture_output=True, text=True)


def test_startup_aborts_on_bad_plugin():
    result = _run("import app.main", "nonexistent.mod:X")
    assert result.returncode != 0
    assert "nonexistent.mod" in result.stderr or "PluginError" in result.stderr


def test_startup_with_fake_plugin_via_env():
    # Hide installed niyyah-* packages (a "fake" plugin there would clash by name); PLUGINS is still read for real.
    code = (
        "import app.core.plugins as p; p._metadata_entry_points = lambda group: []\n"
        "import app.main\n"
        "from app.core.plugins import flat_routes\n"
        "assert ('/api/v1/fake/ping', 'GET') in flat_routes(app.main.app.routes)"
    )
    result = _run(code, FAKE)
    assert result.returncode == 0, result.stderr
