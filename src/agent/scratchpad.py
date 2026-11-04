"""Working Memory & Scratchpad Engine (FR-18): External state and file-based working memory for long tasks."""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SCRATCHPAD_DIR = Path("data/scratchpads")


class ScratchpadEntry(BaseModel):
    """A single note entry in the agent's working memory."""
    key: str
    content: str
    updated_at: float = Field(default_factory=time.time)


class WorkingMemoryState(BaseModel):
    """Snapshot of working memory for a specific agent task and session."""
    task_id: str
    session_id: str | None = None
    notes: dict[str, ScratchpadEntry] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def to_dict(self) -> dict[str, str]:
        """Convert notes to a simple key-content dictionary."""
        return {k: v.content for k, v in self.notes.items()}


class WorkingMemoryManager:
    """Manager for managing, persisting, and formatting agent working memory (FR-18)."""

    _instances: dict[str, WorkingMemoryState] = {}

    @classmethod
    def get_or_create(cls, task_id: str, session_id: str | None = None) -> WorkingMemoryState:
        """Get existing in-memory state or load from disk / create fresh."""
        if task_id in cls._instances:
            return cls._instances[task_id]

        # Attempt to load from disk
        disk_state = cls.load_from_file(task_id)
        if disk_state:
            cls._instances[task_id] = disk_state
            return disk_state

        # Initialize fresh state
        state = WorkingMemoryState(task_id=task_id, session_id=session_id)
        cls._instances[task_id] = state
        return state

    @classmethod
    def set_note(cls, task_id: str, key: str, content: str, session_id: str | None = None) -> dict[str, Any]:
        """Set or overwrite a working memory note entry."""
        state = cls.get_or_create(task_id, session_id)
        clean_key = key.strip().lower()
        state.notes[clean_key] = ScratchpadEntry(key=clean_key, content=content.strip())
        state.updated_at = time.time()
        cls.save_to_file(task_id)
        logger.debug("Working memory updated for task %s [key: %s]", task_id, clean_key)
        return {
            "status": "success",
            "action": "set",
            "key": clean_key,
            "content": content.strip(),
            "active_keys": list(state.notes.keys()),
        }

    @classmethod
    def append_note(cls, task_id: str, key: str, content: str, session_id: str | None = None) -> dict[str, Any]:
        """Append text to an existing note entry, or create if non-existent."""
        state = cls.get_or_create(task_id, session_id)
        clean_key = key.strip().lower()
        if clean_key in state.notes:
            existing = state.notes[clean_key].content
            updated = f"{existing}\n- {content.strip()}"
        else:
            updated = f"- {content.strip()}"

        state.notes[clean_key] = ScratchpadEntry(key=clean_key, content=updated)
        state.updated_at = time.time()
        cls.save_to_file(task_id)
        logger.debug("Working memory appended for task %s [key: %s]", task_id, clean_key)
        return {
            "status": "success",
            "action": "append",
            "key": clean_key,
            "content": updated,
            "active_keys": list(state.notes.keys()),
        }

    @classmethod
    def get_notes(cls, task_id: str, key: str | None = None) -> dict[str, Any]:
        """Retrieve a specific note or all working memory notes."""
        state = cls.get_or_create(task_id)
        if key:
            clean_key = key.strip().lower()
            if clean_key in state.notes:
                return {
                    "status": "success",
                    "key": clean_key,
                    "content": state.notes[clean_key].content,
                }
            return {
                "status": "not_found",
                "message": f"Catatan dengan key '{clean_key}' tidak ditemukan di working memory.",
                "available_keys": list(state.notes.keys()),
            }

        return {
            "status": "success",
            "notes": state.to_dict(),
            "total_notes": len(state.notes),
        }

    @classmethod
    def delete_note(cls, task_id: str, key: str) -> bool:
        """Remove a note entry by key."""
        state = cls.get_or_create(task_id)
        clean_key = key.strip().lower()
        if clean_key in state.notes:
            del state.notes[clean_key]
            state.updated_at = time.time()
            cls.save_to_file(task_id)
            return True
        return False

    @classmethod
    def clear(cls, task_id: str) -> None:
        """Clear all notes for a task and remove disk file."""
        if task_id in cls._instances:
            del cls._instances[task_id]

        file_path = SCRATCHPAD_DIR / f"{task_id}.json"
        if file_path.exists():
            try:
                os.remove(file_path)
            except Exception as e:
                logger.warning("Failed to remove scratchpad file: %s", e)

    @classmethod
    def save_to_file(cls, task_id: str) -> str:
        """Persist working memory to external disk file (FR-18)."""
        state = cls._instances.get(task_id)
        if not state:
            return ""

        SCRATCHPAD_DIR.mkdir(parents=True, exist_ok=True)
        file_path = SCRATCHPAD_DIR / f"{task_id}.json"
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "task_id": state.task_id,
                        "session_id": state.session_id,
                        "notes": {k: {"key": v.key, "content": v.content, "updated_at": v.updated_at} for k, v in state.notes.items()},
                        "created_at": state.created_at,
                        "updated_at": state.updated_at,
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
            return str(file_path)
        except Exception as e:
            logger.warning("Could not persist scratchpad file for %s: %s", task_id, e)
            return ""

    @classmethod
    def load_from_file(cls, task_id: str) -> WorkingMemoryState | None:
        """Load working memory from external disk file if exists."""
        file_path = SCRATCHPAD_DIR / f"{task_id}.json"
        if not file_path.exists():
            return None

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            raw_notes = data.get("notes", {})
            notes_dict = {}
            for k, v in raw_notes.items():
                if isinstance(v, dict):
                    notes_dict[k] = ScratchpadEntry(
                        key=v.get("key", k),
                        content=v.get("content", ""),
                        updated_at=v.get("updated_at", time.time()),
                    )
                elif isinstance(v, str):
                    notes_dict[k] = ScratchpadEntry(key=k, content=v)

            return WorkingMemoryState(
                task_id=data.get("task_id", task_id),
                session_id=data.get("session_id"),
                notes=notes_dict,
                created_at=data.get("created_at", time.time()),
                updated_at=data.get("updated_at", time.time()),
            )
        except Exception as e:
            logger.warning("Could not load scratchpad file for %s: %s", task_id, e)
            return None

    @classmethod
    def format_for_prompt(cls, task_id: str) -> str:
        """Format active working notes into structured markdown for agent prompt context."""
        state = cls._instances.get(task_id)
        if not state or not state.notes:
            return ""

        lines = [
            "\n\nCATATAN KERJA AKTIF & RENCANA ANALISIS (WORKING MEMORY / SCRATCHPAD - FR-18):",
            "Berikut adalah coretan rencana, hipotesis, dan catatan sementara yang tersimpan di working memory:",
        ]
        for key, entry in state.notes.items():
            lines.append(f"• **[{key.upper()}]**:\n{entry.content}")

        lines.append(
            "\nPANDUAN SCRATCHPAD: Anda dapat memperbarui atau menambah catatan dengan memanggil tool `scratchpad`."
        )
        return "\n".join(lines)
