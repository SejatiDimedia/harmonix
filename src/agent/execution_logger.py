"""Terminal Execution Logger for real-time Agent flow visualization (ANSI colors & structured tracing)."""

import json
import logging
from typing import Any

from src.config import settings

logger = logging.getLogger("harmonix.execution")


class TerminalColors:
    """ANSI color codes for high-contrast, visually pleasing terminal output."""
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    
    # Text colors
    CYAN = "\033[96m"
    BLUE = "\033[94m"
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    MAGENTA = "\033[95m"
    RED = "\033[91m"
    WHITE = "\033[97m"
    
    # Background accents
    BG_CYAN = "\033[46m"
    BG_BLUE = "\033[44m"
    BG_GREEN = "\033[42m"
    BG_MAGENTA = "\033[45m"
    BG_YELLOW = "\033[43m"
    BG_RED = "\033[41m"


class TerminalExecutionLogger:
    """Pretty-prints agent reasoning, tool triggers, observations, and milestones to terminal stdout."""

    def __init__(self, enabled: bool | None = None):
        self.enabled = enabled if enabled is not None else getattr(settings, "agent_terminal_logs", True)

    def log_task_start(self, task_id: str, query: str, session_id: str | None = None) -> None:
        """Log initiation of an agent reasoning task."""
        if not self.enabled:
            return

        c = TerminalColors
        sess_str = f" | Session: {c.WHITE}{session_id}{c.RESET}" if session_id else ""
        print(f"\n{c.BOLD}{c.CYAN}{'=' * 80}{c.RESET}")
        print(f"{c.BOLD}{c.CYAN}[AGENT TASK START]{c.RESET} ID: {c.WHITE}{task_id}{c.RESET}{sess_str}")
        print(f"{c.BOLD}{c.WHITE}[USER QUERY]:{c.RESET} \"{c.YELLOW}{query}{c.RESET}\"")
        print(f"{c.CYAN}{'=' * 80}{c.RESET}")

    def log_step_start(self, step: int, max_steps: int, elapsed_seconds: float) -> None:
        """Log start of an agent reasoning iteration."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"\n{c.BOLD}{c.YELLOW}>> [STEP {step}/{max_steps}]{c.RESET} {c.DIM}(Elapsed: {elapsed_seconds:.2f}s){c.RESET}")

    def log_thought(self, thought: str) -> None:
        """Log agent internal reasoning / plan before executing tools or answering."""
        if not self.enabled:
            return

        clean = thought.strip()
        if not clean:
            return

        # Show first 300 chars if thought is long
        preview = clean[:300] + ("..." if len(clean) > 300 else "")
        c = TerminalColors
        print(f"{c.BOLD}{c.BLUE}[REASONING]:{c.RESET} {preview}")

    def log_tool_trigger(self, tool_name: str, tool_args: dict[str, Any]) -> None:
        """Log agent tool trigger with cleaned parameters."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"{c.BOLD}{c.MAGENTA}[TOOL TRIGGER]{c.RESET} {c.BOLD}{c.WHITE}{tool_name}{c.RESET}")

        if tool_name == "run_sql":
            query = tool_args.get("query") or tool_args.get("sql") or ""
            print(f"   {c.CYAN}SQL Query:{c.RESET} {c.WHITE}{query}{c.RESET}")
        elif tool_name == "get_schema":
            tables = tool_args.get("table_names") or tool_args.get("table_name") or "All Tables"
            print(f"   {c.CYAN}Target Tables:{c.RESET} {c.WHITE}{tables}{c.RESET}")
        elif tool_name == "search_glossary":
            query = tool_args.get("query") or tool_args.get("term") or ""
            print(f"   {c.CYAN}Search Term:{c.RESET} \"{c.WHITE}{query}{c.RESET}\"")
        elif tool_name == "calculate":
            code = tool_args.get("code") or tool_args.get("expression") or ""
            print(f"   {c.CYAN}Code / Expr:{c.RESET} {c.WHITE}{code}{c.RESET}")
        else:
            args_str = json.dumps(tool_args, ensure_ascii=False)
            print(f"   {c.CYAN}Args:{c.RESET} {c.WHITE}{args_str}{c.RESET}")

    def log_tool_result(self, tool_name: str, observation: Any, duration_ms: float | None = None) -> None:
        """Log observation output returned by the executed tool."""
        if not self.enabled:
            return

        c = TerminalColors
        dur_str = f" in {duration_ms}ms" if duration_ms is not None else ""

        if isinstance(observation, dict):
            status = observation.get("status", "success")
            if status == "error" or "error" in observation:
                err_msg = observation.get("error") or observation.get("message")
                print(f"   {c.BOLD}{c.RED}[TOOL ERROR]{c.RESET} {tool_name}{dur_str} -> {err_msg}")
                return
            elif status == "approval_required":
                reasons = "; ".join(observation.get("risk_reasons", []))
                print(f"   {c.BOLD}{c.YELLOW}[APPROVAL REQUIRED]{c.RESET} {tool_name} -> {reasons}")
                return
            elif tool_name == "run_sql" and status == "success":
                row_count = observation.get("row_count", len(observation.get("rows", [])))
                exec_ms = observation.get("execution_time_ms", duration_ms)
                cols = ", ".join(observation.get("columns", []))
                print(f"   {c.BOLD}{c.GREEN}[TOOL RESULT]{c.RESET} {c.GREEN}run_sql success:{c.RESET} {row_count} rows returned ({exec_ms}ms) [Cols: {cols}]")
                return
            elif tool_name == "get_schema":
                tables = list(observation.get("tables", {}).keys()) or observation.get("available_tables", [])
                print(f"   {c.BOLD}{c.GREEN}[TOOL RESULT]{c.RESET} {c.GREEN}get_schema success:{c.RESET} Inspected {len(tables)} table(s): {tables}")
                return
            elif tool_name == "search_glossary":
                metrics = [m.get("metric_name") for m in observation.get("metrics", [])]
                print(f"   {c.BOLD}{c.GREEN}[TOOL RESULT]{c.RESET} {c.GREEN}search_glossary success:{c.RESET} Found definitions: {metrics}")
                return
            elif tool_name == "calculate":
                result = observation.get("result")
                print(f"   {c.BOLD}{c.GREEN}[TOOL RESULT]{c.RESET} {c.GREEN}calculate success:{c.RESET} result = {c.WHITE}{result}{c.RESET}")
                return

        # Fallback summary
        obs_preview = str(observation)[:200] + ("..." if len(str(observation)) > 200 else "")
        print(f"   {c.BOLD}{c.GREEN}[TOOL RESULT]{c.RESET} {tool_name}{dur_str} -> {obs_preview}")

    def log_approval_required(self, approval_id: str, query: str, reasons: list[str]) -> None:
        """Log HITL approval suspension."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"\n{c.BOLD}{c.YELLOW}{'!' * 80}{c.RESET}")
        print(f"{c.BOLD}{c.YELLOW}[HUMAN-IN-THE-LOOP APPROVAL GATE ACTIVATED]{c.RESET}")
        print(f"   Approval ID : {c.WHITE}{approval_id}{c.RESET}")
        print(f"   Reasons     : {c.RED}{'; '.join(reasons)}{c.RESET}")
        print(f"   Pending SQL : {c.WHITE}{query}{c.RESET}")
        print(f"{c.YELLOW}{'!' * 80}{c.RESET}")

    def log_synthesizing(self) -> None:
        """Log when agent is formulating the final analytical synthesis."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"{c.BOLD}{c.CYAN}[SYNTHESIZING ANSWER]{c.RESET} Preparing final analytical data report...")

    def log_auditing(self, model: str = "") -> None:
        """Log when Data Auditor quality gate is invoked (FR-35)."""
        if not self.enabled:
            return

        c = TerminalColors
        model_str = f" via {c.WHITE}{model}{c.RESET}" if model else ""
        print(f"{c.BOLD}{c.MAGENTA}[DATA AUDITOR GATE]{c.RESET} Verifying SQL logic and data consistency{model_str}...")

    def log_audit_verdict(self, status: str, confidence: float, badge: str, critique: str) -> None:
        """Log the Data Auditor quality gate outcome (FR-35)."""
        if not self.enabled:
            return

        c = TerminalColors
        if status.upper() == "PASSED":
            color = c.GREEN
        elif status.upper() == "WARNING":
            color = c.YELLOW
        else:
            color = c.RED

        print(f"   {color}[{status.upper()}]{c.RESET} {c.BOLD}{badge}{c.RESET} (Confidence: {confidence:.0%})")
        if critique:
            print(f"      {c.DIM}{critique}{c.RESET}")

    def log_task_completed(
        self,
        task_id: str,
        steps: int,
        total_tokens: int,
        elapsed_seconds: float,
        sql_count: int,
    ) -> None:
        """Log successful completion summary of the agent task."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"\n{c.BOLD}{c.GREEN}{'=' * 80}{c.RESET}")
        print(f"{c.BOLD}{c.GREEN}[AGENT TASK COMPLETED]{c.RESET} ID: {c.WHITE}{task_id}{c.RESET}")
        print(f"   {c.CYAN}Total Steps :{c.RESET} {c.WHITE}{steps}{c.RESET}")
        print(f"   {c.CYAN}SQL Queries :{c.RESET} {c.WHITE}{sql_count} executed{c.RESET}")
        print(f"   {c.CYAN}Token Usage :{c.RESET} {c.WHITE}{total_tokens:,} tokens{c.RESET}")
        print(f"   {c.CYAN}Total Time  :{c.RESET} {c.WHITE}{elapsed_seconds:.2f}s{c.RESET}")
        print(f"{c.GREEN}{'=' * 80}{c.RESET}\n")

    def log_task_failed(self, task_id: str, error: str, step: int, elapsed_seconds: float) -> None:
        """Log task abort / failure."""
        if not self.enabled:
            return

        c = TerminalColors
        print(f"\n{c.BOLD}{c.RED}{'=' * 80}{c.RESET}")
        print(f"{c.BOLD}{c.RED}❌ [AGENT TASK FAILED]{c.RESET} ID: {c.WHITE}{task_id}{c.RESET}")
        print(f"   {c.RED}Failed at Step :{c.RESET} {step}")
        print(f"   {c.RED}Elapsed Time   :{c.RESET} {elapsed_seconds:.2f}s")
        print(f"   {c.RED}Error Reason   :{c.RESET} {error}")
        print(f"{c.RED}{'=' * 80}{c.RESET}\n")
