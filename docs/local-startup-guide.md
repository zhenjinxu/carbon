# Carbon 本地开发环境启动指南

## 问题诊断

**现象：** 运行 `docker compose up -d` 和 `scripts\start-local.bat` 后，`localhost:3000` 和 `localhost:3001` 无法访问。

**根因：** Docker 容器（Supabase 服务）与 ERP/MES 应用服务器是**两套独立的进程**：
- Docker 容器**不会**监听 3000/3001 端口（它们内部使用的 3000 端口是 PostgREST/Studio 的，不映射到宿主机）
- 3000/3001 端口由 `pnpm dev`（React Router dev server）在宿主机上启动
- `start-local.bat` 使用 `start /b` 启动应用，关闭 cmd 窗口会同时终止应用进程

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│  Docker 容器（Supabase 基础设施）                          │
├───────────────────┬─────────────────────────────────────┤
│ GoTrue            │ 认证服务（内部端口 9999）              │
│ PostgREST         │ REST API（容器内端口 3000，不映射）    │
│ Kong              │ API 网关 → 宿主机端口 54321          │
│ Realtime          │ WebSocket 实时推送                    │
│ Storage           │ 文件存储                              │
│ Studio            │ DB 管理 UI → 宿主机端口 56253        │
│ Inbucket          │ 邮件测试 → 宿主机端口 56254          │
│ Inngest           │ 任务队列 → 宿主机端口 56255          │
│ Edge Runtime      │ Supabase Edge Functions             │
└───────────────────┴─────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  宿主机原生服务                                           │
├───────────────────┬─────────────────────────────────────┤
│ PostgreSQL 18     │ 端口 56251                           │
│ Redis 7           │ 端口 6379                            │
└───────────────────┴─────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  应用开发服务器（pnpm dev）                               │
├───────────────────┬─────────────────────────────────────┤
│ ERP               │ http://localhost:3000                │
│ MES               │ http://localhost:3001                │
└───────────────────┴─────────────────────────────────────┘
```

---

## 正确启动步骤

### 前提条件

| 软件 | 要求 | 验证命令 |
|------|------|----------|
| Docker Desktop | 运行中 | `docker ps` |
| PostgreSQL 18 | 安装于 `D:\Program Files\PostgreSQL\18` | `pg_isready -h localhost -p 56251` |
| Redis 7 | 安装于 `D:\Redis` | `redis-cli ping` |
| Node.js | v24+ | `node --version` |
| pnpm | v10+ | `pnpm --version` |

### 方式一：一键启动（推荐）

**保持 cmd 窗口打开**，运行：

```bat
scripts\start-local.bat
```

> ⚠️ **关键：不要关闭此 cmd 窗口！** 关闭窗口会终止 ERP/MES 进程。

### 方式二：分步启动scripts\start-local.bat

#### 第一步：启动基础设施服务

```bat
REM 启动 PostgreSQL（Windows 服务方式）
net start "postgresql-x64-18"

REM 启动 Redis
D:\Redis\redis-server.exe --daemonize yes

REM 启动 Supabase Docker 容器
docker compose -f docker-compose.local.yml --env-file .env.local up -d
```

#### 第二步：等待服务就绪

```bat
REM 检查 PostgreSQL
"D:\Program Files\PostgreSQL\18\bin\pg_isready" -h localhost -p 56251

REM 检查 Redis
redis-cli ping

REM 检查 Docker 容器（确认 Kong 为 healthy）
docker compose -f docker-compose.local.yml ps
```

#### 第三步：启动应用（需要保持终端打开）

打开**两个独立的终端窗口**，分别运行：

**终端 1 - ERP：**
```bat
cd D:\object\carbon
pnpm --filter erp exec react-router dev --port 3000 --host 127.0.0.1
```

**终端 2 - MES：**
```bat
cd D:\object\carbon
pnpm --filter mes exec react-router dev --port 3001 --host 127.0.0.1
```

---

## 访问地址

| 服务 | URL | 说明 |
|------|-----|------|
| **ERP** | http://localhost:3000 | 企业资源计划主应用 |
| **MES** | http://localhost:3001 | 制造执行系统 |
| **Supabase API** | http://localhost:54321 | Kong 代理的 API 网关 |
| **Supabase Studio** | http://localhost:56253 | 数据库管理界面 |
| **Inbucket（邮件测试）** | http://localhost:56254 | 本地邮件捕获（替代真实邮件） |
| **Inngest（任务队列）** | http://localhost:56255 | 后台任务管理 |

---

## 常用运维命令

```bat
REM 查看 Docker 容器状态
docker compose -f docker-compose.local.yml ps

REM 查看 Docker 容器日志
docker compose -f docker-compose.local.yml logs

REM 查看特定容器日志
docker logs carbon-gotrue-1 --tail 50

REM 停止 Docker 容器
docker compose -f docker-compose.local.yml down

REM 重启 Docker 容器
docker compose -f docker-compose.local.yml restart

REM 停止 PostgreSQL 服务
net stop "postgresql-x64-18"

REM 仅启动服务（不启动 ERP/MES 应用）
scripts\start-local.bat --services

REM 首次数据库初始化
scripts\start-local.bat --init
```

---

## 首次环境搭建

如果是第一次搭建环境，需要额外执行以下步骤：

```bat
REM 1. 安装依赖
pnpm install

REM 2. 启动 PostgreSQL
net start "postgresql-x64-18"

REM 3. 初始化 Supabase 数据库角色
scripts\start-local.bat --init

REM 4. 运行数据库迁移（start-local.bat 会自动执行，或手动运行）
bin\supabase.exe migration up --include-all --db-url "postgresql://postgres:postgres@localhost:56251/postgres"

REM 5. 启动全部服务
scripts\start-local.bat
```

---

## 故障排查

### 端口 3000/3001 无法访问

**原因：** ERP/MES 开发服务器未运行。

**检查：**
```bat
netstat -ano | findstr ":3000 :3001"
```

如果无输出，说明应用未启动。参考「第三步：启动应用」。

### Docker 容器显示 unhealthy

**说明：** 部分容器（realtime、storage）因镜像内缺少 `wget` 导致健康检查失败，但服务本身正常运行，可忽略。

**验证服务实际可用：**
```bat
curl http://localhost:54321/health
```

### PostgreSQL 无法连接

```bat
REM 检查服务状态
sc query "postgresql-x64-18"

REM 手动启动
net start "postgresql-x64-18"

REM 验证
"D:\Program Files\PostgreSQL\18\bin\pg_isready" -h localhost -p 56251
```

### Redis 无法连接

```bat
REM 手动启动
D:\Redis\redis-server.exe --daemonize yes

REM 验证
redis-cli ping
```

### 数据库迁移失败

```bat
REM 手动执行迁移
bin\supabase.exe migration up --include-all --db-url "postgresql://postgres:postgres@localhost:56251/postgres"
```

---

## 环境变量说明

| 文件 | 用途 |
|------|------|
| `.env` | 用户级密钥（API keys 等） |
| `.env.local` | 自动生成的端口/URL/Supabase 密钥（由 `crbn up` 生成） |

应用通过符号链接共享根目录 `.env`：
- `apps/erp/.env` → `../../.env`
- `apps/mes/.env` → `../../.env`

---

## 关闭所有服务

```bat
REM 1. 在 ERP/MES 终端按 Ctrl+C 停止应用

REM 2. 停止 Docker 容器
docker compose -f docker-compose.local.yml down

REM 3. 停止 PostgreSQL（可选）
net stop "postgresql-x64-18"
```
