"""API Key Management: runtime hot-reload and .env file persistence (FR-36).

Allows users to configure and manage LLM API keys directly from the UI or via .env.
Masks keys in responses to prevent leaking credentials in the frontend.
"""

import logging
import os
from pathlib import Path
import re
from typing import Any
from pydantic import BaseModel, Field

from src.config import settings

logger = logging.getLogger("harnessly.keys_manager")
ENV_FILE_PATH = Path(".env")


class APIKeyInfo(BaseModel):
    provider: str
    display_name: str
    is_set: bool
    masked_key: str | None
    env_var: str
    docs_url: str


class UpdateAPIKeysInput(BaseModel):
    groq_api_key: str | None = Field(default=None, description="Groq Cloud API Key (starts with gsk_)")
    gemini_api_key: str | None = Field(default=None, description="Google AI Studio Gemini API Key")
    openrouter_api_key: str | None = Field(default=None, description="OpenRouter API Key (starts with sk-or-)")


def mask_key(key: str | None) -> str | None:
    """Mask sensitive API key showing only prefix and suffix."""
    if not key or len(key.strip()) < 6:
        return None
    k = key.strip()
    if len(k) <= 12:
        return k[:2] + "••••••••" + k[-2:]
    return k[:4] + "••••••••" + k[-4:]


def get_all_masked_keys() -> dict[str, Any]:
    """Retrieve status and masked values for all supported cloud API keys."""
    return {
        "groq": APIKeyInfo(
            provider="groq",
            display_name="Groq Cloud (LPU Ultra-Fast)",
            is_set=bool(settings.groq_api_key and len(settings.groq_api_key.strip()) > 5),
            masked_key=mask_key(settings.groq_api_key),
            env_var="GROQ_API_KEY",
            docs_url="https://console.groq.com/keys",
        ).model_dump(),
        "gemini": APIKeyInfo(
            provider="gemini",
            display_name="Google AI Studio (Gemini)",
            is_set=bool(settings.gemini_api_key and len(settings.gemini_api_key.strip()) > 5),
            masked_key=mask_key(settings.gemini_api_key),
            env_var="GEMINI_API_KEY",
            docs_url="https://aistudio.google.com/apikey",
        ).model_dump(),
        "openrouter": APIKeyInfo(
            provider="openrouter",
            display_name="OpenRouter (AI Gateway)",
            is_set=bool(settings.openrouter_api_key and len(settings.openrouter_api_key.strip()) > 5),
            masked_key=mask_key(settings.openrouter_api_key),
            env_var="OPENROUTER_API_KEY",
            docs_url="https://openrouter.ai/keys",
        ).model_dump(),
    }


def save_keys_to_env(updates: dict[str, str | None]) -> None:
    """Update environment variables in-memory and write cleanly to .env file."""
    # 1. Update in-memory settings and os.environ
    for key_name, value in updates.items():
        if value is None:
            continue
        clean_val = value.strip()
        if key_name == "GROQ_API_KEY":
            settings.groq_api_key = clean_val or None
            os.environ["GROQ_API_KEY"] = clean_val
        elif key_name == "GEMINI_API_KEY":
            settings.gemini_api_key = clean_val or None
            os.environ["GEMINI_API_KEY"] = clean_val
        elif key_name == "OPENROUTER_API_KEY":
            settings.openrouter_api_key = clean_val or None
            os.environ["OPENROUTER_API_KEY"] = clean_val

    # 2. Persist to .env file
    lines = []
    if ENV_FILE_PATH.exists():
        try:
            lines = ENV_FILE_PATH.read_text(encoding="utf-8").splitlines()
        except Exception:
            lines = []

    written_keys = set()
    new_lines = []

    for line in lines:
        matched_key = None
        for k in updates.keys():
            if re.match(rf"^\s*{re.escape(k)}\s*=", line):
                matched_key = k
                break
        if matched_key:
            val = updates[matched_key]
            if val is not None:
                new_lines.append(f"{matched_key}={val.strip()}")
                written_keys.add(matched_key)
            else:
                new_lines.append(line)
                written_keys.add(matched_key)
        else:
            new_lines.append(line)

    # Append any keys that weren't already in .env
    for k, val in updates.items():
        if k not in written_keys and val is not None:
            new_lines.append(f"{k}={val.strip()}")

    try:
        ENV_FILE_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        logger.info(f"Successfully synchronized {len(updates)} keys to {ENV_FILE_PATH}")
    except Exception as e:
        logger.warning(f"Could not persist keys to .env: {e}")
