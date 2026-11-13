-- ==============================================================================
-- Least-Privilege Role Setup for Harmonix Data Analyst Agent (P1 Security)
-- ==============================================================================
-- Purpose:
-- Enforce database-level defense-in-depth isolation between write operations
-- (BYOD uploads, ingestion, watchdog tracking) and read-only text-to-SQL execution.
--
-- Execution:
-- Run this script as a PostgreSQL superuser (e.g. postgres) against the target DB.
-- ==============================================================================

-- 1. Create dedicated read-only role for AI Text-to-SQL agent queries
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'harmonix_readonly') THEN
        CREATE ROLE harmonix_readonly WITH LOGIN PASSWORD 'CHANGE_THIS_SECURE_PASSWORD_IN_PRODUCTION';
    END IF;
END
$$;

-- 2. Allow connecting to harmonix_db
GRANT CONNECT ON DATABASE harmonix_db TO harmonix_readonly;

-- 3. Allow schema usage on analytics schema
GRANT USAGE ON SCHEMA analytics TO harmonix_readonly;

-- 4. Grant strictly read-only SELECT permissions on all existing tables in analytics schema
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO harmonix_readonly;

-- 5. Automatically grant SELECT on all future tables created by ingestion / migration
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics 
    GRANT SELECT ON TABLES TO harmonix_readonly;

-- 6. Strictly revoke mutation and creation privileges on analytics schema
REVOKE CREATE ON SCHEMA analytics FROM harmonix_readonly;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA analytics FROM harmonix_readonly;

-- 7. Revoke public schema access to prevent touching PostgreSQL default system namespace
REVOKE ALL ON SCHEMA public FROM harmonix_readonly;

-- Verification query:
-- SELECT grantee, privilege_type, table_name 
-- FROM information_schema.role_table_grants 
-- WHERE grantee = 'harmonix_readonly';

