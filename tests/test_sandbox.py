"""Tests for CalculateTool and Python AST Security Validator (FR-08, FR-26)."""

import pytest
from src.tools.sandbox import CalculateTool, PythonASTSecurityValidator, SandboxSecurityError


def test_ast_validator_blocks_forbidden_imports():
    """Verify validator blocks os, sys, subprocess, and unauthorized modules."""
    bad_codes = [
        "import os\nos.system('ls')",
        "import sys\nsys.exit(1)",
        "from subprocess import Popen\nresult = 1",
        "import socket",
        "import shutil",
    ]
    for code in bad_codes:
        with pytest.raises(SandboxSecurityError) as exc_info:
            PythonASTSecurityValidator.validate(code)
        assert "strictly forbidden" in str(exc_info.value)


def test_ast_validator_blocks_forbidden_builtins():
    """Verify validator blocks eval, exec, open, __import__, etc."""
    bad_codes = [
        "result = eval('1 + 1')",
        "open('/etc/passwd', 'r')",
        "__import__('os').system('ls')",
        "globals()['secret'] = 1",
    ]
    for code in bad_codes:
        with pytest.raises(SandboxSecurityError) as exc_info:
            PythonASTSecurityValidator.validate(code)
        assert "strictly forbidden" in str(exc_info.value)


def test_ast_validator_blocks_dunder_attribute_traversal():
    """Verify validator blocks Python object sandbox escape via dunder attributes."""
    code = "result = ().__class__.__bases__[0].__subclasses__()"
    with pytest.raises(SandboxSecurityError) as exc_info:
        PythonASTSecurityValidator.validate(code)
    assert "private attribute" in str(exc_info.value)


def test_ast_validator_allows_safe_math_and_stats():
    """Verify validator permits standard math, statistics, and datetime operations."""
    safe_code = """
import math
import statistics

numbers = [10, 20, 30, 40, 50]
avg = statistics.mean(numbers)
std = statistics.stdev(numbers)
result = round(math.sqrt(avg * std), 2)
"""
    # Should not raise exception
    PythonASTSecurityValidator.validate(safe_code)


@pytest.mark.asyncio
async def test_calculate_tool_successful_execution():
    """Verify CalculateTool computes results correctly and returns dict."""
    tool = CalculateTool(timeout_seconds=2.0)
    code = """
gmv = 150000000
orders = 1250
aov = gmv / orders
growth_rate = ((1250 - 1000) / 1000) * 100
result = {"aov": aov, "growth_percentage": round(growth_rate, 2)}
"""
    output = await tool.execute(code=code)
    assert output["status"] == "success"
    assert output["result"]["aov"] == 120000.0
    assert output["result"]["growth_percentage"] == 25.0


@pytest.mark.asyncio
async def test_calculate_tool_security_violation():
    """Verify CalculateTool catches AST security violations gracefully."""
    tool = CalculateTool(timeout_seconds=2.0)
    code = "import os\nresult = os.getcwd()"
    output = await tool.execute(code=code)
    assert output["status"] == "security_violation"
    assert "strictly forbidden" in output["message"]


@pytest.mark.asyncio
async def test_calculate_tool_timeout():
    """Verify CalculateTool aborts infinite loops exceeding timeout."""
    tool = CalculateTool(timeout_seconds=0.2)
    code = """
while True:
    pass
result = 1
"""
    output = await tool.execute(code=code)
    assert output["status"] == "error"
    assert output["error_type"] == "TimeoutError"


@pytest.mark.asyncio
async def test_calculate_tool_bare_expression_and_aliases():
    """Verify CalculateTool automatically evaluates bare expressions and supports aliases."""
    tool = CalculateTool()
    # 1. Bare expression without 'result ='
    res1 = await tool.execute(code="1500000 / 3")
    assert res1["status"] == "success"
    assert res1["result"] == 500000.0

    # 2. Expression alias
    res2 = await tool.execute(expression="round(42.567, 1)")
    assert res2["status"] == "success"
    assert res2["result"] == 42.6


@pytest.mark.asyncio
async def test_calculate_tool_returns_sandbox_metadata():
    """Verify CalculateTool returns execution isolation metadata (FR-26)."""
    tool = CalculateTool(timeout_seconds=2.0)
    output = await tool.execute(code="result = 100 * 2.5")
    assert output["status"] == "success"
    assert output["result"] == 250.0
    assert "sandbox_type" in output
    assert output["network_isolated"] is True
    assert "duration_ms" in output


@pytest.mark.asyncio
async def test_docker_air_gapped_sandbox_flags():
    """Verify DockerAirGappedSandbox builds command with --network none, memory ceiling, and cap-drop."""
    from unittest.mock import AsyncMock, patch
    from src.tools.sandbox import DockerAirGappedSandbox

    mock_proc = AsyncMock()
    mock_proc.communicate.return_value = (b'{"status": "success", "result": 42}', b"")
    mock_proc.returncode = 0

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc) as mock_exec:
        res = await DockerAirGappedSandbox.execute(
            runner_script="print('hello')",
            timeout_seconds=3.0,
            image="python:3.13-slim",
            memory_limit="128m",
            cpu_limit="0.5",
        )
        assert res["status"] == "success"
        assert res["result"] == 42
        assert res["sandbox_type"] == "docker_air_gapped"
        assert res["network_isolated"] is True

        called_args = mock_exec.call_args[0]
        assert called_args[0] == "docker"
        assert called_args[1] == "run"
        assert "--network" in called_args
        network_idx = called_args.index("--network")
        assert called_args[network_idx + 1] == "none"
        assert "--memory" in called_args
        assert "--read-only" in called_args
        assert "--cap-drop" in called_args


@pytest.mark.asyncio
async def test_sandbox_manager_fallback():
    """Verify SandboxManager gracefully falls back to SubprocessASTSandbox when Docker is unavailable."""
    from unittest.mock import AsyncMock, patch
    from src.tools.sandbox import DockerAirGappedSandbox, SandboxManager

    with patch.object(DockerAirGappedSandbox, "is_docker_available", AsyncMock(return_value=False)):
        res = await SandboxManager.execute("result = 5 + 7", timeout_seconds=2.0)
        assert res["status"] == "success"
        assert res["result"] == 12
        assert res["sandbox_type"] == "subprocess_ast"
        assert res["network_isolated"] is True


