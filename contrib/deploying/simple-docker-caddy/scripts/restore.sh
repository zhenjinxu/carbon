#!/usr/bin/env bash
# Restore a Carbon backup into a deployed single-node Swarm stack.
#
# All write-capable services must be scaled to zero first. The script refuses to
# run without both that maintenance state and an explicit confirmation:
#
#   RESTORE_CONFIRMED=YES ./scripts/restore.sh /path/to/carbon-YYYYmmdd-HHMMSS
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

STACK_NAME="${STACK_NAME:-carbon}"
BACKUP_DIR="${1:-}"
WRITER_SERVICES="erp mes gotrue postgrest realtime storage edge-runtime inngest"

log() { printf '\033[0;36m[restore]\033[0m %s\n' "$*"; }
error() { printf '\033[0;31m[restore]\033[0m %s\n' "$*" >&2; exit 1; }

[ "${RESTORE_CONFIRMED:-}" = "YES" ] || error "set RESTORE_CONFIRMED=YES to authorize destructive restore"
[ -n "$BACKUP_DIR" ] || error "usage: RESTORE_CONFIRMED=YES $0 <backup-directory>"
BACKUP_DIR="$(cd "$BACKUP_DIR" && pwd)"

for file in db.dump storage.tar.gz inngest.tar.gz postgres-version.txt SHA256SUMS; do
	[ -f "$BACKUP_DIR/$file" ] || error "missing backup file: $file"
done

(
	cd "$BACKUP_DIR"
	sha256sum -c SHA256SUMS
) || error "backup checksum verification failed"

for service in $WRITER_SERVICES; do
	replicas="$(docker service inspect --format '{{.Spec.Mode.Replicated.Replicas}}' "${STACK_NAME}_${service}" 2>/dev/null || printf '0')"
	[ "$replicas" = "0" ] || error "${STACK_NAME}_${service} still has $replicas replica(s); scale all writers to zero"
done

PG_CID="$(docker ps -q -f "label=com.docker.swarm.service.name=${STACK_NAME}_postgres" | head -1)"
[ -n "$PG_CID" ] || error "postgres task not running"

source_version="$(tr -d '[:space:]' <"$BACKUP_DIR/postgres-version.txt")"
target_version="$(docker exec "$PG_CID" psql -U postgres -Atc "SHOW server_version_num" | tr -d '[:space:]')"
source_major=$((source_version / 10000))
target_major=$((target_version / 10000))
[ "$source_major" -le "$target_major" ] || error "source PostgreSQL $source_major is newer than target $target_major"

log "Restoring PostgreSQL"
# The target stack initializes every Supabase role referenced by the archive.
# Keep owners and ACLs: GoTrue and Storage depend on their schema ownership.
docker exec -i "$PG_CID" sh -c \
	'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_restore -U postgres -d postgres --clean --if-exists --exit-on-error --single-transaction' \
	<"$BACKUP_DIR/db.dump"

restore_volume() {
	local volume="$1" archive="$2"
	log "Restoring ${volume} volume"
	docker run --rm \
		-v "${STACK_NAME}_${volume}:/data" \
		-v "$BACKUP_DIR:/backup:ro" \
		alpine:3 sh -c "rm -rf /data/* /data/.[!.]* /data/..?*; tar xzf /backup/${archive} -C /data"
}

restore_volume storage storage.tar.gz
restore_volume inngest inngest.tar.gz

log "Restore complete. Run './deploy.sh deploy', './deploy.sh migrate', then the acceptance checklist."
