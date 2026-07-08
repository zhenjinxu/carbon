# Carbon Scripts 管理文档

本目录包含 Carbon 项目的开发、部署和运维脚本。

---

## 目录结构

```
scripts/
├── db/                              # 数据库相关脚本
│   ├── asm/                         # ASM 测试数据（归档）
│   │   ├── restore-asm-*.sql       # ASM 数据恢复脚本
│   │   ├── seed-asm-*.sql          # ASM 种子数据
│   │   ├── cleanup-asm.sql         # ASM 数据清理
│   │   └── insert-items.sql        # 物料数据插入
│   ├── migrate-psql.js             # psql 迁移工具（备用）
│   ├── supabase-init-local.sql     # Supabase 角色初始化
│   ├── seed-local.sql              # 本地开发种子数据
│   ├── seed-mes-demo.sql           # MES 演示数据
│   ├── seed-non-standard-manufacturing.sql
│   └── fix-sales-orders-without-opportunities.sql
├── migrations/                      # 数据库迁移脚本
│   ├── change-company-permissions.sql
│   ├── part-revision-merges.ts
│   └── stripe-customer-migrations.ts
├── pr-complexity/                   # PR 复杂度分析工具
├── start-local.bat                  # Windows 启动脚本
├── start-local.sh                   # Unix/Git Bash 启动脚本
├── stop-local.bat                   # Windows 停止脚本
├── stop-local.sh                    # Unix/Git Bash 停止脚本
├── create-agent.ts                  # 创建 AI Agent
├── create-tool.ts                   # 创建 AI Tool
├── generate-db-types.ts            # 生成数据库类型定义
├── generate-job-dependencies.ts    # 生成作业依赖图
├── generate-mcp.ts                 # 生成 MCP 工具元数据
├── generate-seed-sql.sh            # 导出种子数据 SQL
├── generate-swagger-docs.ts        # 生成 Swagger 文档
├── get-lb-info.sh                  # 获取 AWS 负载均衡器信息
├── delete-company-files.ts         # 删除公司文件
├── inventory-value.ts              # 库存价值计算
├── make-users-admins.ts            # 提升用户为管理员
├── model-upload.ts                 # 模型上传
├── sales-invoice-report.ts         # 销售发票报告
├── setup-env-files.ts              # 设置环境文件
└── strip-po-headers.mjs            # 清理 PO 文件头
```

---

## 本地开发启动/停止

### 启动脚本

**Windows (CMD):**
```cmd
scripts\start-local.bat
```

**Unix/Git Bash/WSL:**
```bash
scripts/start-local.sh
```

### 启动选项

| 选项 | 说明 |
|------|------|
| `--init` | 首次初始化数据库（创建 Supabase 角色） |
| `--services` | 仅启动服务，不启动应用 |

### 停止脚本

**Windows (CMD):**
```cmd
scripts\stop-local.bat
```

**Unix/Git Bash/WSL:**
```bash
scripts/stop-local.sh
```

### 停止选项

| 选项 | 说明 |
|------|------|
| `--all` | 停止所有服务（包括 Docker、PostgreSQL、Redis） |
| `--docker` | 仅停止 Docker 服务和应用服务器 |

### 环境变量

启动脚本支持以下环境变量覆盖默认配置：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PG_BIN` | `D:\Program Files\PostgreSQL\18\bin` | PostgreSQL 二进制文件路径 |
| `PG_PORT` | `56251` | PostgreSQL 端口 |
| `REDIS_SERVER` | `D:\Redis\redis-server.exe` | Redis 服务器路径 |

**示例：**
```bash
PG_PORT=5432 scripts/start-local.sh
```

---

## 数据库操作

### 初始化数据库

首次启动时需要初始化数据库：

```bash
scripts/start-local.sh --init
```

这将执行 `scripts/db/supabase-init-local.sql` 创建必要的 Supabase 角色。

### 运行迁移

迁移会在启动时自动运行。如果需要手动运行：

**使用 Supabase CLI（推荐）：**
```bash
bin/supabase.exe migration up --include-all \
  --db-url "postgresql://postgres:postgres@localhost:56251/postgres"
```

**使用 psql 备用方案：**
```bash
node scripts/db/migrate-psql.js
```

### 种子数据

**本地开发数据：**
```bash
psql -U postgres -p 56251 -d postgres -f scripts/db/seed-local.sql
```

**MES 演示数据：**
```bash
psql -U postgres -p 56251 -d postgres -f scripts/db/seed-mes-demo.sql
```

### ASM 测试数据

ASM 相关数据位于 `scripts/db/asm/` 目录：

```bash
# 恢复 ASM 数据
psql -U postgres -p 56251 -d postgres -f scripts/db/asm/restore-asm-complete.sql

# 清理 ASM 数据
psql -U postgres -p 56251 -d postgres -f scripts/db/asm/cleanup-asm.sql
```

---

## 代码生成工具

### 生成数据库类型

```bash
pnpm generate:types
# 或
tsx scripts/generate-db-types.ts
```

### 生成 MCP 工具元数据

```bash
pnpm generate:mcp
# 或
tsx scripts/generate-mcp.ts
```

### 生成 Swagger 文档

```bash
pnpm generate:swagger
# 或
tsx scripts/generate-swagger-docs.ts
```

### 创建 AI Agent

```bash
pnpm agent:new
# 或
tsx scripts/create-agent.ts
```

### 创建 AI Tool

```bash
pnpm tool:new
# 或
tsx scripts/create-tool.ts
```

---

## 运维工具

### 提升用户为管理员

编辑 `scripts/make-users-admins.ts` 添加用户邮箱，然后运行：

```bash
tsx scripts/make-users-admins.ts
```

### 库存价值计算

```bash
tsx scripts/inventory-value.ts
```

### 销售发票报告

```bash
tsx scripts/sales-invoice-report.ts
```

### 获取 AWS 负载均衡器信息

```bash
scripts/get-lb-info.sh
```

---

## 维护注意事项

1. **定期清理**：删除不再使用的测试脚本和临时文件
2. **备份重要数据**：运行数据修改脚本前先备份数据库
3. **测试环境**：在测试环境验证脚本后再在生产环境运行
4. **文档更新**：添加新脚本时更新本文档
5. **路径配置**：使用环境变量而非硬编码路径

---

## 故障排除

### PostgreSQL 无法启动

检查 PostgreSQL 服务是否已安装：
```bash
# Windows
net start | findstr postgresql

# 手动启动
net start "postgresql-x64-18"
```

### Redis 无法启动

检查 Redis 是否在运行：
```bash
redis-cli ping
```

如果未运行，手动启动：
```bash
# Windows
D:\Redis\redis-server.exe --daemonize yes

# Unix
redis-server --daemonize yes
```

### Docker 服务无法启动

确保 Docker Desktop 正在运行，然后重试：
```bash
docker compose -f [redacted-host].yml up -d
```

查看日志：
```bash
docker compose -f [redacted-host].yml logs
```

### 迁移失败

如果自动迁移失败，可以手动运行单个迁移：
```bash
psql -U postgres -p 56251 -d postgres \
  -f packages/database/supabase/migrations/<migration_file>.sql
```

---

## 相关文档

- [本地启动指南](../docs/local-startup-guide.md)
- [数据库迁移工作流](../llm/workflows/database-migration.md)
- [项目概览](../README.md)
