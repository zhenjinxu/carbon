# Carbon Windows Full-Docker Operation and Migration

本文记录 `D:\Object\carbon` 的 Windows 本机全 Docker 运行方式，以及迁移到另一台
Windows 电脑的可回滚流程。Ubuntu 生产迁移使用
`docs/ubuntu-production-docker-migration.md`，不要把 Docker Desktop 数据盘直接复制到
生产 Ubuntu。

## Current local state

本机 Carbon 的长期运行服务已经全部进入 Docker Desktop Linux 容器：

- ERP、MES；
- PostgreSQL 17.6.1、Redis 7；
- Kong、GoTrue、PostgREST、Realtime、Storage、Edge Runtime；
- Studio、Postgres Meta、Inbucket、Inngest。

本机还保留 `carbon/supabase-cli:2.89.0` helper 镜像。它只为 ERP/MES 镜像提供
生产迁移 CLI，最终镜像会再次执行 `supabase --version` 校验；本机 Compose 默认
通过 `SUPABASE_CLI_SOURCE` 复用它，避免每次构建访问 GitHub release。

当前 Docker Engine 只配置 `https://docker.m.daocloud.io` 作为下载 mirror。它不是
Carbon 运行依赖；目标电脑可不配置 mirror，或使用现场已验证的企业/区域镜像源，
但不要复制已失效的多 mirror 列表。

主机上的 Node/pnpm 只负责生成配置、构建、迁移编排和测试，不承载长期 ERP/MES
服务。应用容器通过 `postgres:5432`、`redis:6379`、`kong:8000` 等内部 DNS 通信。
Inngest 通过 `http://erp:3000` 发现和执行函数，不使用宿主 `localhost` 回调。
浏览器访问公开地址：

| 服务 | 本机地址 |
|---|---|
| ERP | `http://localhost:3000` |
| MES | `http://localhost:3001` |
| Supabase/Kong | `http://127.0.0.1:54322` |
| PostgreSQL 工具连接 | `localhost:56252` |

当前仍有一个未被 Carbon 使用的 Windows `postgresql-x64-18` 服务监听 56251，作为
迁移回退源保留。Carbon 的配置和容器均不再引用它。确认新栈验收通过后，在
`services.msc` 中停止该服务，并把启动类型改为“手动”或“禁用”。不要删除旧数据目录，
直到备份恢复演练和业务验收完成。

2026-07-29 对账发现源 PG18 的 `pgmq.q_event_system` 有 691,096 条历史事件。经用户
明确授权，使用官方 `pgmq.purge_queue('event_system')` 清除 Docker PG17 目标队列
683,896 条，清理后为 0；源 PG18 和清理前备份未修改。清理后迁移快照位于
`.codex/work/windows-full-docker/backup-20260729-after-pgmq-purge`，数据库 dump 的
SHA-256 为 `b8a6d36a439d55d431f96db11abc7ede426bba9fdc5f4e2bd202c029009fdeb0`。

## Daily operation

在项目根目录执行：

```powershell
# 首次启动、依赖或应用代码变化后：构建并启动完整栈
pnpm dev

# 已有镜像时快速启动，不重新构建
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon up -d --no-build

# 查看状态
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon ps

# 停止但保留全部数据卷
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon stop
```

不要在日常停止或迁移回滚中使用 `down -v`。应用代码变化后，应重新构建 ERP/MES
镜像；数据库结构变化仍按 Carbon migration 流程执行。

## Migration prerequisites

两台电脑均应满足：

1. 64 位 Windows、WSL2 和 Docker Desktop，使用 Linux containers。
2. Docker Desktop 有足够磁盘空间；源数据当前约 5.2 GB，迁移空间至少预留其三倍。
3. 目标仓库版本与源电脑完全一致，包括尚未提交的必要文件。
4. 使用相同的 `public.ecr.aws/supabase/postgres:17.6.1.105` 镜像版本。
5. 迁移 `carbon/supabase-cli:2.89.0` helper 镜像。
6. `.env` 与 `.env.local` 通过加密介质单独传输，不提交到 Git，不写入 Obsidian。

如果工作区存在未提交修改，单纯 `git clone` 不会复制这些内容。应先创建受控提交，
或在所有 Carbon 容器停止后归档整个工作区，并排除 `node_modules`、构建缓存和
`.git` 中不需要的对象。

## Source backup

以下流程同时保留逻辑备份和冷卷备份。逻辑备份便于核查与跨宿主恢复；冷卷备份用于
相同 PostgreSQL 镜像下的精确 Windows-to-Windows 克隆。

1. 创建目标目录并停止所有写入服务：

   ```powershell
   New-Item -ItemType Directory -Force .\backup\carbon-windows | Out-Null
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon stop erp mes gotrue postgrest realtime storage edge-runtime inngest
   ```

2. 创建保留 owner/ACL 的逻辑备份。不要加入 `--no-owner` 或
   `--no-privileges`：

   ```powershell
   docker exec carbon-postgres-1 pg_dump -U postgres -Fc -f /tmp/carbon-db.dump postgres
   docker cp carbon-postgres-1:/tmp/carbon-db.dump .\backup\carbon-windows\db.dump
   docker exec carbon-postgres-1 psql -U postgres -Atc "SHOW server_version_num" | Set-Content -Encoding ascii .\backup\carbon-windows\postgres-version.txt
   ```

3. 停止 PostgreSQL 和 Redis，创建一致的冷卷归档：

   ```powershell
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon stop postgres redis
   docker run --rm -v carbon_pgdata:/data:ro -v "$($PWD.Path)\backup\carbon-windows:/backup" alpine:3 sh -c "tar czf /backup/pgdata.tar.gz -C /data ."
   docker run --rm -v carbon_storage:/data:ro -v "$($PWD.Path)\backup\carbon-windows:/backup" alpine:3 sh -c "tar czf /backup/storage.tar.gz -C /data ."
   docker run --rm -v carbon_inngest:/data:ro -v "$($PWD.Path)\backup\carbon-windows:/backup" alpine:3 sh -c "tar czf /backup/inngest.tar.gz -C /data ."
   docker run --rm -v carbon_redis-data:/data:ro -v "$($PWD.Path)\backup\carbon-windows:/backup" alpine:3 sh -c "tar czf /backup/redis.tar.gz -C /data ."
   ```

4. 导出本机镜像构建所需的 CLI helper：

   ```powershell
   docker save -o .\backup\carbon-windows\supabase-cli-image.tar carbon/supabase-cli:2.89.0
   ```

5. 生成校验文件：

   ```powershell
   Get-ChildItem .\backup\carbon-windows\* -File |
     Where-Object Name -ne 'SHA256SUMS.txt' |
     Get-FileHash -Algorithm SHA256 |
     Format-Table Hash,Path -AutoSize |
     Out-File -Encoding utf8 .\backup\carbon-windows\SHA256SUMS.txt
   ```

6. 把工作区、环境文件和整个 `backup\carbon-windows` 目录复制到目标电脑。传输后在
   目标电脑重新执行 `Get-FileHash`，逐项比对。

源电脑在目标验收完成前保持停止或只读。若继续写入，现有备份立即失去割接一致性。

## Target restore

以下冷卷恢复只适用于相同镜像标签和 Docker Desktop Linux containers。目标电脑不能
已有正在使用的 `carbon_*` 卷；如果存在，先改用不同 Compose project 名进行演练，
不要覆盖未知数据。

1. 在目标项目根目录确认配置：

   ```powershell
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon config --quiet
   docker pull public.ecr.aws/supabase/postgres:17.6.1.105
   ```

2. 导入 CLI helper 镜像：

   ```powershell
   docker load -i .\backup\carbon-windows\supabase-cli-image.tar
   docker run --rm carbon/supabase-cli:2.89.0 /usr/local/bin/supabase --version
   ```

   第二条命令必须输出 `2.89.0`。

3. 创建空卷并恢复冷备份：

   ```powershell
   docker volume create carbon_pgdata
   docker volume create carbon_storage
   docker volume create carbon_inngest
   docker volume create carbon_redis-data
   docker run --rm -v carbon_pgdata:/data -v "$($PWD.Path)\backup\carbon-windows:/backup:ro" alpine:3 sh -c "tar xzf /backup/pgdata.tar.gz -C /data"
   docker run --rm -v carbon_storage:/data -v "$($PWD.Path)\backup\carbon-windows:/backup:ro" alpine:3 sh -c "tar xzf /backup/storage.tar.gz -C /data"
   docker run --rm -v carbon_inngest:/data -v "$($PWD.Path)\backup\carbon-windows:/backup:ro" alpine:3 sh -c "tar xzf /backup/inngest.tar.gz -C /data"
   docker run --rm -v carbon_redis-data:/data -v "$($PWD.Path)\backup\carbon-windows:/backup:ro" alpine:3 sh -c "tar xzf /backup/redis.tar.gz -C /data"
   ```

4. 构建并启动：

   ```powershell
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon build erp mes
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon up -d
   ```

如果目标电脑直接访问 npm 正常，应保持 dev-sidecar 关闭并使用上述标准 Compose
命令。如果必须临时启动 dev-sidecar，容器需要显式信任其 CA；不要关闭 TLS 校验：

```powershell
docker build --secret "id=dev_sidecar_ca,src=$HOME\.dev-sidecar\dev-sidecar.ca.crt" --build-arg SUPABASE_CLI_SOURCE=carbon/supabase-cli:2.89.0 --build-arg APP=erp -t carbon/erp:local .
docker build --secret "id=dev_sidecar_ca,src=$HOME\.dev-sidecar\dev-sidecar.ca.crt" --build-arg SUPABASE_CLI_SOURCE=carbon/supabase-cli:2.89.0 --build-arg APP=mes -t carbon/mes:local .
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon up -d --no-build
```

CA 通过 BuildKit secret 只在依赖下载步骤可见，不写入最终镜像。构建结束后可关闭
dev-sidecar；不需要重启 Docker Desktop，也不要添加不受控 `registry-mirrors`。

Compose 可能提示 `carbon_pgdata` 不是由本次 Compose 创建，这是导入既有卷时的预期
一次性提示，不代表恢复失败。

## Acceptance

至少验证：

```powershell
docker compose --env-file .env.local -f docker-compose.local.yml -p carbon ps
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing
Invoke-WebRequest http://localhost:3001/health -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:54322/auth/v1/health -UseBasicParsing
docker exec carbon-postgres-1 psql -U postgres -Atc "select version(); select count(*) from auth.users; select count(*) from public.\"company\"; select count(*) from storage.objects;"
```

还应实际完成一次 ERP 登录、MES 页面访问、Storage 文件下载、PostgREST 查询、
Realtime 连接和 Inngest 函数发现，并确认至少一个函数完成事件。对比源/目标的公司数、
用户数、关键业务表计数、Storage 对象行数和实际归档文件数。

## Rollback

目标验收失败时：

1. 在目标电脑执行 `docker compose ... stop`，不要删除卷。
2. 保留目标日志、卷和备份，记录失败发生前后的操作。
3. 让源电脑继续使用原来的全 Docker 栈：

   ```powershell
   docker compose --env-file .env.local -f docker-compose.local.yml -p carbon up -d --no-build
   ```

4. 如果必须回退到迁移前的 Windows PostgreSQL 18，停止目标全 Docker 栈，在源电脑
   重新启用 `postgresql-x64-18`，并使用迁移前配置启动旧版本代码。该路径只用于短期
   应急，不能把 PostgreSQL 17 期间新增写入自动合并回 18。

任何一端在割接后产生的新业务数据都必须先冻结并审计，再决定人工补录或重新迁移；
禁止让两个环境同时接受写入。

## Ubuntu handoff

Windows-to-Windows 可使用同镜像冷卷复制；Ubuntu 生产必须使用保留 owner/ACL 的
`pg_dump -Fc`、Storage/Inngest 归档和 Swarm 恢复脚本。生产 secrets 由 Swarm
重新创建，不能复制本地明文开发凭据。完整步骤见
`docs/ubuntu-production-docker-migration.md`。

向前迁移应使用清空后的 `backup-20260729-after-pgmq-purge/db.dump`，并配合清空前
完整备份中的 Storage/helper 归档。清空前 `db.dump` 仅作为回滚证据，不能用于新的
Ubuntu 恢复，否则会重新带入历史 PGMQ 队列。
