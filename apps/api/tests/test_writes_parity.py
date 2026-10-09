import subprocess
from pathlib import Path

import pytest
from sqlalchemy import select

from app.api.v1.vault import _local_now
from app.core.config import settings
from app.models.user import User
from app.services.vault_import import import_vault
from tests.conftest import TestSession
from tests.vault_fixture import build_vault

V = "/api/v1/vault"
LANE_ORDER = {"now": 0, "next": 1, "backlog": 2, "done": 3}


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True)


def git_vault(tmp_path: Path, today) -> Path:
    """The fixture vault as a git checkout whose origin is a bare repo, as commit_edits expects."""
    seed, bare, work = tmp_path / "seed", tmp_path / "remote.git", tmp_path / "work"
    build_vault(seed, today)
    _git(seed, "init", "-q", "-b", "main")
    _git(seed, "add", "-A")
    _git(seed, "commit", "-q", "-m", "seed")
    subprocess.run(["git", "clone", "-q", "--bare", str(seed), str(bare)], check=True, capture_output=True)
    subprocess.run(["git", "clone", "-q", str(bare), str(work)], check=True, capture_output=True)
    return work


def _strip(obj):
    """Drop what legitimately differs: line numbers (row ids in db mode), hashes, and ids of entries created during the run."""
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if k not in ("line", "hash", "id")}
    if isinstance(obj, list):
        return [_strip(v) for v in obj]
    return obj


async def snapshot(client, today) -> dict:
    d = today.isoformat()
    out = {}
    for name, url in {"today": "/today", "week": "/week", "streaks": "/streaks", "tasks": f"/day/{d}/tasks", "log": f"/day/{d}/log",
                      "objectives": "/objectives", "quarter": "/quarter", "pipelines": "/pipelines", "notebooks": "/notebooks"}.items():
        res = await client.get(V + url)
        assert res.status_code == 200, (url, res.text)
        out[name] = _strip(res.json())
    for stream in out["pipelines"]["streams"]:  # the vault path lists items in file order, the db path in insertion order; lanes are what the page shows
        stream["items"].sort(key=lambda i: LANE_ORDER[i["lane"]])
    return out


async def scenario(client, today):
    d = today.isoformat()
    ok = lambda r: (r.status_code, r.json().get("detail")) if r.status_code != 200 else 200  # noqa: E731
    results = []
    results.append(ok(await client.put(f"{V}/day/{d}/mode", json={"mode": "yellow"})))
    results.append(ok(await client.put(f"{V}/day/{d}/vote", json={"block": "body", "stars": 3})))
    results.append(ok(await client.put(f"{V}/day/{d}/vote", json={"block": "nope", "stars": 1})))
    results.append(ok(await client.post(f"{V}/day/{d}/notes", json={"section": "OT", "span": "06:00-16:03", "text": "Shipped the router"})))
    results.append(ok(await client.post(f"{V}/day/{d}/tasks", json={"text": "Call   the bank"})))
    tasks = (await client.get(f"{V}/day/{d}/tasks")).json()
    t0 = tasks[0]
    results.append(ok(await client.put(f"{V}/tasks", json={"path": t0["path"], "line": t0["line"], "hash": t0["hash"], "done": True})))
    tasks = (await client.get(f"{V}/day/{d}/tasks")).json()
    results.append(ok(await client.put(f"{V}/tasks/text", json={"path": tasks[1]["path"], "line": tasks[1]["line"], "hash": tasks[1]["hash"], "text": "Renew the domain"})))
    log = (await client.get(f"{V}/day/{d}/log")).json()
    results.append(ok(await client.put(f"{V}/day/{d}/log", json={"index": 0, "hash": log[0]["hash"], "text": "Fixed the router"})))
    results.append(ok(await client.post(f"{V}/day/{d}/log/remove", json={"index": 1, "hash": log[1]["hash"]})))

    async def item(prefix):  # fresh reference each time: in the vault a mutation shifts the line numbers of the items below it
        pipes = (await client.get(f"{V}/pipelines")).json()
        return next(i for s in pipes["streams"] if s["stream"] == "kahf" for i in s["items"] if i["text"].startswith(prefix))

    ref = lambda i, **kw: {"stream": "kahf", "line": i["line"], "hash": i["hash"], **kw}  # noqa: E731
    results.append(ok(await client.post(f"{V}/pipeline/kahf/items", json={"texts": ["Buy cables [product:: Router] #nov"], "lane": "next", "descriptions": ["Cat6"]})))
    results.append(ok(await client.put(f"{V}/pipeline/text", json=ref(await item("Plan the DNS"), text="Plan the DNS move"))))
    results.append(ok(await client.put(f"{V}/pipeline/checkpoint", json=ref(await item("Replace the switch"), checkpoint="dec"))))
    results.append(ok(await client.put(f"{V}/pipeline/description", json=ref(await item("Replace the switch"), description="Line one\n\nLine three"))))
    results.append(ok(await client.put(f"{V}/pipeline/move", json=ref(await item("Order the modem"), lane="next"))))
    results.append(ok(await client.put(f"{V}/pipeline/focus", json=ref(await item("Plan the DNS")))))
    results.append(ok(await client.put(f"{V}/objectives", json={"stream": "alisha", "text": "Launch the store", "checkpoint": "nov"})))
    results.append(ok(await client.put(f"{V}/objectives", json={"stream": "kahf", "done": True})))
    results.append(ok(await client.post(f"{V}/pipeline/remove", json=ref(await item("Replace")))))

    results.append(ok(await client.put(f"{V}/quarter", json={"text": "New objective", "arabic": ""})))
    results.append(ok(await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "name": "Kahf Hosting", "weekly": False, "checkpoints": {"nov": "DNS live"}})))
    results.append(ok(await client.post(f"{V}/quarter/stream", json={"stream": "errands", "name": "Errands", "goal": "Clear it"})))
    results.append(ok(await client.put(f"{V}/quarter/stream", json={"stream": "kahf", "color": "plaid"})))

    async def entry(kind):
        nb = (await client.get(f"{V}/notebooks")).json()
        return next(e for s in nb["streams"] if s["stream"] == "kahf" for e in s["entries"] if e["kind"] == kind)

    results.append(ok(await client.post(f"{V}/notebook/kahf/entries", json={"kind": "idea", "title": "Passkeys v2", "body": "see https://example.com/x"})))
    results.append(ok(await client.put(f"{V}/notebook/blocker", json=ref(await entry("blocker"), open=False))))
    results.append(ok(await client.post(f"{V}/notebook/remove", json=ref(await entry("idea")))))
    return results


@pytest.mark.asyncio
async def test_db_writes_match_vault_writes(auth_client, tmp_path, monkeypatch):
    today = _local_now().date()
    work = git_vault(tmp_path, today)
    monkeypatch.setattr(settings, "vault_workdir", str(work))
    monkeypatch.setattr(settings, "vault_write_emails", "test@niyyah.app")
    from app.services.vault_sync import sync_vault
    async with TestSession() as db:
        await sync_vault(db, str(work))  # the vault path reads days from the legacy rows
    vault_results = await scenario(auth_client, today)
    vault_state = await snapshot(auth_client, today)

    async with TestSession() as db:
        user_id = (await db.execute(select(User.id))).scalar_one()
        await import_vault(db, user_id, tmp_path / "seed", today)
    monkeypatch.setattr(settings, "storage_backend", "db")
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path / "gone"))
    db_results = await scenario(auth_client, today)
    db_state = await snapshot(auth_client, today)

    assert db_results == vault_results
    for key in vault_state:
        assert db_state[key] == vault_state[key], key
