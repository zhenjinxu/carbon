@echo off
REM ==========================================================================
REM Carbon Local Development Stop Script
REM ==========================================================================
REM Stops services started by start-local.bat.
REM
REM Usage:
REM   scripts\stop-local.bat              (stop ERP + MES dev servers only)
REM   scripts\stop-local.bat --all        (stop everything including Docker/DB)
REM   scripts\stop-local.bat --docker     (stop dev servers + Docker services)
REM ==========================================================================

setlocal enabledelayedexpansion

echo.
echo ========================================
echo   Carbon Local Dev - Stop Services
echo ========================================
echo.

set "TEMPFILE=%TEMP%\carbon_stop_%RANDOM%.tmp"

REM --- Step 1: Kill dev servers on ports 3000 and 3001 ---
echo [1/3] Stopping ERP/MES dev servers...

set "killed=0"

REM Find PIDs listening on 3000 and 3001
netstat -ano | findstr "LISTENING" | findstr /R ":300[01] " > "%TEMPFILE%" 2>nul

for /f "tokens=5" %%p in ('type "%TEMPFILE%"') do (
    echo   Killing process on port 3000/3001, PID=%%p
    taskkill /PID %%p /F >nul 2>&1
    set "killed=1"
)

del "%TEMPFILE%" 2>nul

REM Also kill orphaned node processes running react-router
for /f "tokens=2" %%p in ('tasklist /fi "imagename eq node.exe" /fo list 2^>nul ^| findstr "PID:"') do (
    wmic process where "ProcessId=%%p" get CommandLine 2>nul | findstr /i "react-router" >nul 2>&1
    if not errorlevel 1 (
        echo   Killing orphaned react-router, PID=%%p
        taskkill /PID %%p /F >nul 2>&1
        set "killed=1"
    )
)

if "!killed!"=="0" echo   No dev servers were running.
if "!killed!"=="1" echo   Dev servers stopped.

REM --- Step 2: Stop Docker services if requested ---
if "%1"=="--all" goto :stop_docker
if "%1"=="--docker" goto :stop_docker
echo [2/3] Skipping Docker services. Use --all or --docker to stop.
goto :check_db

:stop_docker
echo [2/3] Stopping Docker Supabase services...
cd /d "%~dp0\.."
docker compose -f docker-compose.local.yml down 2>nul
if errorlevel 1 (
    echo   WARNING: Failed to stop Docker services.
) else (
    echo   Docker services stopped.
)
goto :check_db

:check_db
if "%1"=="--all" goto :stop_db
echo [3/3] Skipping PostgreSQL and Redis. Use --all to stop.
goto :done

:stop_db
echo [3/3] Stopping PostgreSQL and Redis...

net stop "postgresql-x64-18" >nul 2>&1
if errorlevel 1 (
    echo   PostgreSQL was not running.
) else (
    echo   PostgreSQL stopped.
)

for /f "tokens=2" %%p in ('tasklist /fi "imagename eq redis-server.exe" /fo list 2^>nul ^| findstr "PID:"') do (
    echo   Stopping Redis, PID=%%p
    taskkill /PID %%p /F >nul 2>&1
)
echo   Redis stopped.

:done
echo.
echo ========================================
echo   All requested services stopped!
echo ========================================
echo.
echo To start again:  scripts\start-local.bat
echo.

endlocal
