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
    cors_allowed_origins: list[str] = Field(
        default=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        description="Allowed origins for CORS (no wildcard permitted when credentials enabled)",
    )
    api_auth_key: str | None = Field(
        default=None,
        description="Optional API key for endpoint security (X-API-Key or Bearer token)",
    )
    admin_api_key: str | None = Field(
        default=None,
        description="Optional Admin API key for sensitive/configuration write endpoints",
    )

    # Database settings
    db_host: str = Field(default="127.0.0.1")
    db_port: int = Field(default=5433)
    db_user: str = Field(default="harmonix_user")
    db_password: str = Field(default="harmonix_pass")
    db_name: str = Field(default="harmonix_db")
    db_schema: str = Field(default="analytics")
    database_url: str = Field(
        default="postgresql+asyncpg://harmonix_user:harmonix_pass@127.0.0.1:5433/harmonix_db",
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
    gemini_model: str = Field(default="gemini-3.8-flash")

    # Option 3: Groq Cloud (Free Tier)
    groq_api_key: str | None = Field(default=None)
    groq_model: str = Field(default="openai/gpt-oss-120b")

    # Option 4: OpenRouter (Free Tier Models)
    openrouter_api_key: str | None = Field(default=None)
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1")
    openrouter_model: str = Field(default="nvidia/nemotron-3.5-lightning:free")

    # Option 5: 9Router (Smart Local AI Gateway)
    ninerouter_base_url: str = Field(default="http://localhost:20128/v1")
    ninerouter_api_key: str | None = Field(default=None)
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
    agent_max_steps: int = Field(default=12, description="Maximum iterations in agent loop")
    agent_step_timeout_seconds: int = Field(default=30, description="Timeout for a single agent step")
    agent_total_timeout_seconds: int = Field(default=120, description="Maximum duration for entire task")
    agent_max_token_budget: int = Field(default=200000, description="Token budget per task")
    agent_terminal_logs: bool = Field(default=True, description="Enable real-time visual execution logs in the terminal")
    # Prompt Caching settings (FR-15)
    enable_prompt_caching: bool = Field(
        default=True,
        description="Enable prompt caching headers and deterministic prefix ordering for LLM requests (FR-15)",
    )

    # Sandbox settings (FR-26 Air-gapped Docker execution for Python calculations)
    sandbox_docker_enabled: bool = Field(
        default=True,
        description="Enable air-gapped Docker sandbox container if Docker daemon is running (FR-26)",
    )
    sandbox_docker_image: str = Field(
        default="python:3.13-slim",
        description="Docker image used for isolated air-gapped execution",
    )
    sandbox_memory_limit: str = Field(
        default="128m",
        description="Memory limit for container execution",
    )
    sandbox_cpu_limit: str = Field(
        default="0.5",
        description="CPU limit for container execution",
    )

    # RAG Reranker settings (FR-12)
    rag_enable_reranker: bool = Field(
        default=True,
        description="Enable Cross-Encoder reranking for RAG glossary search (FR-12)",
    )
    rag_reranker_model: str = Field(
        default="ms-marco-TinyBERT-L-2-v2",
        description="FlashRank model name for local cross-encoder reranking",
    )

    # SQL Guardrail Parameters
    sql_max_row_limit: int = Field(default=100, description="Maximum rows returned by SQL query")
    sql_execution_timeout_seconds: int = Field(default=10, description="PostgreSQL statement timeout in seconds")

    # Observability & Tracing (OB-01: Langfuse Cloud Free Tier / Self-hosted / Local Postgres)
    langfuse_public_key: str | None = Field(default=None, description="Langfuse public API key")
    langfuse_secret_key: str | None = Field(default=None, description="Langfuse secret API key")
    langfuse_host: str = Field(default="https://cloud.langfuse.com", description="Langfuse API host URL")

    # Distributed Task Queue & Worker settings (FR-43, Pilar 6.3)
    queue_backend: Literal["postgres", "redis", "memory"] = Field(
        default="postgres",
        description="Task queue backend: 'postgres' (FOR UPDATE SKIP LOCKED), 'redis', or 'memory'",
    )
    queue_redis_url: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL when queue_backend is 'redis'",
    )
    queue_worker_concurrency: int = Field(
        default=4,
        description="Maximum concurrent jobs per background worker instance",
    )
    queue_worker_poll_interval_seconds: float = Field(
        default=0.5,
        description="Polling interval in seconds for worker job acquisition",
    )
    queue_max_retries: int = Field(
        default=3,
        description="Maximum automatic retries before moving job to Dead-Letter Queue (DLQ)",
    )
    queue_retry_backoff_base_seconds: float = Field(
        default=2.0,
        description="Base delay in seconds for exponential backoff retry calculation",
    )
    queue_job_timeout_seconds: int = Field(
        default=180,
        description="Maximum execution timeout in seconds for a single queued job",
    )

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
