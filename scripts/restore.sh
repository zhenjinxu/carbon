#!/usr/bin/env bash
# ============================================================
# Carbon 生产环境恢复脚本
# ============================================================
# 用法:
#   scripts/restore.sh --db <backup-file>           # 恢复数据库
#   scripts/restore.sh --storage <backup-file>      # 恢复文件存储
#   scripts/restore.sh --all <backup-dir>           # 恢复全部
#
# 警告: 恢复操作会覆盖现有数据!
# ============================================================
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

usage() {
  echo "用法:"
  echo "  $0 --db <backup-file>        恢复数据库"
  echo "  $0 --storage <backup-file>   恢复文件存储"
  echo "  $0 --all <backup-dir>        恢复全部"
  exit 1
}

[ $# -eq 0 ] && usage

# ============================================================
# 恢复 PostgreSQL
# ============================================================
restore_db() {
  local dump_file="$1"

  if [ ! -f "$dump_file" ]; then
    echo "❌ 文件不存在: $dump_file"
    exit 1
  fi

  echo "⚠️  警告: 即将恢复数据库，这将覆盖所有现有数据!"
  echo "   备份文件: $dump_file"
  read -p "   确认继续? (yes/no): " confirm
  [ "$confirm" != "yes" ] && { echo "已取消"; exit 0; }

  echo "  停止应用服务..."
  docker compose -f "$COMPOSE_FILE" stop erp mes

  echo "  恢复数据库..."
  if [[ "$dump_file" == *.gz ]]; then
    gunzip -c "$dump_file" | docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres
  else
    docker compose -f "$COMPOSE_FILE" exec -T postgres psql -U postgres < "$dump_file"
  fi

  echo "  重启服务..."
  docker compose -f "$COMPOSE_FILE" start erp mes

  echo "✓ 数据库恢复完成"
}

# ============================================================
# 恢复 Storage 文件
# ============================================================
restore_storage() {
  local storage_file="$1"

  if [ ! -f "$storage_file" ]; then
    echo "❌ 文件不存在: $storage_file"
    exit 1
  fi

  echo "⚠️  警告: 即将恢复文件存储，这将覆盖所有现有文件!"
  echo "   备份文件: $storage_file"
  read -p "   确认继续? (yes/no): " confirm
  [ "$confirm" != "yes" ] && { echo "已取消"; exit 0; }

  echo "  清空现有存储..."
  docker compose -f "$COMPOSE_FILE" exec storage rm -rf /var/lib/storage/*

  echo "  恢复文件..."
  docker compose -f "$COMPOSE_FILE" exec storage tar xzf - -C /var/lib/storage < "$storage_file"

  echo "  重启 Storage 服务..."
  docker compose -f "$COMPOSE_FILE" restart storage

  echo "✓ 文件存储恢复完成"
}

# ============================================================
# 解析参数
# ============================================================
while [[ $# -gt 0 ]]; do
  case $1 in
    --db)
      restore_db "$2"
      shift 2
      ;;
    --storage)
      restore_storage "$2"
      shift 2
      ;;
    --all)
      local backup_dir="$2"
      [ ! -d "$backup_dir" ] && { echo "❌ 目录不存在: $backup_dir"; exit 1; }

      # 找到最新的备份文件
      local latest_db=$(ls -t "$backup_dir"/db_*.sql* 2>/dev/null | head -1)
      local latest_storage=$(ls -t "$backup_dir"/storage_*/storage.tar.gz 2>/dev/null | head -1)

      [ -n "$latest_db" ] && restore_db "$latest_db"
      [ -n "$latest_storage" ] && restore_storage "$latest_storage"

      shift 2
      ;;
    *)
      usage
      ;;
  esac
done
