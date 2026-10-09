import json

import pytest
from sqlalchemy import func, select

from app.api.v1.vault import _local_now
from app.cli import run_import
from app.models.planner import Task
from tests.conftest import TestSession
from tests.sample_snapshot import sample_snapshot


@pytest.fixture
def export_file(tmp_path):
    path = tmp_path / "export.json"
    path.write_text(json.dumps(sample_snapshot(_local_now().date())))
    return path


@pytest.mark.asyncio
async def test_import_command_reports_counts(auth_client, export_file, capsys):
    code = await run_import(export_file, "test@niyyah.app", replace=True, session_factory=TestSession)
    out = capsys.readouterr().out
    assert code == 0 and "tasks: 3" in out and "pipeline_items: 4" in out
    async with TestSession() as db:
        assert (await db.execute(select(func.count()).select_from(Task))).scalar_one() == 3


@pytest.mark.asyncio
async def test_import_command_refuses_without_replace(auth_client, export_file, capsys):
    code = await run_import(export_file, "test@niyyah.app", replace=False, session_factory=TestSession)
    assert code == 1 and "--replace" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_import_command_rejects_an_unknown_user(auth_client, export_file, capsys):
    code = await run_import(export_file, "nobody@niyyah.app", replace=True, session_factory=TestSession)
    assert code == 1 and "no user" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_import_command_rejects_a_bad_file(auth_client, tmp_path, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"version": 2}))
    assert await run_import(bad, "test@niyyah.app", replace=True, session_factory=TestSession) == 1
    assert "cannot read" in capsys.readouterr().err
