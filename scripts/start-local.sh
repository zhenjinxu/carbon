#!/usr/bin/env bash
# ==========================================================================
# Carbon Local Development Startup Script (Git Bash / WSL)
# ==========================================================================
# Starts all services in hybrid mode:
#   - PostgreSQL 18: local, port 56251
#   - Redis 7: local, port 6379
#   - Supabase services: Docker (GoTrue, PostgREST, Storage, etc.)
#   - ERP/MES apps: local pnpm dev servers
#
# Usage:
#   scripts/start-local.sh              (full startup)
#   scripts/start-local.sh --services   (services only, no apps)
#   scripts/start-local.sh --init       (first-time DB initialization only)
# ==========================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-/d/Program Files/PostgreSQL/18/bin}"
PG_PORT="${PG_PORT:-56251}"
REDIS_SERVER="${REDIS_SERVER:-/d/Redis/redis-server}"

echo ""
echo "========================================"
echo "  Carbon Local Dev - Hybrid Mode"
echo "========================================"
echo ""

# --- Step 1: Ensure PostgreSQL is running ---
echo "[1/6] Starting PostgreSQL 18 on port ${PG_PORT}..."
net start "postgresql-x64-18" 2>/dev/null || true
sleep 2

if ! "${PG_BIN}/pg_isready" -h localhost -p "${PG_PORT}" >/dev/null 2>&1; then
    echo "ERROR: PostgreSQL is not responding on port ${PG_PORT}"
    echo "Please check: net start postgresql-x64-18"
    exit 1
fi
echo "  PostgreSQL is ready."

# --- Step 2: Ensure Redis is running ---
echo "[2/6] Checking Redis on port 6379..."
if ! redis-cli ping >/dev/null 2>&1; then
    echo "  Starting Redis..."
    "${REDIS_SERVER}" --daemonize yes 2>/dev/null || true
    sleep 1
fi
if ! redis-cli ping >/dev/null 2>&1; then
    echo "ERROR: Redis is not running on port 6379"
    exit 1
fi
echo "  Redis is ready."

# --- Step 3: First-time initialization ---
if [[ "${1:-}" == "--init" ]]; then
    echo "[INIT] Initializing Supabase roles..."
    "${PG_BIN}/psql" -U postgres -p "${PG_PORT}" -f "${REPO_ROOT}/scripts/db/supabase-init-local.sql"
    echo ""
    echo "  Database initialization complete."
    [[ -z "${2:-}" ]] && echo "  Run scripts/start-local.sh to start all services."
    exit 0
fi

# --- Step 4: Start Docker Supabase services ---
echo "[3/6] Starting Supabase Docker services..."
cd "${REPO_ROOT}"
docker compose -f docker-compose.local.yml --env-file .env.local up -d
echo "  Docker services starting..."

# --- Step 5: Wait for services ---
echo "[4/6] Waiting for services to be ready..."
for i in $(seq 1 30); do
    sleep 2
    if "${PG_BIN}/psql" -U postgres -p "${PG_PORT}" -c "SELECT 1" >/dev/null 2>&1 && \
       curl -s http://localhost:54321/health >/dev/null 2>&1; then
        echo "  All services are ready."
        break
    fi
    if [[ $i -eq 30 ]]; then
        echo "WARNING: Services taking too long. Check: docker compose -f docker-compose.local.yml logs"
    fi
done

# --- Step 6: Run database migrations ---
echo "[5/6] Running database migrations..."
if [[ -x "${REPO_ROOT}/bin/supabase.exe" ]]; then
    "${REPO_ROOT}/bin/supabase.exe" migration up --include-all \
        --db-url "postgresql://postgres:postgres@localhost:${PG_PORT}/postgres" 2>/dev/null && \
        echo "  Migrations applied." || \
        echo "WARNING: Migration failed. Run manually if needed."
else
    echo "  Supabase CLI not found, using psql fallback..."
    node "${REPO_ROOT}/scripts/db/migrate-psql.js"
fi

# --- Step 7: Start apps ---
if [[ "${1:-}" == "--services" ]]; then
    echo ""
    echo "  Services started. Apps not started (--services flag)."
    echo ""
    echo "  ERP:    http://localhost:3000"
    echo "  MES:    http://localhost:3001"
    echo "  Studio: http://localhost:56253"
    echo "  API:    http://localhost:54321"
    echo ""
    exit 0
fi

echo "[6/6] Starting ERP and MES apps..."
echo ""
echo "  ERP:    http://localhost:3000"
echo "  MES:    http://localhost:3001"
echo "  Studio: http://localhost:56253"
echo "  API:    http://localhost:54321"
echo ""
echo "  Press Ctrl+C to stop all apps."
echo ""

# Start apps and trap Ctrl+C for cleanup
cleanup() {
    echo ""
    echo "Stopping apps..."
    kill 0 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

pnpm --filter erp exec react-router dev --port 3000 --host 127.0.0.1 &
ERP_PID=$!
sleep 2
pnpm --filter mes exec react-router dev --port 3001 --host 127.0.0.1 &
MES_PID=$!

wait
