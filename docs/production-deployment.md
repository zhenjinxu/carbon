# Carbon 生产环境 Docker 部署指南

## 概述

本指南说明如何将 Carbon 系统部署到生产环境，使用全容器化架构。

**架构特点：**
- ✅ 全部服务容器化（PostgreSQL、Redis、Supabase 全家桶、ERP、MES）
- ✅ 单一入口（Caddy 反向代理），自动 HTTPS
- ✅ 数据持久化（Docker volumes）
- ✅ 健康检查和自动重启
- ✅ 内部网络隔离（数据服务不暴露到公网）

## 前置要求

### 服务器配置
- **CPU**: 4+ 核心
- **内存**: 8+ GB（推荐 16 GB）
- **磁盘**: 50+ GB SSD
- **操作系统**: Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)

### 软件要求
```bash
# Docker 20.10+
curl -fsSL https://get.docker.com | sh

# Docker Compose v2.0+
docker compose version

# 验证
docker --version
docker compose version
```

### 域名规划
需要准备以下域名（示例）：
- `erp.yourcompany.com` — ERP 应用
- `mes.yourcompany.com` — MES 应用
- `api.yourcompany.com` — Supabase API

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/your-org/carbon.git
cd carbon
```

### 2. 配置环境变量

```bash
# 复制示例配置
cp .env.production.example .env.production

# 编辑配置
nano .env.production
```

**必须修改的配置项：**

```bash
# 域名
DOMAIN=erp.yourcompany.com
ERP_URL=https://erp.yourcompany.com
MES_URL=https://mes.yourcompany.com
SUPABASE_URL=https://api.yourcompany.com

# 数据库密码（生成随机密码）
POSTGRES_PASSWORD=$(openssl rand -base64 32)

# Redis 密码
REDIS_PASSWORD=$(openssl rand -base64 32)

# JWT 密钥（至少 32 字符）
SUPABASE_JWT_SECRET=$(openssl rand -base64 48)

# Session 密钥
SESSION_SECRET=$(openssl rand -hex 32)

# SMTP 邮件（生产环境必须配置）
SMTP_HOST=smtp.resend.com
SMTP_USER=your_smtp_user
SMTP_PASS=your_smtp_password
SMTP_ADMIN_EMAIL=admin@yourcompany.com
```

### 3. 生成 Supabase 密钥

```bash
# 安装 JWT 工具
npm install -g jsonwebtoken

# 生成 Anon Key
node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.SUPABASE_JWT_SECRET;
const token = jwt.sign(
  { iss: 'supabase', role: 'anon', exp: Math.floor(Date.now()/1000) + 315360000 },
  secret
);
console.log(token);
"

# 生成 Service Role Key
node -e "
const jwt = require('jsonwebtoken');
const secret = process.env.SUPABASE_JWT_SECRET;
const token = jwt.sign(
  { iss: 'supabase', role: 'service_role', exp: Math.floor(Date.now()/1000) + 315360000 },
  secret
);
console.log(token);
"
```

将生成的密钥填入 `.env.production`：
```bash
SUPABASE_ANON_KEY=<生成的 anon key>
SUPABASE_SERVICE_ROLE_KEY=<生成的 service role key>
```

### 4. 启动服务

```bash
# 构建并启动所有服务
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# 查看状态
docker compose -f docker-compose.prod.yml ps

# 查看日志
docker compose -f docker-compose.prod.yml logs -f
```

### 5. 初始化数据库

```bash
# 等待 PostgreSQL 就绪
sleep 10

# 运行迁移
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d postgres \
  < packages/database/supabase/migrations/*.sql

# 或者使用迁移脚本（推荐）
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d postgres \
  < scripts/db/supabase-init-local.sql
```

### 6. 创建管理员用户

```bash
# 进入 GoTrue 容器
docker compose -f docker-compose.prod.yml exec gotrue sh

# 创建用户（在容器内执行）
curl -X POST http://localhost:9999/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourcompany.com",
    "password": "your_strong_password",
    "data": { "name": "Admin" }
  }'
```

### 7. 验证部署

```bash
# 检查所有服务状态
docker compose -f docker-compose.prod.yml ps

# 应该看到所有服务都是 "Up" 或 "healthy"

# 测试访问
curl -I https://erp.yourcompany.com
curl -I https://mes.yourcompany.com
curl -I https://api.yourcompany.com/health
```

## 日常运维

### 查看日志

```bash
# 查看所有服务日志
docker compose -f docker-compose.prod.yml logs -f

# 查看特定服务
docker compose -f docker-compose.prod.yml logs -f erp
docker compose -f docker-compose.prod.yml logs -f postgres
```

### 重启服务

```bash
# 重启单个服务
docker compose -f docker-compose.prod.yml restart erp

# 重启所有服务
docker compose -f docker-compose.prod.yml restart

# 停止所有服务
docker compose -f docker-compose.prod.yml down

# 停止并删除数据卷（危险！）
docker compose -f docker-compose.prod.yml down -v
```

### 更新部署

```bash
# 拉取最新代码
git pull origin main

# 重新构建镜像
docker compose -f docker-compose.prod.yml build

# 滚动更新（零停机）
docker compose -f docker-compose.prod.yml up -d --no-deps --build erp mes

# 更新基础设施（会短暂停机）
docker compose -f docker-compose.prod.yml up -d
```

### 备份

```bash
# 手动备份
./scripts/backup.sh

# 压缩备份
./scripts/backup.sh --compress

# 仅备份数据库
./scripts/backup.sh --db-only

# 设置定时任务（每天凌晨 2 点）
crontab -e
# 添加: 0 2 * * * /path/to/carbon/scripts/backup.sh --compress >> /var/log/carbon-backup.log 2>&1
```

### 恢复

```bash
# 恢复数据库
./scripts/restore.sh --db /var/backups/carbon/db_20240101_020000.sql.gz

# 恢复文件存储
./scripts/restore.sh --storage /var/backups/carbon/storage_20240101_020000/storage.tar.gz

# 恢复全部（最新备份）
./scripts/restore.sh --all /var/backups/carbon
```

## 监控与告警

### 健康检查端点

```bash
# ERP 健康检查
curl https://erp.yourcompany.com/api/health

# MES 健康检查
curl https://mes.yourcompany.com/api/health

# PostgreSQL
docker compose -f docker-compose.prod.yml exec postgres pg_isready

# Redis
docker compose -f docker-compose.prod.yml exec redis redis-cli ping
```

### 资源监控

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
docker system df

# 清理未使用的资源
docker system prune -a
```

## 故障排查

### 服务无法启动

```bash
# 查看详细日志
docker compose -f docker-compose.prod.yml logs postgres
docker compose -f docker-compose.prod.yml logs erp

# 检查端口冲突
netstat -tlnp | grep -E ':(80|443|5432|6379)'

# 检查磁盘空间
df -h
```

### 数据库连接失败

```bash
# 测试数据库连接
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "SELECT 1"

# 检查数据库用户
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -c "\du"

# 重新初始化数据库（危险！会丢失数据）
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d
```

### 文件上传失败

```bash
# 检查 Storage 服务
docker compose -f docker-compose.prod.yml logs storage

# 检查存储卷
docker volume inspect carbon_storage

# 检查权限
docker compose -f docker-compose.prod.yml exec storage ls -la /var/lib/storage
```

## 安全加固

### 1. 防火墙配置

```bash
# 仅开放必要端口
ufw allow 80/tcp    # HTTP (Caddy 自动重定向到 HTTPS)
ufw allow 443/tcp   # HTTPS
ufw allow 22/tcp    # SSH
ufw enable

# 不要开放数据库端口
# ufw deny 5432
# ufw deny 6379
```

### 2. 定期更新

```bash
# 更新系统
apt update && apt upgrade -y

# 更新 Docker
apt install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 更新 Carbon
cd /path/to/carbon
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### 3. 备份验证

```bash
# 定期测试恢复流程
./scripts/backup.sh --compress
./scripts/restore.sh --all /var/backups/carbon

# 验证数据完整性
docker compose -f docker-compose.prod.yml exec postgres psql -U postgres -d postgres -c "SELECT COUNT(*) FROM company"
```

## 性能优化

### 1. PostgreSQL 调优

编辑 `docker-compose.prod.yml`，添加 PostgreSQL 参数：

```yaml
postgres:
  command:
    - postgres
    - -c
    - max_connections=200
    - -c
    - shared_buffers=2GB
    - -c
    - effective_cache_size=6GB
    - -c
    - work_mem=16MB
```

### 2. Redis 调优

```yaml
redis:
  command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 2gb --maxmemory-policy allkeys-lru
```

### 3. 应用调优

```yaml
erp:
  environment:
    NODE_OPTIONS: --max-old-space-size=4096
```

## 扩展方案

### 水平扩展（多实例）

```bash
# 启动多个 ERP 实例
docker compose -f docker-compose.prod.yml up -d --scale erp=3

# Caddy 会自动负载均衡
```

### 高可用部署

对于生产环境的高可用需求，建议：
1. 使用 PostgreSQL 主从复制
2. 使用 Redis Sentinel
3. 使用负载均衡器（HAProxy/Nginx）
4. 部署在多个可用区

## 常见问题

### Q: 如何查看 Supabase Studio？

A: Studio 默认不对外暴露。如需访问：
```bash
# 临时暴露到本地
docker compose -f docker-compose.prod.yml up -d studio

# 通过 SSH 隧道访问
ssh -L 3000:localhost:3000 user@server
# 然后访问 http://localhost:3000
```

### Q: 如何迁移现有数据？

A: 参考 `docs/migration-guide.md`（待创建）

### Q: 如何配置自定义域名？

A: 修改 `.env.production` 中的 `DOMAIN`、`ERP_URL`、`MES_URL`、`SUPABASE_URL`，然后重启 Caddy：
```bash
docker compose -f docker-compose.prod.yml restart caddy
```

### Q: 如何禁用某些功能？

A: 通过环境变量控制：
```bash
# 禁用 Google OAuth
GOTRUE_EXTERNAL_GOOGLE_ENABLED=false

# 禁用 Stripe
# 不设置 STRIPE_SECRET_KEY
```

## 技术支持

- **文档**: `docs/` 目录
- **问题反馈**: GitHub Issues
- **社区**: Discord/Slack（如有）

## 附录

### 服务端口映射

| 服务 | 内部端口 | 外部端口 | 说明 |
|------|---------|---------|------|
| Caddy | 80, 443 | 80, 443 | HTTP/HTTPS |
| ERP | 3000 | - | 内部 |
| MES | 3000 | - | 内部 |
| PostgreSQL | 5432 | - | 内部（可配置暴露） |
| Redis | 6379 | - | 内部（可配置暴露） |
| Kong | 8000 | - | 内部 |
| GoTrue | 9999 | - | 内部 |
| PostgREST | 3000 | - | 内部 |
| Storage | 5000 | - | 内部 |
| Studio | 3000 | - | 内部（可配置暴露） |

### 数据卷

| 卷名 | 用途 | 备份策略 |
|------|------|---------|
| `pgdata` | PostgreSQL 数据 | 每日 pg_dump |
| `redisdata` | Redis 数据 | 可选（缓存可重建） |
| `storage` | 文件存储 | 每日 tar 备份 |
| `caddy_data` | SSL 证书 | 自动续期 |

### 网络架构

```
互联网
  ↓
Caddy (80/443)
  ├─ erp.yourcompany.com → erp:3000
  ├─ mes.yourcompany.com → mes:3000
  └─ api.yourcompany.com → kong:8000
                              ├─ /auth/* → gotrue:9999
                              ├─ /rest/* → postgrest:3000
                              ├─ /storage/* → storage:5000
                              └─ /realtime/* → realtime:4000

内部网络 (backend)
  ├─ postgres:5432
  ├─ redis:6379
  └─ inngest:8288
```
