"""Secure Python calculation sandbox with AST validation and isolated execution (FR-08, FR-26).

Implements multi-layer isolation:
1. Static AST Security Validation: Blocks unauthorized imports, dangerous built-ins, and dunder traversal.
2. Air-Gapped Docker Container Sandbox: Executes code inside an ephemeral container with --network none,
   memory ceilings, CPU limits, read-only rootfs, and dropped capabilities (FR-26).
3. Subprocess AST Sandbox: High-speed, in-process isolated runner with strict built-ins allowlist for local fallback.
4. SandboxManager: Auto-detects Docker daemon availability and seamlessly selects the highest isolation level.
"""

import ast
import asyncio
import json
import logging
import math
import statistics
import sys
import time
from typing import Any
from pydantic import BaseModel, Field, model_validator

from src.config import settings
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
            "Allowed modules: math, statistics, json, datetime, decimal. Network access and file system operations are blocked."
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


def build_runner_script(code_to_run: str) -> str:
    """Build isolated runner script with restricted globals and safe built-ins."""
    return f"""
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

code_to_run = {json.dumps(code_to_run)}

try:
    exec(code_to_run, safe_globals, local_scope)
    res = local_scope.get('result', None)
    print(json.dumps({{'status': 'success', 'result': res}}))
except Exception as e:
    print(json.dumps({{'status': 'error', 'error_type': type(e).__name__, 'message': str(e)}}))
"""


# ==============================================================================
# Isolation Strategies (FR-26)
# ==============================================================================

class DockerAirGappedSandbox:
    """Executes calculation code inside a physical air-gapped Docker container (FR-26).
    
    Security flags:
    - --network none: Total network isolation (no socket, no external internet, air-gapped).
    - --memory {mem}: Strict RAM limit preventing OOM crashes.
    - --cpus {cpu}: CPU quota preventing CPU starvation.
    - --read-only: Root filesystem is read-only.
    - --cap-drop ALL: Strips all Linux privileges.
    - --security-opt no-new-privileges: Blocks privilege escalation.
    """

    @classmethod
    async def is_docker_available(cls) -> bool:
        """Check whether Docker CLI and daemon are operational."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "docker", "info",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, _ = await asyncio.wait_for(proc.communicate(), timeout=1.5)
            return proc.returncode == 0
        except Exception:
            return False

    @classmethod
    async def execute(
        cls,
        runner_script: str,
        timeout_seconds: float = 5.0,
        image: str = "python:3.13-slim",
        memory_limit: str = "128m",
        cpu_limit: str = "0.5",
    ) -> dict[str, Any]:
        """Execute runner script inside an air-gapped container."""
        cmd = [
            "docker", "run", "--rm", "-i",
            "--network", "none",
            "--memory", memory_limit,
            "--cpus", str(cpu_limit),
            "--read-only",
            "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges",
            image,
            "python3", "-c", runner_script,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout_seconds)
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise

        out_str = stdout.decode("utf-8").strip()
        if out_str:
            try:
                parsed = json.loads(out_str)
                parsed["sandbox_type"] = "docker_air_gapped"
                parsed["network_isolated"] = True
                return parsed
            except json.JSONDecodeError:
                pass

        err_str = stderr.decode("utf-8").strip()
        return {
            "status": "error",
            "message": err_str or "No output from Docker sandbox",
            "sandbox_type": "docker_air_gapped",
            "network_isolated": True,
        }


class SubprocessASTSandbox:
    """Executes calculation code in an isolated subprocess with restricted built-ins."""

    @classmethod
    async def execute(
        cls,
        runner_script: str,
        timeout_seconds: float = 5.0,
    ) -> dict[str, Any]:
        """Execute runner script in a subprocess."""
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            runner_script,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise

        out_str = stdout.decode("utf-8").strip()
        if out_str:
            try:
                parsed = json.loads(out_str)
                parsed["sandbox_type"] = "subprocess_ast"
                parsed["network_isolated"] = True
                return parsed
            except json.JSONDecodeError:
                pass

        err_str = stderr.decode("utf-8").strip()
        return {
            "status": "error",
            "message": err_str or "No output from calculation runner",
            "sandbox_type": "subprocess_ast",
            "network_isolated": True,
        }


class SandboxManager:
    """Unified manager orchestrating sandboxed execution with automatic fallbacks (FR-26)."""

    @classmethod
    async def execute(
        cls,
        clean_code: str,
        timeout_seconds: float = 5.0,
        prefer_docker: bool = True,
    ) -> dict[str, Any]:
        """Executes code, trying Docker air-gapped sandbox first if enabled, or falling back to Subprocess AST sandbox."""
        runner_script = build_runner_script(clean_code)

        # 1. Attempt Docker air-gapped sandbox if configured & available
        if prefer_docker and settings.sandbox_docker_enabled:
            docker_alive = await DockerAirGappedSandbox.is_docker_available()
            if docker_alive:
                try:
                    res = await DockerAirGappedSandbox.execute(
                        runner_script=runner_script,
                        timeout_seconds=timeout_seconds,
                        image=settings.sandbox_docker_image,
                        memory_limit=settings.sandbox_memory_limit,
                        cpu_limit=settings.sandbox_cpu_limit,
                    )
                    return res
                except Exception as e:
                    logger.warning("Docker sandbox execution failed (%s), falling back to Subprocess AST sandbox.", e)

        # 2. Fallback to Subprocess AST Sandbox
        return await SubprocessASTSandbox.execute(
            runner_script=runner_script,
            timeout_seconds=timeout_seconds,
        )


# ==============================================================================
# Calculate Tool Implementation
# ==============================================================================

class CalculateTool(BaseTool):
    """Tool to execute safe Python code for statistical calculations and complex math (FR-08, FR-26)."""

    name: str = "calculate"
    description: str = (
        "Execute Python code for complex calculations (percentages, statistical aggregations, correlations, growth rates) "
        "that are difficult or inefficient in SQL. The code must store the final output in a variable named 'result'."
    )
    args_schema: type[BaseModel] = CalculateInput

    def __init__(self, timeout_seconds: float = 5.0, prefer_docker: bool = True):
        self.timeout_seconds = timeout_seconds
        self.prefer_docker = prefer_docker

    async def execute(
        self,
        code: str | None = None,
        expression: str | None = None,
        q: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Validate and execute Python code in an isolated sandbox environment (FR-26)."""
        t0 = time.perf_counter()
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
                "network_isolated": True,
            }

        # 2. Execute via SandboxManager (Docker air-gapped or Subprocess AST fallback)
        try:
            parsed = await asyncio.wait_for(
                SandboxManager.execute(
                    clean_code=clean_code,
                    timeout_seconds=self.timeout_seconds,
                    prefer_docker=self.prefer_docker,
                ),
                timeout=self.timeout_seconds + 1.0,
            )
            parsed["code"] = code
            parsed["duration_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            return parsed
        except asyncio.TimeoutError:
            return {
                "status": "error",
                "error_type": "TimeoutError",
                "message": f"Execution timed out after {self.timeout_seconds} seconds.",
                "code": code,
                "network_isolated": True,
            }
        except Exception as e:
            return {
                "status": "error",
                "error_type": type(e).__name__,
                "message": str(e),
                "code": code,
                "network_isolated": True,
            }
