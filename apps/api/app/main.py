from collections.abc import Callable, Iterable
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import check_secrets, settings
from app.core.deps import get_current_user
from app.core.plugins import API_PREFIX, check_collisions, discover_entry_points, flat_routes, load_plugins, parse_specs
from app.api.v1 import auth, personas, schedule, principles, tracker, settings as settings_router, dashboard, vault, tokens, export, import_data

@asynccontextmanager
async def lifespan(_: FastAPI):
    problems = check_secrets(settings)
    if problems:
        raise RuntimeError("Refusing to start with unsafe configuration:\n- " + "\n- ".join(problems))
    yield


def create_app(plugin_specs: Iterable[str] | None = None, entry_points: Callable[[], Iterable] | None = None) -> FastAPI:
    """plugin_specs=None reads settings.plugins; entry_points=None discovers installed packages (tests pass `lambda: []`)."""
    app = FastAPI(title="Niyyah API", version="1.0.0", docs_url="/docs", redoc_url="/redoc", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins.split(","),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(personas.router, prefix="/api/v1")
    app.include_router(schedule.router, prefix="/api/v1")
    app.include_router(principles.router, prefix="/api/v1")
    app.include_router(tracker.router, prefix="/api/v1")
    app.include_router(settings_router.router, prefix="/api/v1")
    app.include_router(dashboard.router, prefix="/api/v1")
    app.include_router(vault.router, prefix="/api/v1")
    app.include_router(tokens.router, prefix="/api/v1")
    app.include_router(export.router, prefix="/api/v1")
    app.include_router(import_data.router, prefix="/api/v1")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get(f"{API_PREFIX}/plugins", dependencies=[Depends(get_current_user)])
    async def list_plugins():
        return [{"name": p.name, "api_version": p.api_version} for p in app.state.plugins]

    specs = parse_specs(settings.plugins) if plugin_specs is None else list(plugin_specs)
    plugins = load_plugins(specs, entry_points or discover_entry_points)
    for plugin, routers in check_collisions(flat_routes(app.routes), plugins):
        for router in routers:
            app.include_router(router, prefix=API_PREFIX)
    app.state.plugins = plugins
    return app


app = create_app()
