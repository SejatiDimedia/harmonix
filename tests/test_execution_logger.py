"""Tests for TerminalExecutionLogger (real-time agent terminal logging)."""

import io
import sys
from unittest.mock import patch

from src.agent.execution_logger import TerminalColors, TerminalExecutionLogger


def test_terminal_logger_enabled_false_outputs_nothing():
    """Verify that when disabled, logger does not write to stdout."""
    logger = TerminalExecutionLogger(enabled=False)
    captured = io.StringIO()

    with patch("sys.stdout", captured):
        logger.log_task_start(task_id="t1", query="query", session_id="s1")
        logger.log_step_start(step=1, max_steps=5, elapsed_seconds=0.5)
        logger.log_thought("thinking...")
        logger.log_tool_trigger(tool_name="run_sql", tool_args={"query": "SELECT 1"})
        logger.log_tool_result(tool_name="run_sql", observation={"status": "success", "rows": [1]})
        logger.log_approval_required(approval_id="a1", query="SELECT email", reasons=["PII"])
        logger.log_synthesizing()
        logger.log_task_completed(task_id="t1", steps=1, total_tokens=100, elapsed_seconds=1.2, sql_count=1)
        logger.log_task_failed(task_id="t1", error="err", step=1, elapsed_seconds=1.0)

    assert captured.getvalue() == ""


def test_terminal_logger_task_start_and_steps():
    """Verify task start, step start, and thought formatting."""
    logger = TerminalExecutionLogger(enabled=True)
    captured = io.StringIO()

    with patch("sys.stdout", captured):
        logger.log_task_start(task_id="test_task_123", query="Berapa total penjualan?", session_id="sess_abc")
        logger.log_step_start(step=2, max_steps=10, elapsed_seconds=1.52)
        logger.log_thought("Analisis data transaksi perlu query ke tabel orders.")

    output = captured.getvalue()
    assert "AGENT TASK START" in output
    assert "test_task_123" in output
    assert "Berapa total penjualan?" in output
    assert "sess_abc" in output
    assert "STEP 2/10" in output
    assert "Elapsed: 1.52s" in output
    assert "REASONING" in output
    assert "Analisis data transaksi" in output


def test_terminal_logger_tool_triggers_and_results():
    """Verify tool trigger and result formatting across different tools."""
    logger = TerminalExecutionLogger(enabled=True)
    captured = io.StringIO()

    with patch("sys.stdout", captured):
        # 1. run_sql
        logger.log_tool_trigger("run_sql", {"query": "SELECT * FROM orders LIMIT 5"})
        logger.log_tool_result("run_sql", {
            "status": "success",
            "columns": ["id", "amount"],
            "rows": [[1, 100], [2, 200]],
            "execution_time_ms": 15.4,
        }, duration_ms=16.0)

        # 2. get_schema
        logger.log_tool_trigger("get_schema", {"table_names": ["orders", "customers"]})
        logger.log_tool_result("get_schema", {
            "status": "success",
            "tables": {"orders": {}, "customers": {}},
        })

        # 3. search_glossary
        logger.log_tool_trigger("search_glossary", {"query": "AOV"})
        logger.log_tool_result("search_glossary", {
            "status": "success",
            "metrics": [{"metric_name": "AOV"}],
        })

        # 4. calculate
        logger.log_tool_trigger("calculate", {"code": "100 / 2"})
        logger.log_tool_result("calculate", {"status": "success", "result": 50})

        # 5. tool error
        logger.log_tool_result("run_sql", {"status": "error", "error": "syntax error near SELECT"})

        # 6. generic fallback
        logger.log_tool_trigger("custom_tool", {"foo": "bar"})
        logger.log_tool_result("custom_tool", "raw result string", duration_ms=10.0)

    output = captured.getvalue()
    assert "TOOL TRIGGER" in output
    assert "run_sql" in output
    assert "SELECT * FROM orders" in output
    assert "TOOL RESULT" in output
    assert "get_schema" in output
    assert "search_glossary" in output
    assert "calculate" in output
    assert "TOOL ERROR" in output
    assert "syntax error" in output
    assert "custom_tool" in output


def test_terminal_logger_approval_and_completion():
    """Verify approval gate, synthesizing, completed, and failed outputs."""
    logger = TerminalExecutionLogger(enabled=True)
    captured = io.StringIO()

    with patch("sys.stdout", captured):
        logger.log_approval_required(
            approval_id="appr_99",
            query="SELECT email FROM customers",
            reasons=["Akses kolom sensitif (PII)"],
        )
        logger.log_synthesizing()
        logger.log_task_completed(
            task_id="t_done",
            steps=3,
            total_tokens=1500,
            elapsed_seconds=2.45,
            sql_count=2,
        )
        logger.log_task_failed(
            task_id="t_fail",
            error="Connection refused",
            step=2,
            elapsed_seconds=3.10,
        )

    output = captured.getvalue()
    assert "HUMAN-IN-THE-LOOP APPROVAL GATE ACTIVATED" in output
    assert "appr_99" in output
    assert "Akses kolom sensitif (PII)" in output
    assert "SYNTHESIZING ANSWER" in output
    assert "AGENT TASK COMPLETED" in output
    assert "t_done" in output
    assert "Total Steps :" in output
    assert "1,500 tokens" in output
    assert "AGENT TASK FAILED" in output
    assert "Connection refused" in output
