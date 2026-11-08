"""Characterization of the planning reads that must not change while the shadow item tree exists (legacy tables stay authoritative)."""
import pytest

from app.api.v1 import vault
from tests.conftest import TestSession
from tests.golden_support import assert_golden
from tests.tree_fixture import FIXED_NOW, seed_planning


@pytest.fixture
async def seeded(auth_client, monkeypatch):
    monkeypatch.setattr(vault, "_local_now", lambda: FIXED_NOW)
    async with TestSession() as db:
        db.add_all(seed_planning(1))
        await db.commit()
    return auth_client


@pytest.mark.parametrize("name,url", [
    ("vault_quarter", "/api/v1/vault/quarter"),
    ("vault_pipelines", "/api/v1/vault/pipelines"),
    ("vault_objectives", "/api/v1/vault/objectives"),
    ("export", "/api/v1/export"),
])
async def test_read_matches_golden(seeded, name, url):
    res = await seeded.get(url)
    assert res.status_code == 200
    assert_golden(name, res.json())


async def test_golden_fixture_covers_the_cases(seeded):
    quarter = (await seeded.get("/api/v1/vault/quarter")).json()
    statuses = {s["status"] for s in quarter["streams"]}
    assert {"active", "committed", "paused", "archived"} <= statuses
    assert quarter["objective_ar"]
    export = (await seeded.get("/api/v1/export")).json()
    labels = {q["label"]: q for q in export["quarters"]}
    assert set(labels) == {"2026-Q3", "2026-Q4"} and labels["2026-Q3"]["objective_ar"] == ""
    names = {(q["label"], s["slug"]): s["name"] for q in export["quarters"] for s in q["streams"]}
    assert names[("2026-Q3", "alpha")] != names[("2026-Q4", "alpha")]
