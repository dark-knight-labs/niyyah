# Plugins

Core has one extension seam: an external package can mount API routers under `/api/v1`. Dependencies point one way: a plugin imports core, core never imports a plugin. With no plugins installed nothing changes except an authenticated `GET /api/v1/plugins` that returns `[]`.

## Contract (version 1)

```python
# app/core/plugins.py
PLUGIN_API_VERSION = 1

class Plugin(Protocol):
    name: str
    api_version: int
    def routers(self) -> Sequence[APIRouter]: ...   # mounted under /api/v1
```

- The class is instantiated with no arguments. Read configuration from the environment or `app.core.config.settings`.
- `api_version` is read from the class before instantiation and must equal `PLUGIN_API_VERSION`. A mismatch stops startup with an error naming the plugin and both versions.
- Routes should use `Depends(get_current_user)` from `app.core.deps` like core routes do.
- A plugin whose routes clash with a core route, or another plugin's, on the same method and path (after `/api/v1`) stops startup. So does a duplicate plugin `name`.
- Version policy: `PLUGIN_API_VERSION` changes only on a breaking change to this contract. Plugins pin the version they were written for; there is no compatibility shim.
- A bad spec, an import failure, a missing class, or an exception in the constructor or `routers()` stops startup with a `PluginError` naming the plugin. This is intended: fix it by unsetting `PLUGINS` or uninstalling the package.

## Enabling a plugin

Either:

1. **Entry point.** The package registers the group `niyyah.plugins` (below). Installing it is enough.
2. **`PLUGINS` setting.** A comma-separated list of `module:Class`, e.g. `PLUGINS=niyyah_<plugin>.plugin:Plugin`.

A plugin listed in both places loads once.

Minimal plugin `pyproject.toml` (it does not depend on core; it imports `app.*` from the host):

```toml
[project]
name = "niyyah-<plugin>"
version = "0.1.0"

[project.entry-points."niyyah.plugins"]
<plugin> = "niyyah_<plugin>.plugin:Plugin"
```

## Attaching to the API image

Core is not a pip package: `app` is importable because the image sets `PYTHONPATH=/app`. Build a layered image on top of the published one:

```dockerfile
FROM <registry>/api:<sha>
RUN pip install --no-cache-dir --no-deps /src/niyyah-<plugin>
```

`Dockerfile.standalone` runs as the `niyyah` user, so there add `USER root` before the `RUN` and `USER niyyah` after it. The `apps/api/Dockerfile` image runs as root and needs neither.

For development and CI of a plugin, check out core at a pinned commit and set `PYTHONPATH=<core>/apps/api`.

## Checking it

`scripts/check-plugin-attach.sh` is a **manual** check (it needs network access for pip). It builds a throwaway plugin, installs it into a temporary virtualenv with core's `requirements.txt`, and confirms that discovery mounts its route and that uninstalling removes it. It does not test the image layer above; a plugin's own CI should.

## Diagnostic endpoint

`GET /api/v1/plugins` (authenticated) returns `[{"name": ..., "api_version": ...}]` for the loaded plugins.

## Deferred

- **Web slots or declarative panels.** There is no consumer yet, and it would add a schema and touch the web build. For now the web calls plugin routes through `api-client.ts`.
- **A `DataSource` interface.** Nothing in core would call it, so it would freeze an unused API. Add it when a second consumer exists.
- Plugin migrations or models, hot reload and sandboxing.
