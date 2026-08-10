# Carbon Ubuntu Production Docker Migration

本文说明如何把当前 Carbon 工作区迁移到 Ubuntu 单机生产环境。生产入口统一为
`contrib/deploying/simple-docker-caddy`，遵循 `crbnos/carbon` 官方路线：
单节点 Docker Swarm、Caddy 自动 HTTPS、Docker Swarm secrets、ERP/MES、
Supabase、PostgreSQL、Storage、Redis 和生产模式 Inngest。

## Target architecture

- 只有 Caddy 发布宿主机的 80/TCP、443/TCP 和 443/UDP。
- ERP、MES、Kong、GoTrue、PostgREST、Realtime、Storage、Edge Runtime、
  Studio、Postgres Meta、PostgreSQL、Redis 和 Inngest 位于同一 overlay 网络。
- Inngest 通过 `http://erp:3000/api/inngest` 发现函数，ERP handler 通过
  `INNGEST_SERVE_HOST=http://erp:3000` 广告同一内部执行地址；不得向 Inngest 容器
  返回宿主 `localhost` 或依赖公网 DNS 回环。
- PostgreSQL、Storage、Redis、Inngest 和 Caddy 状态使用命名卷持久化。
- 密码、JWT key、service-role key、session secret、SMTP、Resend、Inngest 和
  U8 密码只通过 Swarm secrets 提供，不写入 `.env`。
- Studio 默认不公开；需要时通过 Caddy basic auth 或 SSH 隧道临时访问。
- Edge Function 默认验证 Supabase HS256 JWT；仅 `.env` 中
  `EDGE_JWT_DISABLED_FUNCTIONS` 明确列出的公共图片函数跳过验证。

## Ubuntu host preparation

推荐 Ubuntu 24.04 LTS、4 核以上、至少 8 GB RAM、100 GB 以上 SSD。构建 ERP
镜像时 Node 的内存上限约 8 GB；小内存主机必须先配置 swap。

1. 创建非 root sudo 用户，配置 SSH key 登录，并确认 SSH 端口。
2. 安装 Docker Engine、Compose plugin、Git、OpenSSL、curl 和 gzip。
   如果所在网络不能稳定访问 Docker Hub，应配置企业镜像仓库或一个经过现场拉取
   验证的镜像加速地址。不要复制 Windows 开发机的本地代理配置到 Ubuntu；至少用
   `docker pull node:22` 和本栈所有固定镜像完成一次预拉取验证。
3. 把仓库检出到固定路径：

   ```bash
   sudo mkdir -p /opt/carbon
   sudo chown "$USER":"$USER" /opt/carbon
   git clone <your-carbon-repository> /opt/carbon
   cd /opt/carbon/contrib/deploying/simple-docker-caddy
   ```

4. 检查 DNS：`ERP_HOST`、`MES_HOST`、`SUPABASE_HOST` 的 A/AAAA 记录均指向
   该 Ubuntu 主机。
5. 在确认 SSH 端口后执行加固：

   ```bash
   sudo SSH_PORT=22 ./scripts/harden.sh
   ```

6. 确认公网只开放 80/443；Postgres、Redis、Studio 和 Inngest 不发布端口。

## Initial stack setup

1. 初始化 Swarm、`.env` 和基础 secrets：

   ```bash
   chmod +x deploy.sh bin/*.sh postgres/*.sh scripts/*.sh
   ./deploy.sh init
   ```

2. 编辑同目录 `.env`，至少设置 `CARBON_REPO=/opt/carbon`、域名、URL、
   ACME 邮箱、SMTP 和镜像标签。
3. 用部署脚本设置真实 secrets，不要把值放进 shell history。可通过 stdin：

   ```bash
   printf '%s' "$RESEND_API_KEY" | ./deploy.sh secret resend_api_key
   printf '%s' "$SMTP_PASSWORD" | ./deploy.sh secret smtp_password
   printf '%s' "$U8_PASSWORD" | ./deploy.sh secret u8_password
   printf '%s' "$GOOGLE_OAUTH_CLIENT_SECRET" | ./deploy.sh secret google_oauth_client_secret
   printf '%s' "$AZURE_OAUTH_CLIENT_SECRET" | ./deploy.sh secret azure_oauth_client_secret
   ```

   后两项仅在启用对应 OAuth provider 时设置。数据库密码、PostgREST URI 和
   Supabase JWT 三元组由部署脚本成组管理，不能用通用 `secret` 命令逐个替换。
   `init --force` 只允许在尚无 `pgdata` 的新栈使用，不是生产密钥轮换命令。

4. 如果不启用 U8 导入，`.env` 中的 U8 非密钥字段留空，并保持导入配置关闭。
5. 构建并首次部署空栈：

   ```bash
   ./deploy.sh build
   ./deploy.sh deploy
   ./deploy.sh status
   ```

新数据库可以直接运行 `./deploy.sh migrate`。迁移已有数据时，先完成下一节的恢复，
再运行迁移补齐当前仓库中比备份更新的 schema。

## U8 network requirements

U8 SQL Server 可以在外部 Windows 主机上，但 Carbon ERP 容器必须能够从 Ubuntu
overlay 网络访问 `U8_SERVER:U8_PORT`。生产镜像已自带 `mssql` 和
`scripts/import-u8-work-orders.cjs`，不再依赖 `D:/Object/0.1.7` 或其
`node_modules`。上线前从 ERP 容器验证 DNS、路由和 1433/TCP 防火墙，并执行一次
限定客户或日期范围的 dry-run。

## Source inventory

割接前记录以下证据：

- 权威业务数据库的主机、数据库名和 `SHOW server_version_num`。
- 已应用迁移列表、扩展、函数、触发器、RLS policy 和公司数量。
- Storage 文件实际位置、总字节数、bucket 数和 `storage.objects` 行数。
- 当前 Redis 是否只存缓存；Redis 数据默认不迁移，应用会重新填充。
- 当前 Inngest 是否有必须保留的排队任务；官方备份会归档 Inngest 卷。
- 源 PG18 的 `pgmq.q_event_system` 基线为 691,096 条。经用户授权，Docker PG17
  目标已使用 `pgmq.purge_queue` 清除 683,896 条至 0；源库和清理前备份保留。
  Ubuntu 向前恢复必须使用 `backup-20260729-after-pgmq-purge/db.dump`，不能使用
  清理前 dump，否则历史队列会重新出现。
- ERP/MES、邮件、OAuth、U8、打印和外部集成所需的非密钥配置与 secret 清单。

生产栈固定使用 Supabase PostgreSQL 17.6.1.105。目标 PostgreSQL 主版本不得低于
逻辑备份的源主版本。当前 Windows 全 Docker 环境已经迁移到同一 PostgreSQL 17
路线，可直接执行同主版本演练。若另一个来源仍是 PostgreSQL 18，不能用本手册的
常规恢复脚本直接降级；应先在隔离环境完成 18 到 17 的逻辑迁移、所有权/ACL 对账
和扩展兼容验证，再把验证后的 PostgreSQL 17 环境作为正式来源。

## Data migration rehearsal

至少在正式割接前完整演练一次，并记录备份、恢复和验收耗时。

1. 创建并校验源环境备份。如果源环境已经是该 Swarm 栈，先把写入服务缩容为 0，
   再运行完整备份：

   ```bash
   for service in erp mes gotrue postgrest realtime storage edge-runtime inngest; do
     docker service scale "carbon_${service}=0"
   done
   BACKUP_CONFIRMED_QUIESCED=YES BACKUP_DIR=/mnt/carbon-backups ./scripts/backup.sh
   ```

   备份目录包含 `db.dump`、`storage.tar.gz`、`inngest.tar.gz`、
   `postgres-version.txt` 和 `SHA256SUMS`。把它复制到异机或对象存储。

当前 Windows 来源使用普通 Compose 全 Docker 栈，不运行 Swarm 专用脚本。先停止
ERP、MES、GoTrue、PostgREST、Realtime、Storage、Edge Runtime 和 Inngest 等写
服务，再从 PostgreSQL 17 容器执行保留 owner/ACL 的 `pg_dump -Fc`，记录
`SHOW server_version_num`，并归档 `carbon_storage` 与 `carbon_inngest` 卷。完整
命令见 `docs/windows-local-full-docker-migration.md`。不得添加 `--no-owner` 或
`--no-privileges`：实测这会把 `auth`、`storage` 等对象恢复为错误 owner，导致
GoTrue 或 Storage 无法启动。必须先确认权威数据库和卷，不能把空数据库或仅有
元数据的目录当成来源。

2. 在目标空栈把所有写入服务缩容为 0，保留 Postgres：

   ```bash
   for service in erp mes gotrue postgrest realtime storage edge-runtime inngest; do
     docker service scale "carbon_${service}=0"
   done
   ```

   如果 `STACK_NAME` 不是 `carbon`，替换前缀。

3. 验证备份路径后执行受保护恢复：

   ```bash
   RESTORE_CONFIRMED=YES ./scripts/restore.sh /mnt/carbon-backups/carbon-YYYYmmdd-HHMMSS
   ```

   数据库恢复使用单事务并保留对象 owner/ACL；任何对象恢复失败都会回滚该次数据库
   恢复，不留下半完成状态。目标初始化必须先创建归档引用的全部 Supabase 角色，
   包括 `supabase_functions_admin`。

4. 恢复服务并补齐迁移：

   ```bash
   ./deploy.sh deploy
   ./deploy.sh migrate
   docker service update --force carbon_erp
   docker service update --force carbon_mes
   ```

5. 对账 PostgreSQL 关键表数量、Storage bucket/object 数、Storage 文件数量和
   Inngest 服务状态。恢复后不要立即删除源环境或备份。

## Acceptance checklist

- `./deploy.sh status` 中所有要求运行的服务达到目标副本数且无循环重启。
- `https://ERP_HOST/health` 与 `https://MES_HOST/health` 返回成功。
- Supabase Auth 登录、登出、邀请或 magic link 正常，回调域名正确。
- REST、Realtime WebSocket、Storage 上传/下载和 Edge Function 正常。
- 受保护 Edge Function 对无效或过期 JWT 返回 401，公共图片函数仍可按预期访问。
- ERP 物料、销售、采购、库存、生产、质量与设置页面可以读取真实数据。
- MES 工单、工序详情、报工、领料和质量路径可用。
- Inngest 发现 ERP functions，discovery 广告 `http://erp:3000`，定时任务和一次
  人工事件执行成功。
- Redis 权限缓存可重建，日志中没有认证失败或跨公司数据。
- U8 启用时：dry-run 成功、一次限定导入成功、第二次执行保持幂等。
- Caddy 证书有效；Postgres、Redis、Studio 和 Inngest 端口不能从公网访问。
- 执行一次备份，并在独立演练栈完成恢复。

## Production cutover

1. 提前降低 DNS TTL，公告停机窗口，保留源环境完整回退能力。
2. 冻结 ERP/MES、旧系统导入和后台写任务；确认没有运行中的 Inngest/U8 写任务。
3. 将写入服务缩容为 0，使用 `BACKUP_CONFIRMED_QUIESCED=YES` 生成最终备份，
   异机保存并验证 `SHA256SUMS`。
4. 按演练步骤恢复目标，运行迁移和验收清单。
5. 切换 DNS，持续观察 Caddy、ERP/MES、Postgres、Storage、Inngest 和邮件日志。
6. 在确认业务方验收前，源环境保持冻结但不要删除。

## Rollback

若目标在验收窗口内失败：

1. 立即重新冻结目标写入，记录目标开始服务后的所有新增业务记录。
2. 把 DNS 或上游代理切回仍冻结且完整的源环境。
3. 明确处理目标窗口新增数据：放弃、人工补录或经过审计的反向迁移；不要直接双向合并。
4. 保留失败目标卷、日志、最终备份和校验文件用于根因分析。
5. 修复后必须重新执行完整迁移演练，不能从失败步骤直接继续正式割接。

删除生产数据卷必须是独立、明确批准的操作。不要在常规回滚中执行
`./deploy.sh down --volumes`。即使在获批的数据销毁中，该命令也要求
`DELETE_VOLUMES_CONFIRMED` 的值与 `STACK_NAME` 完全一致。

## Routine operations

```bash
./deploy.sh status
./deploy.sh logs erp
./deploy.sh logs inngest
```

完整 `backup.sh` 要求短维护窗口并验证写服务已缩容为 0。每天还应配置 PostgreSQL
WAL/卷快照和异机备份；定期在独立栈演练完整恢复。
Swarm secrets 在被服务使用时不可原地替换；按 `deploy.sh secret` 的提示进入维护窗口。
部署脚本会拒绝直接替换 Postgres 密码或 PostgREST URI。数据库密码轮换必须作为独立
维护变更：先验证备份和回滚，再在同一停机窗口同步修改数据库内所有 Supabase 角色、
`postgres_password` 和派生的 `postgrest_db_uri`，最后逐项验收。密码轮换绝不能删除
`pgdata` 卷。
Realtime 的 `SECRET_KEY_BASE`/`DB_ENC_KEY` 和 Supabase JWT 三元组也不能逐项轮换；
必须先分析现有加密数据与会话影响，再按成组轮换方案演练。
