import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.main import app
from app.models.compass import Compass
from tests.conftest import TestSession

URL = "/api/v1/compass"
EMPTY = {"mission": "", "vision": "", "vision_horizon": "", "updated_at": None}


async def _rows() -> int:
    async with TestSession() as db:
        return (await db.execute(select(func.count()).select_from(Compass))).scalar_one()


async def test_empty_get_creates_no_row(auth_client: AsyncClient):
    resp = await auth_client.get(URL)
    assert resp.status_code == 200
    assert resp.json() == EMPTY
    assert await _rows() == 0


async def test_put_then_get(auth_client: AsyncClient):
    body = {"mission": "Serve", "vision": "A strong family", "vision_horizon": "2046"}
    put = await auth_client.put(URL, json=body)
    assert put.status_code == 200
    got = (await auth_client.get(URL)).json()
    assert {k: got[k] for k in body} == body and got["updated_at"]
    assert put.json() == got


async def test_partial_put_changes_only_given_fields(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "m", "vision": "v", "vision_horizon": "2040"})
    got = (await auth_client.put(URL, json={"vision": "v2"})).json()
    assert (got["mission"], got["vision"], got["vision_horizon"]) == ("m", "v2", "2040")


async def test_empty_body_is_a_noop_and_creates_no_row(auth_client: AsyncClient):
    assert (await auth_client.put(URL, json={})).json() == EMPTY
    assert await _rows() == 0
    await auth_client.put(URL, json={"mission": "m"})
    got = (await auth_client.put(URL, json={})).json()
    assert got["mission"] == "m"


async def test_empty_string_clears_and_values_are_stripped(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "  padded  ", "vision": "v"})
    assert (await auth_client.get(URL)).json()["mission"] == "padded"
    got = (await auth_client.put(URL, json={"mission": ""})).json()
    assert got["mission"] == "" and got["vision"] == "v"


@pytest.mark.parametrize("field,limit", [("mission", 1000), ("vision", 1000), ("vision_horizon", 10)])
async def test_over_cap_is_422(auth_client: AsyncClient, field, limit):
    assert (await auth_client.put(URL, json={field: "x" * limit})).status_code == 200
    assert (await auth_client.put(URL, json={field: "x" * (limit + 1)})).status_code == 422


async def test_null_field_is_422(auth_client: AsyncClient):
    assert (await auth_client.put(URL, json={"mission": None})).status_code == 422


async def test_requires_auth(client: AsyncClient):
    assert (await client.get(URL)).status_code == 401
    assert (await client.put(URL, json={})).status_code == 401


async def test_users_do_not_see_each_other(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "mine"})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as other:
        await other.post("/api/v1/auth/register", json={"email": "b@niyyah.app", "password": "testpass123"})
        token = (await other.post("/api/v1/auth/login", json={"email": "b@niyyah.app", "password": "testpass123"})).json()["access_token"]
        other.headers["Authorization"] = f"Bearer {token}"
        assert (await other.get(URL)).json() == EMPTY
        await other.put(URL, json={"mission": "theirs"})
    assert (await auth_client.get(URL)).json()["mission"] == "mine"
    assert await _rows() == 2


async def test_second_put_updates_the_same_row(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "one"})
    await auth_client.put(URL, json={"mission": "two"})
    assert await _rows() == 1


async def test_service_names_for_later_callers(auth_client: AsyncClient):
    from app.services import compass as compass_service

    async with TestSession() as db:
        assert await compass_service.get(db, 999) is None
        row = await compass_service.update(db, 1, {"mission": "m"})
        assert row.mission == "m"


# --- personas.stream ------------------------------------------------------------------------------------------------

async def test_persona_stream_roundtrip(auth_client: AsyncClient):
    made = await auth_client.post("/api/v1/personas", json={"name": "Father", "domain": "family", "stream": "home"})
    assert made.status_code == 201 and made.json()["stream"] == "home"
    pid = made.json()["id"]
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"stream": "work-1"})).json()["stream"] == "work-1"
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"name": "Dad"})).json()["stream"] == "work-1"  # untouched
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"stream": None})).json()["stream"] is None
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"stream": "home"})).json()["stream"] == "home"
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"stream": ""})).json()["stream"] is None
    listed = (await auth_client.get("/api/v1/personas")).json()
    assert listed[0]["stream"] is None


async def test_persona_default_stream_is_null(auth_client: AsyncClient):
    made = await auth_client.post("/api/v1/personas", json={"name": "P", "domain": "d"})
    assert made.json()["stream"] is None
    assert (await auth_client.post("/api/v1/personas", json={"name": "Q", "domain": "d", "stream": ""})).json()["stream"] is None


@pytest.mark.parametrize("bad", ["Home", "a", "1home", "has space", "x" * 25])
async def test_persona_invalid_stream_is_422(auth_client: AsyncClient, bad):
    assert (await auth_client.post("/api/v1/personas", json={"name": "P", "domain": "d", "stream": bad})).status_code == 422
    pid = (await auth_client.post("/api/v1/personas", json={"name": "P", "domain": "d"})).json()["id"]
    assert (await auth_client.patch(f"/api/v1/personas/{pid}", json={"stream": bad})).status_code == 422


async def test_bad_stored_stream_never_breaks_the_list(auth_client: AsyncClient):
    from app.models.persona import Persona

    pid = (await auth_client.post("/api/v1/personas", json={"name": "P", "domain": "d"})).json()["id"]
    async with TestSession() as db:
        (await db.get(Persona, pid)).stream = "Not A Slug!"
        await db.commit()
    resp = await auth_client.get("/api/v1/personas")
    assert resp.status_code == 200 and resp.json()[0]["stream"] == "Not A Slug!"


# --- export / import ------------------------------------------------------------------------------------------------

E = "/api/v1/export"
I = "/api/v1/import?replace=true"


async def _login(client, email):
    await client.post("/api/v1/auth/register", json={"email": email, "password": "otherpass123"})
    token = (await client.post("/api/v1/auth/login", json={"email": email, "password": "otherpass123"})).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


async def _persona(client, name, stream=None, headers=None):
    body = {"name": name, "domain": "d", **({"stream": stream} if stream else {})}
    return (await client.post("/api/v1/personas", json=body, headers=headers)).json()["id"]


async def test_export_without_compass_has_null_and_no_streams(auth_client: AsyncClient):
    await _persona(auth_client, "Plain")
    snap = (await auth_client.get(E)).json()
    assert snap["compass"] is None and snap["persona_streams"] == [] and snap["version"] == 1


async def test_export_carries_compass_and_persona_streams(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "m", "vision": "v", "vision_horizon": "2046"})
    await _persona(auth_client, "Second", "shop")
    await _persona(auth_client, "First", "home")
    await _persona(auth_client, "NoStream")
    snap = (await auth_client.get(E)).json()
    assert snap["compass"] == {"mission": "m", "vision": "v", "vision_horizon": "2046"}
    assert snap["persona_streams"] == [{"name": "Second", "stream": "shop"}, {"name": "First", "stream": "home"}]  # persona order


async def test_round_trip_into_another_account(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "m", "vision": "v", "vision_horizon": "2046"})
    await _persona(auth_client, "Father", "home")
    snap = (await auth_client.get(E)).json()
    other = await _login(auth_client, "other@niyyah.app")
    mine = await _persona(auth_client, "Father", headers=other)
    spare = await _persona(auth_client, "Spare", headers=other)
    assert (await auth_client.post(I, json=snap, headers=other)).status_code == 200
    assert (await auth_client.get(URL, headers=other)).json()["mission"] == "m"
    streams = {p["id"]: p["stream"] for p in (await auth_client.get("/api/v1/personas", headers=other)).json()}
    assert streams == {mine: "home", spare: None}  # matched by name, others untouched
    assert (await auth_client.get(E, headers=other)).json()["compass"] == snap["compass"]


async def test_old_export_leaves_compass_and_streams_alone(auth_client: AsyncClient):
    await auth_client.put(URL, json={"mission": "keep", "vision_horizon": "2040"})
    pid = await _persona(auth_client, "Father", "home")
    assert (await auth_client.post(I, json={"version": 1, "goals": []})).status_code == 200
    assert (await auth_client.post(I, json={"version": 1, "compass": None})).status_code == 200
    got = (await auth_client.get(URL)).json()
    assert (got["mission"], got["vision_horizon"]) == ("keep", "2040")
    assert (await auth_client.get(f"/api/v1/personas/{pid}")).json()["stream"] == "home"


async def test_import_ignores_unknown_persona_names_and_counts_are_unchanged(auth_client: AsyncClient):
    pid = await _persona(auth_client, "Father")
    snap = {"version": 1, "persona_streams": [{"name": "Nobody", "stream": "home"}, {"name": "father", "stream": "home"}]}
    res = await auth_client.post(I, json=snap)
    assert res.status_code == 200 and "compass" not in res.json()["imported"] and "persona_streams" not in res.json()["imported"]
    assert (await auth_client.get(f"/api/v1/personas/{pid}")).json()["stream"] is None  # names are case-sensitive


async def test_import_validates_compass_caps_and_stream_slugs(auth_client: AsyncClient):
    assert (await auth_client.post(I, json={"version": 1, "compass": {"mission": "x" * 1001}})).status_code == 422
    assert (await auth_client.post(I, json={"version": 1, "persona_streams": [{"name": "A", "stream": "Bad Slug"}]})).status_code == 422


async def test_concurrent_first_save_retries_as_update(auth_client: AsyncClient, monkeypatch):
    """The row appears between the existence check and the insert: the loser retries as an update instead of failing."""
    from app.services import compass as compass_service

    real_get = compass_service.get
    calls = {"n": 0}

    async def racing_get(db, user_id):
        calls["n"] += 1
        if calls["n"] == 1:
            async with TestSession() as other:  # the other request wins the insert
                other.add(Compass(user_id=user_id, mission="winner"))
                await other.commit()
            return None
        return await real_get(db, user_id)

    monkeypatch.setattr(compass_service, "get", racing_get)
    resp = await auth_client.put(URL, json={"vision": "mine"})
    assert resp.status_code == 200
    assert (resp.json()["mission"], resp.json()["vision"]) == ("winner", "mine")
    assert await _rows() == 1
