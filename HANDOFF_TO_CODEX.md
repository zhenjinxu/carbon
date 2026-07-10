# Carbon 项目交接方案

> **交接时间**: 2026-07-10
> **交接对象**: Claude (Claude Code) → Codex (GPT-5.5)
> **项目路径**: `D:\object\carbon`

---

## 一、项目概述

**Carbon** 是一个面向制造业的开源 ERP/MES/QMS 系统（网站: [carbon.ms](https://carbon.ms)）。它是一个全栈 TypeScript monorepo，基于 Supabase (PostgreSQL)、React Router、Tailwind CSS 构建，通过 SST/Vercel 部署。

### 三大应用

| 应用 | 路径 | 用途 | 端口 |
|------|------|------|------|
| **ERP** | `apps/erp/` | 企业资源计划（桌面端） | localhost:3000 |
| **MES** | `apps/mes/` | 制造执行系统（车间触屏） | localhost:3001 |
| **Academy** | `apps/academy/` | 培训应用 | — |

### 代码规模

- **4,442 次 git 提交**（从 2024-12-28 至今）
- **18 个 ERP 业务模块**
- **21 个共享 packages**
- **752+ 数据库迁移**
- **406+ 数据库表**

---

## 二、技术栈

### 前端
- **框架**: React Router v7 (扁平路由)
- **UI 组件**: 自建组件库 `packages/react/`
- **样式**: Tailwind CSS + CSS 变量主题系统
- **表单**: 自建表单库 `packages/form/`（基于 Zod 验证）
- **国际化**: Lingui v5（宏模式，11 种语言）
- **状态管理**: nanostores + React Query + React Router data loading

### 后端
- **数据库**: PostgreSQL 18 (通过 Supabase 封装)
- **API**: PostgREST (自动生成 REST API) + React Router actions/loaders
- **认证**: Supabase Auth (Magic Link + OAuth + API Key)
- **边缘函数**: Vercel Edge Runtime (Deno)
- **后台任务**: Inngest
- **缓存**: Redis (ioredis)
- **实时**: Supabase Realtime

### 构建与部署
- **Monorepo**: NPM workspaces + pnpm + Turbo
- **打包**: Vite
- **代码检查**: Biome
- **部署**: Docker + Supabase CLI

---

## 三、项目结构

```
carbon/
├── apps/
│   ├── erp/                    # ERP 主应用
│   │   └── app/
│   │       ├── modules/        # 业务模块（每个模块有 models/service/ui）
│   │       │   ├── accounting/ # 会计/财务
│   │       │   ├── inventory/  # 库存管理
│   │       │   ├── items/      # 物料管理
│   │       │   ├── production/ # 生产管理
│   │       │   ├── purchasing/ # 采购管理
│   │       │   ├── quality/    # 质量管理
│   │       │   ├── sales/      # 销售管理
│   │       │   ├── resources/  # 资源管理
│   │       │   └── ...
│   │       ├── components/     # 共享组件
│   │       ├── hooks/          # 自定义 hooks
│   │       └── routes/         # 路由 (x+/ = 受保护, _public+/ = 公开, api+/ = API)
│   ├── mes/                    # MES 车间应用
│   └── academy/                # 培训应用
├── packages/
│   ├── auth/                   # 认证包 (@carbon/auth)
│   ├── database/               # 数据库类型和迁移 (@carbon/database)
│   │   └── supabase/
│   │       ├── migrations/     # 752+ 迁移文件
│   │       └── functions/      # 边缘函数
│   ├── react/                  # 共享 UI 组件 (@carbon/react)
│   ├── form/                   # 表单库 (@carbon/form)
│   ├── documents/              # PDF/Email/ZPL 生成
│   ├── locale/                 # 国际化文件
│   │   └── locales/zh/         # 中文翻译 (erp.po, mes.po)
│   ├── kv/                     # Redis 客户端
│   ├── printing/               # 打印系统
│   ├── jobs/                   # 后台任务
│   └── ...
├── llm/                        # AI 辅助开发
│   ├── cache/                  # 项目知识缓存（重要！）
│   ├── tasks/                  # 任务追踪和教训
│   └── workflows/              # 工作流定义
├── docs/                       # 文档
├── scripts/                    # 工具脚本
└── docker-compose.local.yml    # 本地 Docker 配置
```

---

## 四、本地开发环境

### 系统架构

```
┌─────────────────────────────────────────────────────────┐
│  Docker 容器（Supabase 基础设施）                          │
├───────────────────┬─────────────────────────────────────┤
│ GoTrue            │ 认证服务                              │
│ PostgREST         │ REST API 网关                        │
│ Kong              │ API 网关 → 宿主机端口 54321          │
│ Storage           │ 文件存储                              │
│ Studio            │ DB 管理 UI → 端口 56253              │
│ Inbucket          │ 邮件测试 → 端口 56254                │
│ Inngest           │ 任务队列 → 端口 56255                │
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

### 启动步骤

```bash
# 方式一：一键启动（推荐）
scripts\start-local.bat

# 方式二：使用 crbn CLI
crbn up --no-portless

# 方式三：手动分步启动
# 1. 启动 PostgreSQL 和 Redis
net start "postgresql-x64-18"
D:\Redis\redis-server.exe --daemonize yes

# 2. 启动 Docker 容器
docker compose -f docker-compose.local.yml --env-file .env.local up -d

# 3. 启动 ERP 开发服务器
cd apps/erp && pnpm dev:app

# 4. 浏览器访问 http://localhost:3000
# 登录: dev@carbon.local
```

### 登录凭据
- **URL**: http://localhost:3000
- **Email**: dev@carbon.local
- **公司**: Carbon Development (co-dev)

### 关键配置文件
| 文件 | 用途 |
|------|------|
| `.env` | 用户级密钥 |
| `.env.local` | 自动生成的端口/URL/Supabase密钥 |
| `docker-compose.local.yml` | 本地 Docker 配置 |
| `scripts/local-supabase-api.cjs` | 自定义 API 服务器（端口 54322） |
| `scripts/seed-local.sql` | 本地种子数据 |

---

## 五、近期工作历史（时间线）

### 2026-07-10（今天）— 财务系统和汉化

| 提交 | 描述 |
|------|------|
| `6154b83e6` | 恢复使用 customers/documents 视图 |
| `5413ff397` | 修复 inboundInspection 外键迁移重复执行 |
| `fbd14c267` | 添加销售模块种子数据 |
| `5dd7ae855` | 修复 customers/documents 表名错误 |
| `0c3a13a39` | **大提交**: PDF ByteString修复、材料属性页面汉化、会计模块汉化 (113个文件) |
| `313598a7c` | 财务系统端到端修复 - 会计默认值、边缘函数、Docker代理、DB schema |
| `dd0342f43` | 汉化会计科目表页面 |

### 2026-07-08 — 本地环境稳定性

| 提交 | 描述 |
|------|------|
| `7106a5a91` | 供应商交互文档改用服务端存储 |
| `e23e43454` | 更新 lingui PO 文件 |
| `09f360652` | 确保 dump.rdb 被忽略 |
| `2d2bfa8a1` | i18n 侧边栏树节点名称 |
| `451afee4d` | 修复缺失的 FK (inboundInspectionSample) |
| `8143824d8` | 添加分阶段生产部署计划 |
| `eb1d3c083` | 添加生产 Docker 部署配置 |
| `0eae0e012` | **大修复**: 本地开发稳定性、模态UX、服务端文件上传、i18n (213个文件) |
| `489136638` | Inngest SDK URL Docker 网络修复 |
| `e08dc26f0` | 公司删除 + customFieldTable 修复 |
| `fb3b8a378` | company.tsx 缺失 `<Outlet/>` 修复 |

### 2026-07-07 — 开发环境崩溃修复

- **Vite 崩溃修复**: `vite-plugin-babel-macros` 处理大文件（7.5MB 类型文件）导致原生内存错误
  - 自定义 `macrosSkipLarge()` 插件替代 `babelMacros()`
- **删除公司模态框修复**: `ConfirmDelete` 使用 `<Form>` 替代 `fetcher.Form`
- **数据库确认**: 所有数据在 `postgres` 数据库，非 `carbon` 数据库

### 2026-06 月 — 功能开发

| 功能 | PR | 描述 |
|------|-----|------|
| Picking Lists | #848 | 生产拣货单系统 |
| Label Printing | #842 | 标签打印系统 |
| Document Template Customizer | #880 | 文档模板定制器 |
| Import Flow Improvements | #888 | 导入流程改进 |
| MCP 2.0 OAuth | #863 | OAuth + MCP 远程服务器 |
| Sales Order Cancellation | — | 销售订单取消功能 |
| Duplicate Purchase Order | #875 | 采购订单复制 |

---

## 六、当前状态

### ✅ 已完成
1. **本地开发环境完全就绪** — PostgreSQL + Redis + Docker 容器 + ERP/MES 开发服务器
2. **汉化 100%** — ERP: 2965 条翻译，MES: 347 条翻译，0 缺失
3. **端到端冒烟测试通过** — 所有核心页面可访问
4. **财务系统端到端修复** — 会计默认值、报表、科目表完整可用
5. **74 个 ERP 测试全部通过**
6. **PDF/CSV 路由修复** — 14 个 PDF 路由 + 3 个 CSV 路由的 Content-Disposition 修复
7. **生产部署计划** — Docker 部署配置和分阶段计划文档

### 📋 当前 Git 状态
```
当前分支: main
领先 origin/main: 8 个提交（未推送）
未跟踪文件: scripts/fix-duplicate-triggers.sql（1个）
未提交修改: 无
暂存: 无
```

### ⏸ 待办事项

1. **构造企业生产管理测试数据** — 复杂装配 BoM（`seed-assembly.ts` 已有，待 live DB 执行）
2. **补充硬编码英文** — inventory/sales/quality 模块部分表单仍有 raw strings
3. **推送本地提交** — 8 个提交领先 origin/main，需要 push
4. **处理未跟踪文件** — `scripts/fix-duplicate-triggers.sql` 需要决定是提交还是清理

---

## 七、关键架构模式

### 7.1 数据库迁移

```bash
# 创建迁移
npm run db:migrate <name>

# 应用迁移
bin\supabase.exe migration up --include-all --db-url "postgresql://postgres:postgres@localhost:56251/postgres"
```

**关键规则**:
- 所有业务表需要 `companyId` + 复合主键 `("id", "companyId")`
- ID 使用 `id('prefix')` 函数生成
- RLS 必须使用新模板: `get_companies_with_employee_permission()`
- **永远不要**使用旧的 `has_role('employee', "companyId")` 模式
- 迁移文件名不要用 `000000` 作为 HHMMSS 部分

### 7.2 国际化 (Lingui)

```typescript
// ✅ 正确: 在组件中使用
import { useLingui } from "@lingui/react/macro";
const { t } = useLingui();
t`翻译文本`

// ✅ 正确: 在面包屑中使用
import { msg } from "@lingui/core/macro";
handle.breadcrumb: msg`面包屑`

// ❌ 错误: 永远不会这样导入 t
import { t } from "@lingui/core/macro";  // 会导致 SSR 崩溃！
```

### 7.3 认证和权限

```typescript
// 服务端权限检查
import { requirePermissions } from "@carbon/auth/auth.server";
const { client, companyId, userId } = await requirePermissions(request, {
  view: "moduleName",
});

// ⚠️ 关键: Layout loader 中的 getUser 必须使用 service role
import { getCarbonServiceRole } from "@carbon/auth/auth.server";
const user = await getUser(getCarbonServiceRole(), userId);
```

### 7.4 服务层模式

```typescript
// 每个模块有 4 个标准方法
deleteCustomerPortal()
getCustomerPortals()
getCustomerPortal()
upsertCustomerPortal()
```

### 7.5 MES vs ERP 组件大小

- **MES** (车间触屏): 始终使用 `size="lg"`
- **ERP** (桌面): 默认使用 `size="md"`
- 共享组件必须暴露 `size?: "md" | "lg"` prop

---

## 八、已知问题和技术债务

### 8.1 已知 Bug

| 问题 | 状态 | 描述 |
|------|------|------|
| React Router ErrorBoundary | 待修复 | `WithErrorBoundaryProps` 包装器导致 "useLoaderData must be used within a data router" 错误 |
| 部分拣货单物料 | 已知 | partial-stock 仍然选择完整数量，而不是仅缺额 |
| dump.rdb | 已修复 | Redis dump 文件已从 git 移除并加入 .gitignore |

### 8.2 技术债务

1. **硬编码英文**: 部分表单仍有 raw English strings（inventory/sales/quality）
2. **ERP 无 vitest 基础设施**: `apps/erp` 没有 vitest 配置和测试
3. **Postgres NUMERIC 在边缘函数中返回字符串**: 必须在算术运算前 `Number()` 转换
4. **Docker 镜像预加载**: 大量 npm 缓存包（~2000+ 文件）已提交到 repo 用于 Docker 构建

### 8.3 重要陷阱

| 陷阱 | 说明 |
|------|------|
| `destroyAuthSession()` 必须 `throw` | 否则 loader 会继续执行，导致 NPE |
| `requirePermissions` 返回的 client 不能用于 DB 写 | 在自托管环境下必须用 `getCarbonServiceRole()` |
| Postgres NUMERIC 返回字符串 | 在边缘函数中 `+` 会做字符串拼接，必须 `Number()` |
| 不要自己重建数据库 | 等待用户操作 |
| 不要未经请求就提交代码 | 用户要求时才提交 |

---

## 九、关键文件索引

### 文档文件（必读）

| 文件 | 内容 |
|------|------|
| `AGENTS.md` / `CLAUDE.md` | 项目核心指令和工作流 |
| `docs/local-startup-guide.md` | 本地环境启动指南 |
| `docs/localization-zh-guide.md` | 汉化使用说明 |
| `docs/financial-system-guide.md` | 财务系统建立方案（633行） |
| `docs/phased-deployment-plan.md` | 分阶段生产部署计划 |
| `docs/production-deployment.md` | 生产部署文档 |

### 缓存文件（快速了解项目）

| 文件 | 内容 |
|------|------|
| `llm/cache/project-overview.md` | 项目结构概述 |
| `llm/cache/coding-conventions.md` | 编码约定 |
| `llm/cache/authentication-system.md` | 认证系统详解 |
| `llm/cache/i18n-lingui-system.md` | 国际化系统 |
| `llm/cache/database-migration-patterns.md` | 数据库迁移模式 |
| `llm/cache/environment-configuration.md` | 环境配置 |
| `llm/cache/session-breakpoint-2026-07-07.md` | 7/7 会话断点 |
| `llm/cache/session-breakpoint-2026-07-08.md` | 7/8 会话断点 |

### 任务追踪

| 文件 | 内容 |
|------|------|
| `llm/tasks/todo.md` | 待办事项和本地搭建状态 |
| `llm/tasks/lessons.md` | 重要教训和模式（必读！） |
| `llm/tasks/database-issues-pending.md` | 数据库问题（已解决） |

### 工作流定义

| 文件 | 内容 |
|------|------|
| `llm/workflows/database-migration.md` | 数据库迁移工作流 |
| `llm/workflows/edge-function.md` | 边缘函数工作流 |
| `llm/workflows/event-system.md` | 事件系统工作流 |

---

## 十、下一步建议

### 10.1 立即可以做的

1. **推送本地提交到远程**
   ```bash
   git push origin main
   ```

2. **处理未跟踪文件**
   ```bash
   # 检查 fix-duplicate-triggers.sql 是否需要
   git add scripts/fix-duplicate-triggers.sql
   git commit -m "fix: add duplicate triggers cleanup script"
   ```

3. **补充剩余硬编码英文** — 继续汉化 inventory/sales/quality 模块

### 10.2 功能开发优先级

1. **构造测试数据** — 复杂装配 BoM 端到端测试
2. **完善财务系统** — 月末结账流程、财务报表完善
3. **质量模块增强** — 入站检验、不合格品处理
4. **库存优化** — 存储位置跟踪、库存盘点

### 10.3 技术改进

1. **为 ERP 添加 vitest** — 建立测试基础设施
2. **修复 ErrorBoundary 问题** — React Router v7 兼容性问题
3. **清理 npm 缓存包** — 2000+ 预加载包考虑其他管理方式
4. **完善 CI/CD** — 自动化测试和部署

---

## 十一、给 Codex 的特别提示

### 必读文件（按优先级）

1. `AGENTS.md` — 项目核心指令
2. `llm/tasks/lessons.md` — 重要教训（避免重复踩坑）
3. `llm/cache/project-overview.md` — 项目结构
4. `docs/local-startup-guide.md` — 如何启动

### 核心原则

1. **Simplicity First** — 每次改动尽量简单，最小化代码影响
2. **No Laziness** — 找到根本原因，不要临时修复
3. **Minimal Impact** — 只触碰必要的代码
4. **Demand Elegance** — 非简单改动要思考是否有更优雅的方案
5. **Use existing components** — 先搜索 `packages/react/src/` 和 `apps/erp/app/components/`

### 不要做的事

- ❌ 不要未经请求就提交代码
- ❌ 不要自己重建数据库
- ❌ 不要在认证代码中留 `console.log`（会导致崩溃）
- ❌ 不要在边缘函数中直接对 NUMERIC 做 `+` 运算
- ❌ 不要使用旧的 RLS 模式 (`has_role`)
- ❌ 不要在组件中 `import { t } from "@lingui/core/macro"`

### 关键路径

- **ERP 模块结构**: `apps/erp/app/modules/<module>/` 包含 `models.ts`, `service.ts`, `ui/`
- **数据库迁移**: `packages/database/supabase/migrations/`
- **边缘函数**: `packages/database/supabase/functions/`
- **共享组件**: `packages/react/src/`
- **国际化文件**: `packages/locale/locales/zh/`

---

## 附录 A: ERP 业务模块清单

| 模块 | 路径 | 功能 |
|------|------|------|
| account | `modules/account/` | 账户管理 |
| accounting | `modules/accounting/` | 会计/财务（科目表、报表、成本中心） |
| documents | `modules/documents/` | 文档管理 |
| inventory | `modules/inventory/` | 库存管理（数量、存储位置） |
| invoicing | `modules/invoicing/` | 发票管理 |
| items | `modules/items/` | 物料管理（零件、产品、BOM） |
| people | `modules/people/` | 人员管理（客户、供应商） |
| plm | `modules/plm/` | 产品生命周期管理 |
| production | `modules/production/` | 生产管理（工单、工序） |
| purchasing | `modules/purchasing/` | 采购管理（采购订单、收货） |
| quality | `modules/quality/` | 质量管理（检验、不合格品） |
| resources | `modules/resources/` | 资源管理（工作中心、员工） |
| sales | `modules/sales/` | 销售管理（报价、订单） |
| settings | `modules/settings/` | 系统设置 |
| shared | `modules/shared/` | 共享服务 |
| storageRules | `modules/storageRules/` | 存储规则 |
| users | `modules/users/` | 用户管理 |

## 附录 B: 常用命令

```bash
# 开发
pnpm --filter erp dev:app           # 启动 ERP
pnpm --filter mes dev:app           # 启动 MES
pnpm install                        # 安装依赖

# 数据库
npm run db:migrate <name>           # 创建迁移
npm run db:build                    # 构建数据库类型
bin\supabase.exe migration up ...   # 应用迁移

# 国际化
pnpm lingui extract                 # 提取翻译
pnpm lingui compile                 # 编译翻译
pnpm --filter @carbon/locale sync   # 同步 PO 文件

# 测试
pnpm test                           # 运行所有测试
pnpm --filter erp test              # 运行 ERP 测试

# 构建
pnpm build                          # 构建所有应用
pnpm --filter erp build             # 构建 ERP

# 代码质量
pnpm lint                           # 代码检查
pnpm format                         # 格式化
pnpm typecheck                      # 类型检查
```

---

## 附录 C: 关键环境变量

| 变量 | 用途 | 示例值 |
|------|------|--------|
| `SUPABASE_URL` | Supabase API URL | `http://localhost:54321` |
| `SUPABASE_DB_URL` | 数据库直连 URL | `postgresql://postgres:postgres@localhost:56251/postgres` |
| `SUPABASE_ANON_KEY` | 匿名 key | (自动生成) |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务角色 key | (自动生成) |
| `SESSION_SECRET` | Session 加密密钥 | (必须手动设置) |
| `REDIS_URL` | Redis 连接 | `redis://localhost:6379` |
| `ERP_URL` | ERP 应用 URL | `http://localhost:3000` |

---

**交接完成。** Codex 应该首先阅读 `AGENTS.md` 和 `llm/tasks/lessons.md` 来理解项目规则和避免已知陷阱。
