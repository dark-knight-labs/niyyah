from datetime import date

from app.services.vault_notebook import parse_notebook
from app.services.vault_pipeline import parse_pipeline
from tests.vault_fixture import build_vault

TODAY = date(2026, 10, 7)


def test_fixture_parses_with_the_real_parsers(tmp_path):
    info = build_vault(tmp_path, TODAY)
    items = parse_pipeline((tmp_path / "Efforts/Pipeline/kahf.md").read_text(), TODAY)
    assert [i["lane"] for i in items] == ["now", "next", "backlog", "done"]
    assert items[0]["product"] == "Router"
    assert items[0]["blocked_by"] == [info["blocker_id"]]
    assert items[0]["focus"] == info["week"]
    assert items[1]["stale"] is True
    entries = parse_notebook((tmp_path / "Efforts/Streams/kahf.md").read_text())
    blocker = next(e for e in entries if e["kind"] == "blocker")
    assert blocker["id"] == info["blocker_id"] and blocker["open"] is True
