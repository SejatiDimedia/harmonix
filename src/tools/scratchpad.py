"""Tool for agent working memory and multi-step scratchpad notes (FR-18)."""

from typing import Any, Literal
from pydantic import BaseModel, Field

from src.agent.scratchpad import WorkingMemoryManager
from src.tools.base import BaseTool


class ScratchpadInput(BaseModel):
    """Input parameters for scratchpad tool."""
    action: Literal["set", "get", "append", "list", "clear"] = Field(
        ...,
        description="The action to perform: 'set' (write/overwrite note), 'append' (add bullet to note), 'get' (read note), 'list' (list all keys), or 'clear' (reset memory).",
    )
    key: str | None = Field(
        default=None,
        description="The category/key for the note (e.g., 'plan', 'hypotheses', 'data_quality', 'interim_calculations'). Required for 'set', 'append', and specific 'get'.",
    )
    content: str | None = Field(
        default=None,
        description="The text content or bullet point to store in working memory. Required for 'set' and 'append'.",
    )


class ScratchpadTool(BaseTool):
    """Tool allowing agents to maintain an external structured scratchpad during complex multi-step reasoning (FR-18)."""

    name: str = "scratchpad"
    description: str = (
        "Manage working memory and scratchpad notes during long multi-step analysis tasks (FR-18). "
        "Use this tool to write down your execution plan, track hypotheses, log data anomaly findings, "
        "and record intermediate numerical calculations so you do not lose context between SQL queries. "
        "Actions: 'set' (write note), 'append' (add checklist bullet), 'get' (read notes), 'list' (view all topics), 'clear' (reset)."
    )
    args_schema: type[BaseModel] = ScratchpadInput

    def __init__(self, task_id: str = "default_task", session_id: str | None = None):
        self.task_id = task_id
        self.session_id = session_id

    def set_context(self, task_id: str, session_id: str | None = None) -> None:
        """Update active task and session context for the tool."""
        self.task_id = task_id
        self.session_id = session_id

    async def execute(
        self,
        action: str = "list",
        key: str | None = None,
        content: str | None = None,
        task_id: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute working memory action."""
        active_task_id = task_id or self.task_id
        act = (action or "list").strip().lower()

        if act == "set":
            if not key:
                return {"status": "error", "error": "Parameter 'key' wajib diisi untuk action 'set'."}
            if not content:
                return {"status": "error", "error": "Parameter 'content' wajib diisi untuk action 'set'."}
            return WorkingMemoryManager.set_note(
                task_id=active_task_id,
                key=key,
                content=content,
                session_id=self.session_id,
            )

        elif act == "append":
            if not key:
                return {"status": "error", "error": "Parameter 'key' wajib diisi untuk action 'append'."}
            if not content:
                return {"status": "error", "error": "Parameter 'content' wajib diisi untuk action 'append'."}
            return WorkingMemoryManager.append_note(
                task_id=active_task_id,
                key=key,
                content=content,
                session_id=self.session_id,
            )

        elif act == "get":
            return WorkingMemoryManager.get_notes(task_id=active_task_id, key=key)

        elif act == "list":
            return WorkingMemoryManager.get_notes(task_id=active_task_id, key=None)

        elif act == "clear":
            WorkingMemoryManager.clear(task_id=active_task_id)
            return {"status": "success", "action": "clear", "message": f"Working memory untuk task {active_task_id} telah dibersihkan."}

        return {
            "status": "error",
            "error": f"Action '{action}' tidak dikenal. Pilih salah satu dari: 'set', 'get', 'append', 'list', 'clear'.",
        }
