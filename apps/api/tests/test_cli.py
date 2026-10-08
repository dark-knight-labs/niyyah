import pytest
from sqlalchemy import func, select

from app.api.v1.vault import _local_now
from app.cli import run_import
from app.models.planner import Task
from tests.conftest import TestSession
from tests.vault_fixture import build_vault


@pytest.mark.asyncio
async def test_import_command_reports_counts(auth_client, tmp_path, capsys):
    build_vault(tmp_path, _local_now().date())
    code = await run_import(tmp_path, "test@niyyah.app", replace=True, session_factory=TestSession)
    out = capsys.readouterr().out
    assert code == 0 and "tasks: 3" in out and "pipeline_items: 4" in out
    async with TestSession() as db:
        assert (await db.execute(select(func.count()).select_from(Task))).scalar_one() == 3


@pytest.mark.asyncio
async def test_import_command_refuses_without_replace(auth_client, tmp_path, capsys):
    code = await run_import(tmp_path, "test@niyyah.app", replace=False, session_factory=TestSession)
    assert code == 1 and "--replace" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_import_command_rejects_an_unknown_user(auth_client, tmp_path, capsys):
    code = await run_import(tmp_path, "nobody@niyyah.app", replace=True, session_factory=TestSession)
    assert code == 1 and "no user" in capsys.readouterr().err
