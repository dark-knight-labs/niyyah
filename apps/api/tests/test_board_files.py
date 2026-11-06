import pytest

from app.services import board_files as svc
from tests.test_boards import other_client

F = "/api/v1/boards/files"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 64
WEBP = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32


async def up(c, content, name="pic.png", **kw):
    return await c.post(F, params={"name": name, **kw}, content=content)


async def test_route_order_files_is_not_a_board_id(auth_client):
    res = await auth_client.get(F)
    assert res.status_code == 200 and res.json()["files"] == [] and res.json()["quota_bytes"] == svc.QUOTA_BYTES


async def test_requires_login(client):
    assert (await client.get(F)).status_code == 401
    assert (await client.post(F, content=PNG)).status_code == 401


@pytest.mark.parametrize("content,mime", [(PNG, "image/png"), (JPG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp")])
async def test_images_are_sniffed_by_magic_bytes_not_by_name_or_header(auth_client, content, mime):
    res = await auth_client.post(F, params={"name": "notes.txt"}, content=content, headers={"content-type": "text/plain"})
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["mime"] == mime and body["size"] == len(content) and body["used"] is False and body["name"] == "notes.txt"
    got = await auth_client.get(f"{F}/{body['id']}")
    assert got.status_code == 200 and got.content == content and got.headers["content-type"] == mime
    assert got.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in got.headers["content-security-policy"]
    assert got.headers["cache-control"].startswith("private")
    assert got.headers["content-disposition"].startswith("inline")


async def test_svg_and_html_are_files_served_as_attachments(auth_client):
    for name, content in (("evil.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), ("page.png", b"<html><script>alert(1)</script></html>")):
        res = await up(auth_client, content, name)
        assert res.status_code == 201 and res.json()["mime"] == "application/octet-stream", name
        got = await auth_client.get(f"{F}/{res.json()['id']}")
        assert got.headers["content-type"] == "application/octet-stream" and got.headers["content-disposition"].startswith("attachment")
        assert got.headers["x-content-type-options"] == "nosniff" and "sandbox" in got.headers["content-security-policy"]


async def test_file_names_are_cleaned(auth_client):
    res = await up(auth_client, b"hello", "../../etc/pass<wd>.txt")
    assert res.json()["name"] == "passwd.txt"
    assert (await up(auth_client, b"x", "..")).json()["name"] == "file"


async def test_other_users_cannot_read_list_or_delete(auth_client):
    fid = (await up(auth_client, PNG)).json()["id"]
    other = await other_client()
    assert (await other.get(f"{F}/{fid}")).status_code == 404
    assert (await other.delete(f"{F}/{fid}")).status_code == 404
    assert (await other.get(F)).json()["files"] == []
    assert (await auth_client.get(f"{F}/{fid}")).status_code == 200            # still there for the owner


async def test_oversize_is_413_by_header_and_by_stream(auth_client, monkeypatch):
    assert (await up(auth_client, b"x" * (svc.MAX_FILE_BYTES + 1))).status_code == 413
    monkeypatch.setattr(svc, "MAX_FILE_BYTES", 1000)
    async def chunks():
        for _ in range(5):
            yield b"y" * 400
    # a chunked body has no Content-Length: refused outright (411), never read
    assert (await auth_client.post(F, content=chunks())).status_code == 411
    assert (await up(auth_client, b"z" * 1001)).status_code == 413
    assert (await up(auth_client, b"z" * 1000)).status_code == 201
    assert (await auth_client.get(F)).json()["used_bytes"] == 1000


async def test_stream_cap_applies_when_the_declared_length_lies(auth_client, monkeypatch):
    """The byte counter, not the header, is what stops a body that grows past the cap."""
    monkeypatch.setattr(svc, "MAX_FILE_BYTES", 1000)
    res = await auth_client.post(F, content=b"q" * 5000, headers={"content-length": "10"})
    assert res.status_code == 413
    assert (await auth_client.get(F)).json()["files"] == []


async def test_empty_body_is_422(auth_client):
    assert (await up(auth_client, b"")).status_code == 422


async def test_quota_is_422_with_what_is_used(auth_client, monkeypatch):
    monkeypatch.setattr(svc, "QUOTA_BYTES", 1000)
    assert (await up(auth_client, b"a" * 600)).status_code == 201
    res = await up(auth_client, b"b" * 600)
    assert res.status_code == 422
    body = res.json()
    assert body["used_bytes"] == 600 and body["quota_bytes"] == 1000 and "600 B of 1000 B" in body["detail"] and "Files panel" in body["detail"]
    other = await other_client()
    assert (await up(other, b"c" * 900)).status_code == 201                  # quota is per user


async def test_list_has_metadata_only_and_marks_unused_files(auth_client):
    used = (await up(auth_client, PNG, "used.png")).json()["id"]
    spare = (await up(auth_client, JPG, "spare.jpg")).json()["id"]
    b = (await auth_client.post("/api/v1/boards", json={"title": "Pics"})).json()["id"]
    node = {"id": "pic", "kind": "image", "x": 0, "y": 0, "w": 100, "h": 80, "style": {"file_id": used}}
    assert (await auth_client.post(f"/api/v1/boards/{b}/ops", json={"ops": [{"op": "upsert_node", "node": node}]})).status_code == 200
    body = (await auth_client.get(F)).json()
    by = {f["id"]: f for f in body["files"]}
    assert by[used]["used"] is True and by[spare]["used"] is False
    assert all(set(f) == {"id", "name", "mime", "size", "created_at", "used"} for f in body["files"])
    assert body["used_bytes"] == len(PNG) + len(JPG)


async def test_delete_removes_the_bytes_but_not_the_node(auth_client):
    fid = (await up(auth_client, PNG)).json()["id"]
    b = (await auth_client.post("/api/v1/boards", json={"title": "Pics"})).json()["id"]
    await auth_client.post(f"/api/v1/boards/{b}/ops", json={"ops": [{"op": "upsert_node", "node": {"id": "pic", "kind": "image", "style": {"file_id": fid}}}]})
    assert (await auth_client.delete(f"{F}/{fid}")).status_code == 204
    assert (await auth_client.get(f"{F}/{fid}")).status_code == 404
    assert (await auth_client.delete(f"{F}/{fid}")).status_code == 404
    nodes = (await auth_client.get(f"/api/v1/boards/{b}")).json()["nodes"]
    assert [(n["kind"], n["style"]["file_id"]) for n in nodes] == [("image", fid)]
    assert (await auth_client.get(F)).json()["files"] == []


async def test_deleting_a_board_leaves_its_files(auth_client):
    fid = (await up(auth_client, PNG, board=1)).json()["id"]
    b = (await auth_client.post("/api/v1/boards", json={"title": "Gone"})).json()["id"]
    assert (await auth_client.delete(f"/api/v1/boards/{b}")).status_code == 204
    assert (await auth_client.get(f"{F}/{fid}")).status_code == 200
