#!/usr/bin/env bash
# ==========================================================================
# Carbon Local Development Stop Script (Git Bash / WSL)
# ==========================================================================
# Stops services started by start-local.sh.
#
# Usage:
#   scripts/stop-local.sh              (stop ERP + MES dev servers only)
#   scripts/stop-local.sh --all        (stop everything including Docker/DB)
#   scripts/stop-local.sh --docker     (stop dev servers + Docker services)
# ==========================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "========================================"
echo "  Carbon Local Dev - Stop Services"
echo "========================================"
echo ""

# --- Step 1: Kill dev servers on ports 3000 and 3001 ---
echo "[1/3] Stopping ERP/MES dev servers..."

killed=0

for port in 3000 3001; do
    pids=$(netstat -ano 2>/dev/null | grep "LISTENING" | grep ":${port} " | awk '{print $5}' | sort -u || true)
    for pid in $pids; do
        if [[ -n "$pid" && "$pid" != "0" ]]; then
            echo "  Killing process on port ${port}, PID=${pid}"
            kill "$pid" 2>/dev/null || true
            killed=1
        fi
    done
done

# Also kill orphaned node processes running react-router
for pid in $(pgrep -f "react-router" 2>/dev/null || true); do
    echo "  Killing orphaned react-router, PID=${pid}"
    kill "$pid" 2>/dev/null || true
    killed=1
done

if [[ "$killed" == "0" ]]; then
    echo "  No dev servers were running."
else
    echo "  Dev servers stopped."
fi

# --- Step 2: Stop Docker services if requested ---
if [[ "${1:-}" == "--all" || "${1:-}" == "--docker" ]]; then
    echo "[2/3] Stopping Docker Supabase services..."
    cd "${REPO_ROOT}"
    docker compose -f docker-compose.local.yml down 2>/dev/null && \
        echo "  Docker services stopped." || \
        echo "  WARNING: Failed to stop Docker services."
else
    echo "[2/3] Skipping Docker services. Use --all or --docker to stop."
fi

# --- Step 3: Stop PostgreSQL and Redis if --all ---
if [[ "${1:-}" == "--all" ]]; then
    echo "[3/3] Stopping PostgreSQL and Redis..."

    # Stop PostgreSQL (Windows service)
    net stop "postgresql-x64-18" >/dev/null 2>&1 && \
        echo "  PostgreSQL stopped." || \
        echo "  PostgreSQL was not running."

    # Stop Redis
    redis_pid=$(pgrep -f "redis-server" 2>/dev/null || true)
    if [[ -n "$redis_pid" ]]; then
        echo "  Stopping Redis, PID=${redis_pid}"
        kill "$redis_pid" 2>/dev/null || true
    fi
    echo "  Redis stopped."
else
    echo "[3/3] Skipping PostgreSQL and Redis. Use --all to stop."
fi

echo ""
echo "========================================"
echo "  All requested services stopped!"
echo "========================================"
echo ""
echo "To start again:  scripts/start-local.sh"
echo ""
