# Carbon 生产环境 Docker 迁移参考意见

> 来源：Codex  
> 日期：2026-07-07  
> 用途：供 Claude 继续阅读、评估并形成更完整的实施计划。

## 背景判断

当前 Carbon 项目已经有 ERP、MES、Academy 三个应用，以及 Supabase/PostgreSQL、Redis、Edge Functions、Storage、Inngest 等配套服务。现有测试环境是混合形态：一部分服务在 Docker 中，一部分数据和服务在宿主机本地数据库中。

从仓库现状看，不建议把 `docker-compose.local.yml` 直接作为生产方案使用。该文件明确是本地混合开发栈：宿主 PostgreSQL/Redis + Docker Supabase 服务。`docker-compose.dev.yml` 更接近“全 Docker”形态，但仍包含开发用途配置、默认密码、源码 bind mount、Inbucket、dev dispatcher 等内容，也不适合原样上生产。

因此建议新增一套独立的 `docker-compose.prod.yml`，并配套 `.env.production.example`、备份恢复脚本、健康检查和迁移验证清单。

## 建议目标架构

生产环境建议全部容器化，但要区分“业务应用容器”和“基础服务容器”。

核心服务：

- `reverse-proxy`：Caddy / Traefik / Nginx，负责 HTTPS、证书、ERP/MES/Academy/Supabase API 域名路由。
- `erp`：使用 `apps/erp/Dockerfile` 构建，内部端口 3000。
- `mes`：使用 `apps/mes/Dockerfile` 构建，内部实际端口 3000。
- `academy`：如果生产需要培训应用，需要补充 `apps/academy/Dockerfile`。
- `postgres`：使用固定版本 Supabase Postgres 镜像，持久化 volume。
- `redis`：容器化 Redis，启用密码、AOF、持久化 volume。
- `kong`：Supabase API Gateway。
- `gotrue`：Supabase Auth。
- `postgrest`：REST API。
- `realtime`：实时订阅。
- `storage`：Supabase Storage。
- `edge-runtime`：Supabase Edge Functions。
- `meta`：Supabase metadata API，仅供内部/Studio 使用。
- `studio`：生产默认不公网暴露，只内网、VPN 或临时启用。

不建议进入生产的开发组件：

- `inbucket`：仅适合本地邮件测试，生产应使用真实 SMTP 或 Resend。
- `inngest dev`：适合本地开发，不建议作为生产任务队列。
- 源码 bind mount：生产应使用构建好的镜像或只读 release 目录。
- 默认 `postgres` 密码和默认 JWT secret。

## 关键调整建议

### 1. 新增生产 Compose 文件

新增 `docker-compose.prod.yml`，不要复用 `docker-compose.local.yml`。

生产 compose 应做到：

- 所有服务使用固定镜像 tag。
- 所有 secrets 从 `.env.production` 或 Docker secrets 注入。
- PostgreSQL、Redis、Storage 使用明确命名的 volume。
- 只公开 reverse proxy 的 80/443。
- Supabase 内部组件默认不直接暴露到公网。
- Studio 默认不启用或只绑定内网地址。
- 所有服务加 `restart: unless-stopped` 或等价策略。
- 数据服务加 healthcheck。

### 2. 修正 MES Dockerfile 端口标识

`apps/mes/Dockerfile` 当前设置 `ENV PORT=3000`，但 `EXPOSE 3001`。实际运行端口是 3000。建议改成：

```dockerfile
EXPOSE 3000
```

这不是功能性 bug，但会误导 compose、运维和健康检查配置。

### 3. Academy 是否纳入生产需先决策

仓库中 Academy 有 app 和 `package.json`，但没有生产 Dockerfile。如果生产环境需要培训应用，应新增 `apps/academy/Dockerfile`，基本结构可以参考 ERP/MES。

如果暂时不需要 Academy，则生产 compose 不应包含它，但要明确后续接入方式。

### 4. 加强健康检查

当前 ERP/MES `/health` 只是返回 `ok`，不足以证明生产可用。建议至少增加一个内部 readiness endpoint 或增强现有 health：

- 应用进程可响应。
- Supabase REST 可访问。
- 直连 PostgreSQL 可查询。
- Redis 可 ping。
- Storage 可访问。

负载均衡器可以继续用轻量 `/health`，但上线验收应使用更完整的 `/api/health` 或脚本。

### 5. 明确 Inngest 生产策略

ERP 当前通过 `/api/inngest` 暴露 Inngest 函数。生产有两种合理路线：

- 继续使用 Inngest Cloud：这是最少改造的方案，容器只负责提供 `/api/inngest` endpoint，并配置 `INNGEST_SIGNING_KEY`、`INNGEST_EVENT_KEY`。
- 完全自托管任务队列：需要专项改造，不建议和这次基础迁移混在一起。

不建议将 `inngest dev` 当作生产任务队列。

### 6. 明确 Storage 后端

短期单机 Docker 部署可以使用 Supabase Storage 的 file backend + Docker volume。

如果后续需要多副本、多机器、滚动部署或高可用，建议改为 S3/MinIO 后端。否则多个 app 实例之间的文件一致性和备份恢复会变复杂。

## 生产环境变量重点

应用服务不只依赖 `SUPABASE_URL`。至少需要准备：

- `NODE_ENV=production`
- `VERCEL_ENV=production`
- `CARBON_EDITION`
- `DOMAIN`
- `ERP_URL`
- `MES_URL`
- `SESSION_SECRET`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `SUPABASE_DB_URL`
- `REDIS_URL`
- `RESEND_API_KEY`
- `RESEND_DOMAIN`
- `INNGEST_SIGNING_KEY`
- `INNGEST_EVENT_KEY`
- `POSTHOG_API_HOST`
- `POSTHOG_PROJECT_PUBLIC_KEY`
- `CLOUDFLARE_TURNSTILE_SITE_KEY`
- `CLOUDFLARE_TURNSTILE_SECRET_KEY`

按实际启用功能再补充：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_PLACES_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SLACK_*`
- `JIRA_*`
- `XERO_*`
- `QUICKBOOKS_*`
- `ONSHAPE_*`

## 数据迁移风险

### PostgreSQL 大版本

仓库 Supabase 配置指向 Postgres 15，`docker-compose.dev.yml` 也使用 `supabase/postgres:15.14.1.112`。但当前测试环境记录中出现过本地 PostgreSQL 18 的描述。

迁移前必须确认源数据库真实版本：

```sql
SHOW server_version;
```

如果源库是 PG18，目标库是 PG15，不能直接假设兼容。建议：

- 优先让生产 Postgres 大版本与源库一致，或
- 做完整演练：schema restore、data restore、函数/触发器/RLS/扩展验证。

### 多数据库与 schema 差异

之前任务记录中出现过 `postgres` 数据库和 `carbon` 数据库迁移不一致的问题。正式迁移前必须确认权威数据源：

- 哪个数据库是业务真实源。
- Supabase 服务实际连接哪个 database。
- 所有迁移是否已应用到同一个 database。
- 是否存在只在本地手动建表/手动修复的对象。

### Storage 文件

数据库中的 `storage.objects` 只记录元数据；真实文件还在 storage volume 或本地文件目录中。迁移必须同时包含：

- PostgreSQL 数据。
- Supabase Storage 文件目录或 volume。
- bucket 配置。
- 文件访问权限/RLS。

### Redis 数据

Redis 主要用于缓存、限流、权限缓存、打印配置等。大部分可重建，但如果当前有必须保留的队列/会话/状态，需要单独确认。一般迁移可以不复制 Redis，但生产必须保证新 Redis 可用。

## 推荐迁移流程

### 阶段 1：盘点

1. 确认当前权威数据库位置和版本。
2. 确认当前 Supabase API 指向哪个数据库。
3. 列出当前 Docker volumes。
4. 列出 storage 文件实际位置。
5. 汇总 `.env`、`.env.local`、手工配置和密钥。
6. 确认生产域名规划：ERP、MES、Academy、Supabase API、Studio 是否需要域名。
7. 确认 Inngest 策略。

### 阶段 2：搭建空生产栈

1. 创建 `.env.production`。
2. 启动 `docker-compose.prod.yml`。
3. 验证 Postgres、Redis、Kong、GoTrue、PostgREST、Storage、Edge Runtime。
4. 构建并启动 ERP/MES 镜像。
5. 验证基础 health endpoint。

此阶段不导入业务数据。

### 阶段 3：迁移演练

1. 对当前数据库执行 `pg_dump -Fc`。
2. 备份 storage 文件目录或 volume。
3. 在临时生产栈执行 restore。
4. 验证 schema、RLS、函数、触发器、扩展。
5. 验证登录、权限、文件上传下载、ERP/MES 关键页面、Edge Functions、打印、MRP。
6. 记录 restore 耗时和问题。

### 阶段 4：正式割接

1. 降低 DNS TTL。
2. 通知内部用户停写。
3. 停止旧环境应用写入入口。
4. 执行最终数据库 dump。
5. 执行最终 storage 备份。
6. 在生产栈 restore。
7. 启动应用容器。
8. 跑验收清单。
9. 切换 DNS 或反向代理 upstream。

### 阶段 5：观察与回滚窗口

1. 老环境保持只读或冻结，不立刻删除。
2. 观察应用日志、数据库连接、Redis、Storage、Edge Functions。
3. 保留割接前 dump 和 storage 备份。
4. 如果失败，DNS 切回旧环境。
5. 如果新环境已产生写入，需要明确是否丢弃、人工补录或做反向同步。

## 验收清单

基础：

- ERP 首页可访问。
- MES 首页可访问。
- 登录、登出、magic link 或 OAuth 正常。
- session cookie domain 正确。
- Supabase REST 正常。
- PostgreSQL 直连正常。
- Redis ping 正常。
- Storage 上传、下载、预览正常。

业务：

- 物料列表、物料详情。
- 生产工单列表、工单详情。
- MES 工序执行页。
- 销售订单。
- 采购订单。
- 库存收发或转移。
- 文件/模型上传。
- PDF/ZPL 生成。
- MRP 或相关 Edge Function。
- 打印配置和打印任务。

后台任务：

- Inngest 函数发现正常。
- 定时任务策略明确。
- 邮件发送正常。
- 通知/权限缓存刷新正常。

安全：

- 默认数据库密码已更换。
- JWT secret 已更换。
- service role key 不暴露到浏览器。
- Studio 不公网暴露。
- Postgres 不公网暴露。
- Redis 不公网暴露。
- HTTPS 正常。
- 生产 `.env` 不提交仓库。

## 给 Claude 的建议任务拆分

建议 Claude 后续计划按以下顺序拆：

1. 读取现有 Docker/Supabase/env 配置，确认生产 compose 的最小服务集合。
2. 设计 `docker-compose.prod.yml` 和 `.env.production.example`。
3. 修正 MES Dockerfile 端口。
4. 如果需要 Academy，新增 Academy Dockerfile。
5. 设计生产 health/readiness 检查。
6. 设计数据库和 storage backup/restore 脚本。
7. 明确 Inngest 生产方案。
8. 输出试迁移 runbook。
9. 输出正式割接 runbook。
10. 输出回滚 runbook。

## Codex 结论

这次迁移的核心不是“把现有 compose 换个环境变量跑起来”，而是把当前混合测试环境收敛成一套可备份、可恢复、可验证、可回滚的生产运行单元。

短期最稳的路线是：

1. 新增独立生产 compose。
2. PostgreSQL、Redis、Storage 全部容器化并持久化。
3. ERP/MES 使用现有 Dockerfile 构建镜像。
4. Academy 是否纳入单独决策。
5. Inngest 暂不自托管生产队列，优先使用官方生产模式。
6. 先演练恢复，再正式割接。

