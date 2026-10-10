from fastapi import APIRouter, Depends

from app.core.deps import get_current_user
from app.core.plugins import PLUGIN_API_VERSION


def _router(path: str) -> APIRouter:
    router = APIRouter()

    @router.get(path)
    async def ping(_=Depends(get_current_user)):
        return {"pong": True}

    return router


class FakePlugin:
    name = "fake"
    api_version = PLUGIN_API_VERSION

    def routers(self):
        return [_router("/fake/ping")]


class WrongVersionPlugin(FakePlugin):
    name = "wrong-version"
    api_version = PLUGIN_API_VERSION + 1


class CollidingPlugin(FakePlugin):
    name = "colliding"

    def routers(self):
        router = APIRouter()

        @router.post("/auth/login")
        async def login():
            return {}

        return [router]


class DuplicateNamePlugin(FakePlugin):
    def routers(self):
        return [_router("/fake/other")]


class BrokenRoutersPlugin(FakePlugin):
    name = "broken"

    def routers(self):
        raise ValueError("boom")


class ParamOverlapPlugin(FakePlugin):
    name = "param-overlap"

    def routers(self):
        return [_router("/auth/{item_id}")]
