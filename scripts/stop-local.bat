@echo off
setlocal

REM Carbon local full-Docker stop wrapper.
REM Stops the complete stack while preserving containers and all named volumes.

cd /d "%~dp0\.."

echo(
echo ========================================
echo   Carbon Local - Full Docker Stop
echo ========================================
echo(

if not exist ".env.local" (
    echo ERROR: .env.local is missing in %CD%
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

echo [2/3] Stopping Carbon services and preserving all data volumes...
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon stop
if errorlevel 1 (
    echo ERROR: Carbon Docker services failed to stop cleanly.
    exit /b 1
)

echo [3/3] Current service status:
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon ps

echo(
echo Carbon services are stopped. Containers and data volumes are preserved.
echo To start again, run scripts\start-local.bat
echo(

endlocal
exit /b 0
