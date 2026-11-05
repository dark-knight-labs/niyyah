import asyncio

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.models.board import Board
from tests.conftest import TestSession

URL = "/api/v1/boards"


async def other_client(email="b@niyyah.app") -> AsyncClient:
    c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
    await c.post("/api/v1/auth/register", json={"email": email, "password": "otherpass123"})
    token = (await c.post("/api/v1/auth/login", json={"email": email, "password": "otherpass123"})).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {token}"
    return c


async def life_rows() -> int:
    async with TestSession() as db:
        return (await db.execute(select(func.count()).select_from(Board).where(Board.kind == "life"))).scalar_one()


async def test_list_creates_exactly_one_life_board(auth_client):
    first = (await auth_client.get(URL)).json()
    second = (await auth_client.get(URL)).json()
    assert [b["kind"] for b in first] == ["life"] and first[0]["title"] == "Life"
    assert second == first
    assert first[0]["counts"] == {"nodes": 0, "edges": 0} and first[0]["revision"] == 0
    assert await life_rows() == 1


async def test_concurrent_first_open_makes_one_life_board(auth_client):
    a, b = await asyncio.gather(auth_client.get(URL), auth_client.get(URL))
    assert a.status_code == b.status_code == 200
    assert a.json() == b.json()
    assert await life_rows() == 1


async def test_create_get_patch_delete(auth_client):
    made = await auth_client.post(URL, json={"title": "Ideas"})
    assert made.status_code == 201 or made.status_code == 200
    board = made.json()
    assert board["title"] == "Ideas" and board["kind"] == "free" and board["nodes"] == [] and board["edges"] == []
    got = (await auth_client.get(f"{URL}/{board['id']}")).json()
    assert got == board and got["viewport"] == {} and got["revision"] == 0
    patched = await auth_client.patch(f"{URL}/{board['id']}", json={"title": "Plans", "viewport": {"x": 10, "y": -4, "zoom": 1.5}})
    assert patched.status_code == 200
    assert (patched.json()["title"], patched.json()["viewport"]) == ("Plans", {"x": 10, "y": -4, "zoom": 1.5})
    assert (await auth_client.patch(f"{URL}/{board['id']}", json={"viewport": {"zoom": 2}})).json()["title"] == "Plans"
    assert (await auth_client.delete(f"{URL}/{board['id']}")).status_code == 204
    assert (await auth_client.get(f"{URL}/{board['id']}")).status_code == 404
    assert [b["kind"] for b in (await auth_client.get(URL)).json()] == ["life"]


async def test_life_board_cannot_be_deleted_or_renamed(auth_client):
    life = (await auth_client.get(URL)).json()[0]
    assert (await auth_client.delete(f"{URL}/{life['id']}")).status_code == 422
    assert (await auth_client.patch(f"{URL}/{life['id']}", json={"title": "Mine"})).status_code == 422
    ok = await auth_client.patch(f"{URL}/{life['id']}", json={"viewport": {"zoom": 2}})  # view state is still saved
    assert ok.status_code == 200 and ok.json()["viewport"] == {"zoom": 2}
    assert (await auth_client.get(f"{URL}/{life['id']}")).json()["title"] == "Life"


async def test_other_users_board_is_404(auth_client):
    mine = (await auth_client.post(URL, json={"title": "Mine"})).json()
    b = await other_client()
    try:
        assert (await b.get(f"{URL}/{mine['id']}")).status_code == 404
        assert (await b.patch(f"{URL}/{mine['id']}", json={"title": "x"})).status_code == 404
        assert (await b.delete(f"{URL}/{mine['id']}")).status_code == 404
        assert (await b.post(f"{URL}/{mine['id']}/ops", json={"ops": []})).status_code == 404
        assert [x["kind"] for x in (await b.get(URL)).json()] == ["life"]  # their own list never shows mine
    finally:
        await b.aclose()
    assert (await auth_client.get(f"{URL}/{mine['id']}")).status_code == 200


async def test_title_rules(auth_client):
    assert (await auth_client.post(URL, json={"title": "x" * 201})).status_code == 422
    assert (await auth_client.post(URL, json={"title": "   "})).status_code == 422
    assert (await auth_client.post(URL, json={})).status_code == 422
    board = (await auth_client.post(URL, json={"title": "  Trim me  "})).json()
    assert board["title"] == "Trim me"
    assert (await auth_client.patch(f"{URL}/{board['id']}", json={"title": "y" * 201})).status_code == 422


async def test_requires_login(client):
    assert (await client.get(URL)).status_code in (401, 403)


async def test_revision_moves_on_title_change_but_not_on_viewport_saves(auth_client):
    b = (await auth_client.post(URL, json={"title": "Rev"})).json()
    path = f"{URL}/{b['id']}"
    assert b["revision"] == 0
    assert (await auth_client.patch(path, json={"viewport": {"zoom": 2}})).json()["revision"] == 0   # a pan must not make other tabs reload
    assert (await auth_client.patch(path, json={"title": "Rev"})).json()["revision"] == 0            # same title: nothing changed
    assert (await auth_client.patch(path, json={"title": "Renamed"})).json()["revision"] == 1
    assert (await auth_client.patch(path, json={"title": "Again", "viewport": {"zoom": 3}})).json()["revision"] == 2   # once, not per field
    assert (await auth_client.get(path)).json()["revision"] == 2
    assert (await auth_client.get(URL)).json()[1]["revision"] == 2


async def test_response_shapes(auth_client):
    listing = (await auth_client.get(URL)).json()
    assert isinstance(listing, list) and set(listing[0]) == {"id", "title", "kind", "revision", "updated_at", "counts"}
    made = (await auth_client.post(URL, json={"title": "Flat"})).json()
    assert set(made) == {"id", "title", "kind", "viewport", "revision", "nodes", "edges"}
    assert made["kind"] == "free" and made["nodes"] == [] and made["edges"] == []
    assert set((await auth_client.get(f"{URL}/{made['id']}")).json()) == set(made)
