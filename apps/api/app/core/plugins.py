"""Plugin seam: an external package can mount API routers under /api/v1 without core knowing about it.

A plugin is a class with a no-argument constructor, a `name`, an `api_version` and a `routers()` method.
It is enabled by an entry point in the group `niyyah.plugins` or by listing `module:Class` in the PLUGINS setting.
See docs/plugins.md.
"""
import importlib
import re
from collections.abc import Callable, Iterable, Sequence
from importlib.metadata import entry_points as _metadata_entry_points
from typing import Protocol

from fastapi import APIRouter

PLUGIN_API_VERSION = 1
ENTRY_POINT_GROUP = "niyyah.plugins"
API_PREFIX = "/api/v1"


class PluginError(RuntimeError):
    """A plugin could not be loaded or conflicts with core. Startup stops."""


class Plugin(Protocol):
    name: str
    api_version: int

    def routers(self) -> Sequence[APIRouter]:
        """Routers to mount under /api/v1."""
        ...


def discover_entry_points() -> list:
    return list(_metadata_entry_points(group=ENTRY_POINT_GROUP))


def parse_specs(raw: str) -> list[str]:
    return [s.strip() for s in raw.split(",") if s.strip()]


def flat_routes(routes: Iterable, prefix: str = "") -> set[tuple[str, str]]:
    """(full path, method) for every route. Newer FastAPI keeps included routers as lazy nodes, so walk those too."""
    found: set[tuple[str, str]] = set()
    for route in routes:
        original = getattr(route, "original_router", None)
        if original is not None:
            found |= flat_routes(original.routes, prefix + route.include_context.prefix)
            continue
        path = getattr(route, "path", None)
        if path is None:
            continue
        for method in getattr(route, "methods", None) or ():
            found.add((prefix + path, method))
    return found


def _normalize(path: str) -> str:
    # /x/{a} and /x/{b} match the same requests
    return re.sub(r"\{[^}]*\}", "{}", path)


def _split_spec(spec: str) -> tuple[str, str]:
    module, sep, attr = spec.partition(":")
    if not sep or not module or not attr or ":" in attr:
        raise PluginError(f"Bad plugin spec {spec!r}: expected 'module:Class'")
    return module, attr


def _load_one(spec: str) -> Plugin:
    module_name, attr = _split_spec(spec)
    try:
        module = importlib.import_module(module_name)
    except Exception as exc:
        raise PluginError(f"Plugin {spec!r}: cannot import {module_name!r}: {exc!r}") from exc
    try:
        cls = getattr(module, attr)
    except AttributeError as exc:
        raise PluginError(f"Plugin {spec!r}: module {module_name!r} has no attribute {attr!r}") from exc
    version = getattr(cls, "api_version", None)
    if version != PLUGIN_API_VERSION:
        raise PluginError(f"Plugin {spec!r} targets plugin API version {version!r}; this core provides version {PLUGIN_API_VERSION}")
    try:
        plugin = cls()
    except Exception as exc:
        raise PluginError(f"Plugin {spec!r}: constructor failed: {exc!r}") from exc
    if not isinstance(getattr(plugin, "name", None), str) or not plugin.name:
        raise PluginError(f"Plugin {spec!r} has no name")
    return plugin


def load_plugins(specs: Iterable[str], entry_points: Callable[[], Iterable] = discover_entry_points) -> list[Plugin]:
    """Instantiate each plugin once (entry points first, then specs), checking version and unique names."""
    ordered: list[str] = []
    for ep in entry_points():
        ordered.append(ep.value)
    ordered.extend(specs)
    unique = list(dict.fromkeys(ordered))

    plugins: list[Plugin] = []
    seen: dict[str, str] = {}
    for spec in unique:
        plugin = _load_one(spec)
        if plugin.name in seen:
            raise PluginError(f"Plugin name {plugin.name!r} is used by both {seen[plugin.name]!r} and {spec!r}")
        seen[plugin.name] = spec
        plugins.append(plugin)
    return plugins


def plugin_routers(plugin: Plugin) -> list[APIRouter]:
    try:
        return list(plugin.routers())
    except Exception as exc:
        raise PluginError(f"Plugin {plugin.name!r}: routers() failed: {exc!r}") from exc


def check_collisions(existing: set[tuple[str, str]], plugins: Sequence[Plugin]) -> list[tuple[Plugin, list[APIRouter]]]:
    """Collect each plugin's routers and reject any (path, method) already served by core or an earlier plugin."""
    taken = {(_normalize(p), m): "core" for p, m in existing}
    result = []
    for plugin in plugins:
        routers = plugin_routers(plugin)
        for router in routers:
            for path, method in flat_routes(router.routes, API_PREFIX):
                key = (_normalize(path), method)
                if key in taken:
                    raise PluginError(f"Plugin {plugin.name!r}: {method} {path} collides with a route from {taken[key]}")
                taken[key] = f"plugin {plugin.name!r}"
        result.append((plugin, routers))
    return result
