"""What plugins and API clients can rely on. A failure here is a breaking change: either undo it, or bump
PLUGIN_API_VERSION, keep the old number in SUPPORTED_API_VERSIONS, and regenerate tests/openapi_contract.json
(see tests/contract.py)."""
import importlib
import json
from pathlib import Path

import pytest

from app.main import create_app
from tests.contract import breaks, build_contract

SNAPSHOT = Path(__file__).parent / "openapi_contract.json"

# Names a plugin may import from core. Renaming or removing one breaks plugins.
IMPORT_SURFACE = {
    "app.core.deps": ["get_current_user"],
    "app.core.database": ["get_db", "Base"],
    "app.core.config": ["settings"],
    "app.core.plugins": ["Plugin", "PLUGIN_API_VERSION", "SUPPORTED_API_VERSIONS"],
}


@pytest.mark.parametrize("module,name", [(m, n) for m, names in IMPORT_SURFACE.items() for n in names])
def test_plugin_import_surface(module, name):
    assert hasattr(importlib.import_module(module), name)


def test_current_version_is_supported():
    from app.core.plugins import PLUGIN_API_VERSION, SUPPORTED_API_VERSIONS
    assert PLUGIN_API_VERSION in SUPPORTED_API_VERSIONS
    assert len(SUPPORTED_API_VERSIONS) <= 2, "only N and N-1 are supported"


def test_api_shape_has_no_breaking_changes():
    old = json.loads(SNAPSHOT.read_text())
    new = build_contract(create_app(plugin_specs=[], entry_points=lambda: []).openapi())
    problems = []
    for op, was in old.items():
        if op not in new:
            problems.append(f"{op}: endpoint removed")
            continue
        now = new[op]
        problems += [f"{op}: parameter {p} removed" for p in was["params"] if p not in now["params"]]
        problems += [f"{op}: new required parameter {p}" for p in now["params"] if p.endswith("*") and p not in was["params"]]
        problems += breaks(was["request"], now["request"], f"{op} request", "request")
        problems += breaks(was["response"], now["response"], f"{op} response", "response")
    assert not problems, "\n".join(problems)


def test_breaks_detects_each_kind():
    obj = lambda props, req=(): {"type": "object", "properties": props, "required": list(req)}  # noqa: E731
    s, i = {"type": "string"}, {"type": "integer"}
    assert breaks(obj({"a": s}), obj({"a": s, "b": s}), "r", "response") == []
    assert breaks(obj({"a": s, "b": s}), obj({"a": s}), "r", "response") == ["r.b: removed"]
    assert breaks(obj({"a": s}), obj({"a": i}), "r", "response") == ["r.a: type string -> integer"]
    assert breaks(obj({"a": s}), obj({"a": s, "b": s}, ["b"]), "r", "request") == ["r.b: newly required"]
    assert breaks(obj({"a": s}), obj({"a": s, "b": s}), "r", "request") == []
