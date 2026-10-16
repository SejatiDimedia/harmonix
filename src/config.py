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
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5432)
    db_user: str = Field(default="harnessly_user")
    db_password: str = Field(default="harnessly_pass")
    db_name: str = Field(default="harnessly_db")
    db_schema: str = Field(default="analytics")
    database_url: str = Field(
        default="postgresql+asyncpg://harnessly_user:harnessly_pass@localhost:5432/harnessly_db",
        description="Async SQLAlchemy database connection URL",
    )

    # LLM Provider settings (Zero-cost options)
    llm_provider: Literal["ollama", "gemini", "groq", "mock"] = Field(
        default="mock",
        description="Active LLM provider: 'ollama', 'gemini', 'groq', or 'mock'",
    )

    # Option 1: Ollama (Local & Free)
    ollama_base_url: str = Field(default="http://localhost:11434/v1")
    ollama_model: str = Field(default="qwen2.5-coder:7b")

    # Option 2: Google AI Studio Gemini (Free Tier)
    gemini_api_key: str | None = Field(default=None)
    gemini_model: str = Field(default="gemini-2.0-flash")

    # Option 3: Groq Cloud (Free Tier)
    groq_api_key: str | None = Field(default=None)
    groq_model: str = Field(default="llama-3.3-70b-versatile")

    # Agent Harness Constraints
    agent_max_steps: int = Field(default=10, description="Maximum iterations in agent loop")
    agent_step_timeout_seconds: int = Field(default=30, description="Timeout for a single agent step")
    agent_total_timeout_seconds: int = Field(default=120, description="Maximum duration for entire task")
    agent_max_token_budget: int = Field(default=15000, description="Token budget per task")

    # SQL Guardrail Parameters
    sql_max_row_limit: int = Field(default=100, description="Maximum rows returned by SQL query")
    sql_execution_timeout_seconds: int = Field(default=10, description="PostgreSQL statement timeout in seconds")


settings = Settings()
