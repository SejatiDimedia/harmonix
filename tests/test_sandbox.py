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

