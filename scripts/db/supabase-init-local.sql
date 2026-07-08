-- Supabase Local PostgreSQL Initialization Script
-- Run: psql -U postgres -p 56251 -f scripts/supabase-init-local.sql

-- Create Supabase roles
DO $$
BEGIN
  -- anon
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  -- authenticated
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  -- service_role
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  -- authenticator
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN PASSWORD 'postgres' NOINHERIT;
  ELSE
    ALTER USER authenticator PASSWORD 'postgres';
  END IF;
  GRANT anon, authenticated, service_role TO authenticator;
  -- supabase_admin
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin LOGIN PASSWORD 'postgres' SUPERUSER;
  ELSE
    ALTER USER supabase_admin PASSWORD 'postgres';
  END IF;
  -- supabase_auth_admin
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN PASSWORD 'postgres' NOINHERIT CREATEROLE;
  ELSE
    ALTER USER supabase_auth_admin PASSWORD 'postgres';
  END IF;
  -- supabase_storage_admin
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin LOGIN PASSWORD 'postgres' NOINHERIT CREATEROLE;
  ELSE
    ALTER USER supabase_storage_admin PASSWORD 'postgres';
  END IF;
  -- supabase_functions_admin
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
    CREATE ROLE supabase_functions_admin LOGIN PASSWORD 'postgres' NOINHERIT CREATEROLE;
  ELSE
    ALTER USER supabase_functions_admin PASSWORD 'postgres';
  END IF;
  -- Set postgres password
  ALTER USER postgres PASSWORD 'postgres';
END
$$;

-- Create required schemas
CREATE SCHEMA IF NOT EXISTS _realtime AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS supabase_migrations AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS vault AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgjwt;

-- Grant permissions (PostgreSQL 15+ requires explicit grants)
GRANT ALL ON SCHEMA public TO supabase_auth_admin, supabase_storage_admin, supabase_admin,
  supabase_functions_admin, authenticator, anon, authenticated, service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin, postgres;
GRANT CREATE ON DATABASE postgres TO supabase_auth_admin, supabase_storage_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO supabase_auth_admin, supabase_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin, supabase_admin;
