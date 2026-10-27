"""Configuration management using Pydantic Settings."""

from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Application settings
    app_env: str = Field(default="development", description="Environment: development, test, production")
    app_host: str = Field(default="0.0.0.0", description="Host address for FastAPI server")
    app_port: int = Field(default=8000, description="Port for FastAPI server")
    log_level: str = Field(default="INFO", description="Logging level")

    # Database settings
    db_host: str = Field(default="127.0.0.1")
    db_port: int = Field(default=5433)
    db_user: str = Field(default="harnessly_user")
    db_password: str = Field(default="harnessly_pass")
    db_name: str = Field(default="harnessly_db")
    db_schema: str = Field(default="analytics")
    database_url: str = Field(
        default="postgresql+asyncpg://harnessly_user:harnessly_pass@127.0.0.1:5433/harnessly_db",
        description="Async SQLAlchemy database connection URL",
    )

    # LLM Provider settings (Zero-cost options)
    llm_provider: Literal["ollama", "gemini", "groq", "openrouter", "9router", "mock"] = Field(
        default="mock",
        description="Active LLM provider: 'ollama', 'gemini', 'groq', 'openrouter', '9router', or 'mock'",
    )

    # Option 1: Ollama (Local & Free)
    ollama_base_url: str = Field(default="http://localhost:11434/v1")
    ollama_model: str = Field(default="qwen2.5-coder:7b")

    # Option 2: Google AI Studio Gemini (Free Tier)
    gemini_api_key: str | None = Field(default=None)
    gemini_model: str = Field(default="gemini-2.0-flash")

    # Option 3: Groq Cloud (Free Tier)
    groq_api_key: str | None = Field(default=None)
    groq_model: str = Field(default="openai/gpt-oss-120b")

    # Option 4: OpenRouter (Free Tier Models)
    openrouter_api_key: str | None = Field(default=None)
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1")
    openrouter_model: str = Field(default="nvidia/nemotron-3.5-lightning:free")

    # Option 5: 9Router (Smart Local AI Gateway)
    ninerouter_base_url: str = Field(default="http://localhost:20128/v1")
    ninerouter_api_key: str | None = Field(default="sk-8abbefea34ddc0cc-npg38u-a6649356")
    ninerouter_model: str = Field(default="ag/gemini-3.8-flash")

    # LLM Fallback & Routing settings (FR-28)
    llm_fallback_provider: Literal["ollama", "gemini", "groq", "openrouter", "9router", "mock", "none"] = Field(
        default="none",
        description="Fallback LLM provider if primary fails or hits rate limits",
    )
    llm_enable_fallback: bool = Field(
        default=True,
        description="Whether to automatically route to fallback provider on error/rate-limit",
    )
    llm_max_retries: int = Field(
        default=2,
        description="Number of retries with exponential backoff on primary provider before falling back",
    )
    llm_retry_backoff_base_seconds: float = Field(
        default=0.5,
        description="Base delay in seconds for exponential backoff retry",
    )

    # Agent Harness Constraints
    agent_max_steps: int = Field(default=10, description="Maximum iterations in agent loop")
    agent_step_timeout_seconds: int = Field(default=30, description="Timeout for a single agent step")
    agent_total_timeout_seconds: int = Field(default=120, description="Maximum duration for entire task")
    agent_max_token_budget: int = Field(default=200000, description="Token budget per task")
    agent_terminal_logs: bool = Field(default=True, description="Enable real-time visual execution logs in the terminal")

    # SQL Guardrail Parameters
    sql_max_row_limit: int = Field(default=100, description="Maximum rows returned by SQL query")
    sql_execution_timeout_seconds: int = Field(default=10, description="PostgreSQL statement timeout in seconds")

    # Observability & Tracing (OB-01: Langfuse Cloud Free Tier / Self-hosted / Local Postgres)
    langfuse_public_key: str | None = Field(default=None, description="Langfuse public API key")
    langfuse_secret_key: str | None = Field(default=None, description="Langfuse secret API key")
    langfuse_host: str = Field(default="https://cloud.langfuse.com", description="Langfuse API host URL")

    # Auditor Agent settings (FR-35 Maker-Checker Quality Gate)
    auditor_enabled: bool = Field(default=True, description="Enable Data Auditor agent verification")
    auditor_provider: Literal["ollama", "gemini", "groq", "openrouter", "9router", "mock", "auto"] = Field(
        default="auto",
        description="Auditor provider: 'auto' (chooses diversity), or specific provider",
    )
    auditor_model: str | None = Field(
        default=None,
        description="Model override for auditor (e.g. 'llama-3.3-70b-versatile' or 'deepseek-r1:7b')",
    )
    auditor_max_self_corrections: int = Field(
        default=1,
        description="Max self-correction loops when auditor flags high-severity issues",
    )


settings = Settings()
