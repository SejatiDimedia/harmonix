"""Database connection and session management using SQLAlchemy AsyncIO."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.config import settings

logger = logging.getLogger(__name__)

import sys
from sqlalchemy.pool import NullPool

use_null_pool = "pytest" in sys.modules or settings.app_env == "test"

# Create global async engine
engine: AsyncEngine = create_async_engine(
    settings.database_url,
    echo=False,
    poolclass=NullPool if use_null_pool else None,
    pool_pre_ping=True,
    **({} if use_null_pool else {"pool_size": 5, "max_overflow": 10}),
)

# Async session factory
async_session_factory = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional async database session."""
    async with async_session_factory() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            logger.error("Database session rolled back due to error: %s", e)
            raise


async def check_db_health() -> bool:
    """Verify that PostgreSQL is reachable and can execute queries."""
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT 1"))
            return result.scalar() == 1
    except Exception as e:
        logger.warning("Database health check failed: %s", e)
        return False
