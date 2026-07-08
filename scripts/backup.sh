#!/usr/bin/env bash
# ============================================================
# Carbon 生产环境备份脚本
# ============================================================
# 用法:
#   scripts/backup.sh                    # 完整备份 (DB + Storage)
#   scripts/backup.sh --db-only          # 仅数据库
#   scripts/backup.sh --storage-only     # 仅文件存储
#   scripts/backup.sh --compress         # 使用 gzip 压缩
#
# 建议 crontab:
#   0 2 * * * /path/to/scripts/backup.sh --compress >> /var/log/carbon-backup.log 2>&1
# ============================================================
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/carbon}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
COMPRESS=false
DB_ONLY=false
STORAGE_ONLY=false

for arg in "$@"; do
  case $arg in
    --compress) COMPRESS=true ;;
    --db-only) DB_ONLY=true ;;
    --storage-only) STORAGE_ONLY=true ;;
  esac
done

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# ============================================================
# PostgreSQL 备份
# ============================================================
backup_db() {
  echo "  Backing up PostgreSQL..."
  local dump_file="$BACKUP_DIR/db_${TIMESTAMP}.sql"

  docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dumpall -U postgres --clean --if-exists > "$dump_file"

  if [ "$COMPRESS" = true ]; then
    gzip "$dump_file"
    echo "  ✓ Database backup: ${dump_file}.gz ($(du -h "${dump_file}.gz" | cut -f1))"
  else
    echo "  ✓ Database backup: $dump_file ($(du -h "$dump_file" | cut -f1))"
  fi
}

# ============================================================
# Storage 文件备份
# ============================================================
backup_storage() {
  echo "  Backing up Storage files..."
  local storage_dir="$BACKUP_DIR/storage_${TIMESTAMP}"

  # 从 Docker volume 导出
  docker run --rm \
    -v "$(docker volume inspect --format '{{.Mountpoint}' "$(docker compose -f "$COMPOSE_FILE" ps -q storage | head -1 | xargs -I{} docker inspect --format '{{range .Mounts}}{{if eq .Destination \"/var/lib/storage\"}}{{.Name}}{{end}}{{end}}' {})" 2>/dev/null || echo "carbon_storage")":/source:ro \
    -v "$storage_dir":/backup \
    alpine tar czf /backup/storage.tar.gz -C /source .

  echo "  ✓ Storage backup: $storage_dir/storage.tar.gz ($(du -h "$storage_dir/storage.tar.gz" | cut -f1))"
}

# ============================================================
# 执行备份
# ============================================================
if [ "$STORAGE_ONLY" = false ]; then
  backup_db
fi

if [ "$DB_ONLY" = false ]; then
  backup_storage
fi

# ============================================================
# 清理旧备份
# ============================================================
echo "  Cleaning up backups older than ${RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name "db_*.sql*" -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "storage_*" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true

echo "[$(date)] Backup complete. Files in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR" | tail -10
echo ""
echo "Total size: $(du -sh "$BACKUP_DIR" | cut -f1)"
