from datetime import date

from app.services.vault_pipeline import parse_pipeline
from app.services.vault_quarter import load_streams, parse_quarter
from app.services.vault_views import pipelines_response, quarter_response

TODAY = date(2026, 10, 7)
QUARTER = "---\nquarter: 2026-Q4\nstarts: 2026-10-01\nends: 2026-12-31\n---\n# Obj\n> ar\n\n## kahf\n- goal: Ship DNS\n- oct: Router live\n"


def test_quarter_response_from_a_parsed_note():
    res = quarter_response(parse_quarter(QUARTER), "2026-Q4", TODAY)
    assert res.quarter == "2026-Q4" and res.objective == "Obj" and res.streams[0].stream == "kahf"
    assert res.streams[0].checkpoints[0].month == "oct"


def test_pipelines_response_skips_streams_without_a_pipeline():
    streams = load_streams(QUARTER)  # kahf plus the built-in sleep, which has no pipeline
    items = {"kahf": parse_pipeline("## Now\n- [ ] One\n", TODAY)}
    res = pipelines_response(streams, items, TODAY)
    assert [s.stream for s in res.streams] == ["kahf"]
    assert res.streams[0].items[0].text == "One"
