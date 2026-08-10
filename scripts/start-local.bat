@echo off
setlocal

REM Carbon local full-Docker startup wrapper.
REM Builds and starts the complete 14-service stack, then waits for healthchecks.

cd /d "%~dp0\.."

echo(
echo ========================================
echo   Carbon Local - Full Docker Start
echo ========================================
echo(

if not exist ".env.local" (
    echo ERROR: .env.local is missing in %CD%
    echo Restore the local environment file before starting Carbon.
    exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker Desktop is not running or is not accessible.
    exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker Compose is not available.
    exit /b 1
)

echo [1/3] Validating Compose configuration...
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon config --quiet
if errorlevel 1 (
    echo ERROR: Carbon Compose configuration is invalid.
    exit /b 1
)

echo [2/3] Building and starting the complete Carbon stack...
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon up -d --build --wait
if errorlevel 1 (
    echo ERROR: Carbon Docker services failed to start.
    echo Run docker compose --env-file .env.local -f docker-compose.local.yml -p carbon logs --tail 100
    exit /b 1
)

echo [3/3] Current service status:
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon ps

echo(
echo Carbon is running in full-Docker mode.
echo Published service addresses are listed above.
echo(

endlocal
exit /b 0
