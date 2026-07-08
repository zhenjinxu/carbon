@echo off
REM ==========================================================================
REM Carbon Local Development Startup Script
REM ==========================================================================
REM Starts all services in hybrid mode:
REM   - PostgreSQL 18: local, port 56251
REM   - Redis 7: local, port 6379
REM   - Supabase services: Docker (GoTrue, PostgREST, Storage, etc.)
REM   - ERP/MES apps: local pnpm dev servers
REM
REM Usage:
REM   scripts\start-local.bat            (full startup)
REM   scripts\start-local.bat --services (services only, no apps)
REM   scripts\start-local.bat --init     (first-time DB initialization only)
REM ==========================================================================

setlocal enabledelayedexpansion

REM Configurable paths (override via environment variables)
if not defined PG_BIN set "PG_BIN=D:\Program Files\PostgreSQL\18\bin"
if not defined PG_PORT set "PG_PORT=56251"
if not defined REDIS_SERVER set "REDIS_SERVER=D:\Redis\redis-server.exe"

echo(
echo ========================================
echo   Carbon Local Dev - Hybrid Mode
echo ========================================
echo(

REM --- Step 1: Ensure PostgreSQL is running ---
echo [1/6] Starting PostgreSQL 18 on port %PG_PORT%...
net start "postgresql-x64-18" 2>nul
timeout /t 2 /nobreak >nul

REM Verify PostgreSQL
"%PG_BIN%\pg_isready" -h localhost -p %PG_PORT% >nul 2>&1
if errorlevel 1 (
    echo ERROR: PostgreSQL is not responding on port %PG_PORT%
    echo Please check: net start "postgresql-x64-18"
    exit /b 1
)
echo   PostgreSQL is ready.

REM --- Step 2: Ensure Redis is running ---
echo [2/6] Checking Redis on port 6379...
redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo   Starting Redis...
    "%REDIS_SERVER%" --daemonize yes 2>nul
    timeout /t 1 /nobreak >nul
)
redis-cli ping >nul 2>&1
if errorlevel 1 (
    echo ERROR: Redis is not running on port 6379
    echo Please start Redis manually: %REDIS_SERVER%
    exit /b 1
)
echo   Redis is ready.

REM --- Step 3: First-time initialization (if requested) ---
if "%1"=="--init" (
    echo [INIT] Initializing Supabase roles...
    "%PG_BIN%\psql" -U postgres -p %PG_PORT% -f scripts\db\supabase-init-local.sql
    echo(
    echo   Database initialization complete.
    if "%2"=="" (
        echo   Run scripts\start-local.bat to start all services.
    )
    goto :done
)

REM --- Step 4: Start Docker Supabase services ---
echo [3/6] Starting Supabase Docker services...
cd /d "%~dp0\.."
docker compose -f docker-compose.local.yml --env-file .env.local up -d 2>nul
if errorlevel 1 (
    echo ERROR: Failed to start Docker services
    echo Please ensure Docker Desktop is running.
    exit /b 1
)
echo   Docker services starting...

REM --- Step 5: Wait for services ---
echo [4/6] Waiting for services to be ready...
set /a count=0
:wait_loop
timeout /t 2 /nobreak >nul
set /a count+=1
if %count% gtr 30 (
    echo WARNING: Services taking too long to start. Check docker compose logs.
    goto :services_check
)
"%PG_BIN%\psql" -U postgres -p %PG_PORT% -c "SELECT 1" >nul 2>&1
if errorlevel 1 goto :wait_loop
curl -s http://localhost:54321/health >nul 2>&1
if errorlevel 1 goto :wait_loop
echo   All services are ready.

:services_check

REM --- Step 6: Run database migrations ---
echo [5/6] Running database migrations...
if exist "bin\supabase.exe" (
    bin\supabase.exe migration up --include-all --db-url "postgresql://postgres:postgres@localhost:%PG_PORT%/postgres" 2>nul
    if errorlevel 1 (
        echo WARNING: Migration failed. You may need to run it manually.
    ) else (
        echo   Migrations applied.
    )
) else (
    echo   Supabase CLI not found, using psql fallback...
    node scripts\db\migrate-psql.js
    if errorlevel 1 (
        echo WARNING: Migration failed. You may need to run it manually.
    ) else (
        echo   Migrations applied.
    )
)

REM --- Step 7: Start apps (unless --services flag) ---

echo [6/6] Starting ERP and MES apps...
echo(
echo   ERP:  http://localhost:3000
echo   MES:  http://localhost:3001
echo   Studio: http://localhost:56253
echo   API:  http://localhost:54321
echo(
echo   Press Ctrl+C to stop all apps.
echo(

REM Start ERP
start /b pnpm --filter erp exec react-router dev --port 3000 --host 127.0.0.1
timeout /t 2 /nobreak >nul

REM Start MES
start /b pnpm --filter mes exec react-router dev --port 3001 --host 127.0.0.1

REM Wait for apps to exit
:app_wait
timeout /t 5 /nobreak >nul
goto :app_wait

:done
echo(
echo ========================================
echo   Done!
echo ========================================
echo(
echo Useful commands:
echo   docker compose -f docker-compose.local.yml ps        (check services)
echo   docker compose -f docker-compose.local.yml logs      (view logs)
echo   docker compose -f docker-compose.local.yml down      (stop services)
echo(
endlocal
