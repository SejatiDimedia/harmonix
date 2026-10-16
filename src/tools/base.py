"""Base abstraction for agent tools."""

from abc import ABC, abstractmethod
from typing import Any, Type
from pydantic import BaseModel


class BaseTool(ABC):
    """Abstract base class for all agent tools."""

    name: str
    description: str
    args_schema: Type[BaseModel]

    @abstractmethod
    async def execute(self, **kwargs: Any) -> Any:
        """Execute the tool with validated arguments."""
        pass

    def to_openai_schema(self) -> dict[str, Any]:
        """Convert the tool definition to standard OpenAI-compatible tool schema

        used by Ollama, Gemini, and Groq.
        """
        json_schema = self.args_schema.model_json_schema()
        # Clean up json schema fields not needed by tool calling
        properties = json_schema.get("properties", {})
        required = json_schema.get("required", [])

        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        }
