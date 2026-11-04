"""Unit tests for FR-18 Working Memory & Scratchpad Engine."""

import os
import shutil
from pathlib import Path
import pytest

from src.agent.prompts import build_analyst_system_prompt
from src.agent.scratchpad import SCRATCHPAD_DIR, WorkingMemoryManager, WorkingMemoryState
from src.tools.scratchpad import ScratchpadTool


@pytest.fixture(autouse=True)
def cleanup_test_scratchpad():
    """Ensure test scratchpad directory and state are cleaned up before and after tests."""
    test_task_id = "test_task_fr18"
    WorkingMemoryManager.clear(test_task_id)
    yield
    WorkingMemoryManager.clear(test_task_id)


def test_working_memory_manager_crud():
    """Test setting, appending, retrieving, and clearing working memory notes."""
    task_id = "test_task_fr18"

    # 1. Initial empty state
    state = WorkingMemoryManager.get_or_create(task_id, session_id="test_sess")
    assert state.task_id == task_id
    assert state.notes == {}

    # 2. Set note
    res_set = WorkingMemoryManager.set_note(
        task_id=task_id,
        key="plan",
        content="1. Query aggregate revenue\n2. Group by product category",
    )
    assert res_set["status"] == "success"
    assert "plan" in res_set["active_keys"]

    # 3. Get note
    note = WorkingMemoryManager.get_notes(task_id, key="plan")
    assert note["status"] == "success"
    assert "Query aggregate revenue" in note["content"]

    # 4. Append note
    res_append = WorkingMemoryManager.append_note(
        task_id=task_id,
        key="hypotheses",
        content="Periksa apakah kategori Electronics mendominasi",
    )
    assert res_append["status"] == "success"
    assert "hypotheses" in res_append["active_keys"]
    assert "Electronics" in res_append["content"]

    # Append second bullet to existing note
    res_append_2 = WorkingMemoryManager.append_note(
        task_id=task_id,
        key="hypotheses",
        content="Periksa outlier pada order bernilai > 100jt",
    )
    assert "outlier" in res_append_2["content"]

    # 5. List notes
    all_notes = WorkingMemoryManager.get_notes(task_id)
    assert all_notes["status"] == "success"
    assert all_notes["total_notes"] == 2
    assert "plan" in all_notes["notes"]
    assert "hypotheses" in all_notes["notes"]

    # 6. Delete note
    deleted = WorkingMemoryManager.delete_note(task_id, "plan")
    assert deleted is True
    assert WorkingMemoryManager.get_notes(task_id, "plan")["status"] == "not_found"


def test_working_memory_disk_persistence():
    """Test saving and loading working memory to/from external JSON file."""
    task_id = "test_task_fr18"

    WorkingMemoryManager.set_note(
        task_id=task_id,
        key="interim_calc",
        content="Total Electronics = 186.300.000 (52% dari total omzet)",
        session_id="sess_123",
    )

    file_path = Path(f"data/scratchpads/{task_id}.json")
    assert file_path.exists()

    # Clear in-memory cache to simulate fresh server/process restart
    if task_id in WorkingMemoryManager._instances:
        del WorkingMemoryManager._instances[task_id]

    # Reload from disk
    loaded_state = WorkingMemoryManager.get_or_create(task_id)
    assert loaded_state is not None
    assert "interim_calc" in loaded_state.notes
    assert "186.300.000" in loaded_state.notes["interim_calc"].content
    assert loaded_state.session_id == "sess_123"


def test_working_memory_prompt_formatting():
    """Test formatting working memory into system prompt context."""
    task_id = "test_task_fr18"

    # Empty memory -> returns empty string
    empty_prompt = WorkingMemoryManager.format_for_prompt(task_id)
    assert empty_prompt == ""

    # Populate memory
    WorkingMemoryManager.set_note(
        task_id=task_id,
        key="rencana_analisis",
        content="Langkah 1: Verifikasi tabel orders\nLangkah 2: Hitung AOV",
    )

    formatted = WorkingMemoryManager.format_for_prompt(task_id)
    assert "WORKING MEMORY / SCRATCHPAD - FR-18" in formatted
    assert "[RENCANA_ANALISIS]" in formatted
    assert "Hitung AOV" in formatted


@pytest.mark.asyncio
async def test_build_analyst_system_prompt_with_scratchpad():
    """Test that build_analyst_system_prompt appends working memory at the end."""
    task_id = "test_task_fr18"

    WorkingMemoryManager.set_note(
        task_id=task_id,
        key="data_quality_log",
        content="Tidak ditemukan baris duplikat pada order_id",
    )

    prompt = await build_analyst_system_prompt(
        session_id="session_test",
        task_id=task_id,
    )

    assert "CATATAN KERJA AKTIF & RENCANA ANALISIS" in prompt
    assert "[DATA_QUALITY_LOG]" in prompt
    assert "Tidak ditemukan baris duplikat" in prompt


@pytest.mark.asyncio
async def test_scratchpad_tool_execution():
    """Test ScratchpadTool tool calls across all supported actions."""
    task_id = "test_task_fr18"
    tool = ScratchpadTool(task_id=task_id, session_id="test_sess")

    # 1. Action set
    res_set = await tool.execute(
        action="set",
        key="checklist",
        content="Cek kueri SQL dengan EXPLAIN",
    )
    assert res_set["status"] == "success"

    # 2. Action append
    res_app = await tool.execute(
        action="append",
        key="checklist",
        content="Verifikasi total nominal dengan tabel payments",
    )
    assert res_app["status"] == "success"
    assert "payments" in res_app["content"]

    # 3. Action get
    res_get = await tool.execute(action="get", key="checklist")
    assert res_get["status"] == "success"
    assert "EXPLAIN" in res_get["content"]

    # 4. Action list
    res_list = await tool.execute(action="list")
    assert res_list["status"] == "success"
    assert "checklist" in res_list["notes"]

    # 5. Missing required params
    err_res = await tool.execute(action="set", key="test", content="")
    assert err_res["status"] == "error"

    # 6. Action clear
    res_clear = await tool.execute(action="clear")
    assert res_clear["status"] == "success"

    empty_list = await tool.execute(action="list")
    assert empty_list["total_notes"] == 0
