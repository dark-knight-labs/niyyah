import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services.vault_schedule import parse_schedule

NOTE = """---
city: Dhaka
lat: 23.8103
lon: 90.4125
tz: Asia/Dhaka
method: karachi
madhab: hanafi
---
# Daily Schedule

## weekday

| block | start | end | what |
|---|---|---|---|
| soul | 03:30 | fajr | Tahajjud |
| sleep | isha+30 | 03:30 | Bed |

## weekend

| block | start | end | what |
|---|---|---|---|
| fnf | maghrib-10 | isha | Family |
"""


def test_parses_meta_and_day_types():
    parsed = parse_schedule(NOTE)
    assert parsed.errors == []
    assert parsed.meta["tz"] == "Asia/Dhaka"
    assert parsed.meta["method"] == "karachi"
    assert [b.block for b in parsed.days["weekday"]] == ["soul", "sleep"]
    assert parsed.days["weekday"][1].start == "isha+30"
    assert parsed.days["weekend"][0].start == "maghrib-10"


def test_unknown_block_is_reported_not_dropped_silently():
    parsed = parse_schedule(NOTE.replace("| soul |", "| souls |"))
    assert any("unknown block 'souls'" in e for e in parsed.errors)
    assert [b.block for b in parsed.days["weekday"]] == ["sleep"]


@pytest.mark.parametrize("bad", ["25:00", "9", "fajr+x", "midnight", "asr+"])
def test_invalid_time_is_reported(bad):
    parsed = parse_schedule(NOTE.replace("03:30 | fajr", f"{bad} | fajr"))
    assert any("invalid time" in e for e in parsed.errors)


def test_missing_frontmatter_key_reported():
    parsed = parse_schedule(NOTE.replace("tz: Asia/Dhaka\n", ""))
    assert "frontmatter: missing 'tz'" in parsed.errors


def test_missing_weekday_section_reported():
    parsed = parse_schedule("---\nlat: 1\nlon: 1\ntz: UTC\nmethod: karachi\nmadhab: hanafi\n---\n## weekend\n")
    assert "missing or empty '## weekday' section" in parsed.errors


def test_wrong_column_count_reported():
    parsed = parse_schedule(NOTE.replace("| sleep | isha+30 | 03:30 | Bed |", "| sleep | isha+30 |"))
    assert any("expected 4 columns" in e for e in parsed.errors)


@pytest.mark.asyncio
async def test_schedule_endpoint_reads_vault_checkout(auth_client: AsyncClient, tmp_path, monkeypatch):
    (tmp_path / "Calendar").mkdir()
    (tmp_path / "Calendar" / "Schedule.md").write_text(NOTE, encoding="utf-8")
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))

    resp = await auth_client.get("/api/v1/vault/schedule")
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["city"] == "Dhaka"
    assert body["days"]["weekday"][0] == {"block": "soul", "start": "03:30", "end": "fajr", "what": "Tahajjud"}
    assert body["errors"] == []


@pytest.mark.asyncio
async def test_schedule_endpoint_is_public(client: AsyncClient, tmp_path, monkeypatch):
    (tmp_path / "Calendar").mkdir()
    (tmp_path / "Calendar" / "Schedule.md").write_text(NOTE, encoding="utf-8")
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))

    resp = await client.get("/api/v1/vault/schedule")  # no Authorization header
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_schedule_endpoint_404_when_note_missing(auth_client: AsyncClient, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "vault_workdir", str(tmp_path))
    resp = await auth_client.get("/api/v1/vault/schedule")
    assert resp.status_code == 404
