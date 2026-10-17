"""Secure Python calculation sandbox with AST validation and isolated execution (FR-08, FR-26)."""

import ast
import asyncio
import json
import logging
import math
import statistics
import sys
from typing import Any
from pydantic import BaseModel, Field, model_validator

from src.tools.base import BaseTool

logger = logging.getLogger(__name__)


class SandboxSecurityError(Exception):
    """Raised when Python code in calculate tool violates sandbox security policy."""
    pass


class CalculateInput(BaseModel):
    """Input parameters for calculate tool."""
    code: str = Field(
        ...,
        description=(
            "Python code to perform mathematical, statistical, or advanced data calculations. "
            "Must define a variable named 'result' containing the final output. "
            "Allowed modules: math, statistics, json, datetime. Network access and file system operations are blocked."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def populate_code_from_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if not data.get("code"):
                for alias in ("expression", "expr", "q"):
                    if data.get(alias):
                        data["code"] = data[alias]
                        break
        return data


class PythonASTSecurityValidator:
    """Validates Python code against AST allowlists to block dangerous imports and calls."""

    ALLOWED_MODULES = {"math", "statistics", "json", "datetime", "decimal"}
    FORBIDDEN_CALLS = {
        "eval", "exec", "open", "__import__", "globals", "locals", 
        "getattr", "setattr", "delattr", "compile", "breakpoint"
    }

    @classmethod
    def validate(cls, code: str) -> None:
        """Parse code into Python AST and verify security rules."""
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            raise SandboxSecurityError(f"Python syntax error: {e}") from e

        for node in ast.walk(tree):
            # 1. Check imports (e.g., import os, from os import system)
            if isinstance(node, ast.Import):
                for alias in node.names:
                    module_root = alias.name.split(".")[0]
                    if module_root not in cls.ALLOWED_MODULES:
                        raise SandboxSecurityError(
                            f"Security violation: Module '{alias.name}' is strictly forbidden. Allowed modules: {cls.ALLOWED_MODULES}"
                        )
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    module_root = node.module.split(".")[0]
                    if module_root not in cls.ALLOWED_MODULES:
                        raise SandboxSecurityError(
                            f"Security violation: Importing from '{node.module}' is strictly forbidden."
                        )

            # 2. Check function calls
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name):
                    if node.func.id in cls.FORBIDDEN_CALLS:
                        raise SandboxSecurityError(
                            f"Security violation: Built-in function '{node.func.id}()' is strictly forbidden."
                        )

            # 3. Block private attribute access (__dict__, __class__, __subclasses__)
            if isinstance(node, ast.Attribute):
                if node.attr.startswith("__"):
                    raise SandboxSecurityError(
                        f"Security violation: Access to private attribute '{node.attr}' is forbidden."
                    )


class CalculateTool(BaseTool):
    """Tool to execute safe Python code for statistical calculations and complex math."""

    name: str = "calculate"
    description: str = (
        "Execute Python code for complex calculations (percentages, statistical aggregations, correlations, growth rates) "
        "that are difficult or inefficient in SQL. The code must store the final output in a variable named 'result'."
    )
    args_schema: type[BaseModel] = CalculateInput

    def __init__(self, timeout_seconds: float = 5.0):
        self.timeout_seconds = timeout_seconds

    async def execute(
        self,
        code: str | None = None,
        expression: str | None = None,
        q: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Validate and execute Python code in a safe sandbox environment."""
        raw_code = (code or expression or q or "").strip()
        if not raw_code:
            return {
                "status": "error",
                "message": "Missing Python code or expression parameter.",
            }

        # Auto-wrap bare expressions into 'result = <expr>'
        clean_code = raw_code
        try:
            tree = ast.parse(clean_code)
            if len(tree.body) == 1 and isinstance(tree.body[0], ast.Expr):
                clean_code = f"result = {clean_code}"
        except Exception:
            pass

        # 1. AST Static Security Validation
        try:
            PythonASTSecurityValidator.validate(clean_code)
        except SandboxSecurityError as e:
            return {
                "status": "security_violation",
                "message": str(e),
                "code": clean_code,
            }

        # 2. Build isolated runner script
        runner_script = f"""
import json, math, statistics, datetime, decimal

safe_builtins = {{
    'abs': abs, 'all': all, 'any': any, 'bool': bool, 'dict': dict,
    'float': float, 'int': int, 'len': len, 'list': list, 'max': max,
    'min': min, 'pow': pow, 'range': range, 'round': round, 'set': set,
    'str': str, 'sum': sum, 'tuple': tuple, 'zip': zip
}}
safe_globals = {{
    '__builtins__': safe_builtins,
    'math': math,
    'statistics': statistics,
    'datetime': datetime,
    'decimal': decimal
}}
local_scope = {{}}

code_to_run = {json.dumps(clean_code)}

try:
    exec(code_to_run, safe_globals, local_scope)
    res = local_scope.get('result', None)
    print(json.dumps({{'status': 'success', 'result': res}}))
except Exception as e:
    print(json.dumps({{'status': 'error', 'error_type': type(e).__name__, 'message': str(e)}}))
"""

        # 3. Execute in an isolated subprocess with hard OS-level kill timeout
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-c",
                runner_script,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=self.timeout_seconds,
            )
            out_str = stdout.decode("utf-8").strip()
            if out_str:
                try:
                    parsed = json.loads(out_str)
                    parsed["code"] = code
                    return parsed
                except json.JSONDecodeError:
                    pass
            err_str = stderr.decode("utf-8").strip()
            return {
                "status": "error",
                "message": err_str or "No output from calculation runner",
                "code": code,
            }
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            return {
                "status": "error",
                "error_type": "TimeoutError",
                "message": f"Execution timed out after {self.timeout_seconds} seconds.",
                "code": code,
            }
        except Exception as e:
            return {
                "status": "error",
                "error_type": type(e).__name__,
                "message": str(e),
                "code": code,
            }
