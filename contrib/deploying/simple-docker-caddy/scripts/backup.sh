#!/usr/bin/env bash
# Back up the Carbon Swarm stack: Postgres + Storage + Inngest state.
#
#   BACKUP_CONFIRMED_QUIESCED=YES ./scripts/backup.sh
#   BACKUP_CONFIRMED_QUIESCED=YES BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# Restore with scripts/restore.sh during a maintenance window.
#
# Run from cron for regular backups, and ship ./backups offsite (S3/Spaces/rclone)
# — a local copy on the same droplet is not a backup. For point-in-time recovery,
# also enable provider volume snapshots of the data volume.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

STACK_NAME="${STACK_NAME:-carbon}"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-./backups}/carbon-${TS}"
WRITER_SERVICES="erp mes gotrue postgrest realtime storage edge-runtime inngest"

log() { printf '\033[0;36m[backup]\033[0m %s\n' "$*"; }
error() { printf '\033[0;31m[backup]\033[0m %s\n' "$*" >&2; exit 1; }

[ "${BACKUP_CONFIRMED_QUIESCED:-}" = "YES" ] \
	|| error "scale all write services to zero, then set BACKUP_CONFIRMED_QUIESCED=YES"
for service in $WRITER_SERVICES; do
	replicas="$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "${STACK_NAME}_${service}" 2>/dev/null || printf '0')"
	[ "$replicas" = "0" ] || error "${STACK_NAME}_${service} still has $replicas replica(s)"
done

mkdir -p "$BACKUP_DIR"

# ── Postgres logical dump (password read from the in-container secret) ────────
PG_CID="$(docker ps -q -f "label=com.docker.swarm.service.name=${STACK_NAME}_postgres" | head -1)"
[ -n "$PG_CID" ] || error "postgres task not running"

log "Dumping database -> db.dump"
docker exec "$PG_CID" sh -c \
	'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump -U postgres -Fc postgres' \
	>"$BACKUP_DIR/db.dump"

docker exec "$PG_CID" psql -U postgres -Atc "SHOW server_version_num" \
	>"$BACKUP_DIR/postgres-version.txt"

# ── Storage objects (Supabase file backend) ──────────────────────────────────
log "Archiving storage volume -> storage.tar.gz"
docker run --rm \
	-v "${STACK_NAME}_storage:/data:ro" \
	-v "$(cd "$BACKUP_DIR" && pwd):/out" \
	alpine:3 sh -c 'tar czf /out/storage.tar.gz -C /data .'

# ── Inngest durable state (SQLite + queue state) ─────────────────────────────
log "Archiving Inngest volume -> inngest.tar.gz"
docker run --rm \
	-v "${STACK_NAME}_inngest:/data:ro" \
	-v "$(cd "$BACKUP_DIR" && pwd):/out" \
	alpine:3 sh -c 'tar czf /out/inngest.tar.gz -C /data .'

(
	cd "$BACKUP_DIR"
	sha256sum db.dump storage.tar.gz inngest.tar.gz postgres-version.txt >SHA256SUMS
)

log "Backup complete: $BACKUP_DIR"
ls -lh "$BACKUP_DIR"
