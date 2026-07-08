# Carbon 汉化生产管理系统 — 本地使用说明

> 本文记录在本地构建一套**汉化后的 Carbon 制造系统**（ERP + MES）的完整流程，包括环境准备、Docker 栈启动、语言切换、复杂装配测试数据、测试运行与常见问题。

## 目录

- [一、环境前置条件](#一环境前置条件)
- [二、首次安装与配置](#二首次安装与配置)
- [三、启动完整 Docker 栈](#三启动完整-docker-栈)
- [四、汉化（中文）说明](#四汉化中文说明)
- [五、复杂装配测试数据](#五复杂装配测试数据)
- [六、测试运行](#六测试运行)
- [七、构建生产包](#七构建生产包)
- [八、端到端冒烟验证](#八端到端冒烟验证)
- [九、常见问题](#九常见问题)

---

## 一、环境前置条件

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 22（实测 v24） | crbn 要求 Node 22+ |
| pnpm | 10.33.4（由 `packageManager` 锁定） | `corepack enable` 自动激活 |
| Docker | 任意现代版本（实测 29.4） | 用于跑 Postgres/Supabase/Redis/Inngest 等栈 |
| Shell | **Git Bash (MINGW64) 或 WSL** | `crbn` / `setup.sh` 是 POSIX 脚本，**原生 cmd.exe / PowerShell 不支持** |
| 镜像源 | 国内镜像（1ms.run / daocloud 等） | 大镜像拉取耗时，需耐心或配置 `~/.docker/daemon.json` 的 `registry-mirrors` |

外部服务（Posthog / Stripe / Resend / Google OAuth 等）在本地开发中**非必需**——留空即可，对应集成功能保持关闭，不影响栈启动。

## 二、首次安装与配置

```bash
# 1. 安装依赖（supabase CLI 的 postinstall 在本环境会因镜像源 SSL 失败，
#    已在 package.json 的 pnpm.onlyBuiltDependencies 中移除 supabase，
#    crbn 用 Docker 内的 Supabase CLI，不依赖本地该二进制）
pnpm install

# 2. 创建 .env（基于 .env.example，仅放真正的 secrets）
#    端口/URL/Supabase keys/Redis/Inngest 由 `crbn up` 自动写入 .env.local
cp .env.example .env
#    至少设置 SESSION_SECRET（必需，crbn 不生成）：
#    SESSION_SECRET="<随机长字符串>"
#    其余外部服务密钥可留空

# 3. 一次性安装 crbn 到 shell（写入 ~/.bashrc 的 PATH + crbn 函数）
./setup.sh
source ~/.bashrc   # 或重开 shell
crbn                # 验证：显示帮助
```

> **若不想全局安装 crbn**，可直接用 `bash packages/dev/bin/crbn <cmd>` 调用。

## 三、启动完整 Docker 栈

栈包含：Postgres 15、GoTrue（认证）、PostgREST、Realtime、Storage、postgres-meta、Studio、Inbucket（邮件）、edge-runtime、Kong（网关）、Inngest（后台任务）、Redis（缓存）。

```bash
# services-only + localhost 模式（不拉起 dev server，不用 portless *.dev 域名）
crbn up --no-portless --no-apps
```

`crbn up` 会自动：拉镜像 → 起容器 → 写 `.env.local`（动态端口/URL/JWT/anon/service key/REDIS_URL）→ 跑数据库迁移 → 重生 types。

完成后查看状态：

```bash
crbn status          # 显示端口分配与容器健康
docker ps            # 确认全部容器 healthy
```

`.env.local` 关键变量（由 crbn 生成，勿手改）：

```
SUPABASE_URL=http://localhost:<PORT_API>
SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:<PORT_DB>/postgres
SUPABASE_ANON_KEY=...        # 由随机 JWT_SECRET 派生
SUPABASE_SERVICE_ROLE_KEY=...
REDIS_URL=redis://localhost:<PORT_REDIS>/<db>
ERP_URL=http://localhost:<PORT_ERP>
```

> **镜像拉取慢**：首次需拉 11 个镜像（supabase/kong/inngest 等），国内镜像源易超时。可参考 `scripts` 下的耐心重试脚本，或配置更稳定的 `registry-mirrors`。

### 启动开发服务器（可选）

```bash
# 起栈 + ERP/MES dev server（带 HMR）
crbn up --no-portless           # 会交互式选择起 ERP/MES
# 或单独起 ERP：
pnpm --filter erp dev
```

## 四、汉化（中文）说明

### 现状

- **PO 译本已 ~100% 完成**：`packages/locale/locales/zh/erp.po`（2964 条）、`zh/mes.po`（347 条）。
- **编译产物**：`zh/erp.mjs` / `zh/mes.mjs`（由 `lingui compile` 生成，被 `.gitignore` 忽略，运行时按需加载）。**缺失则 UI 静默回退英文**——必须先编译。
- 已补全最显眼的硬编码英文（见下）。

### 编译汉化 catalog

```bash
pnpm lingui:compile     # 生成所有 locale 的 .mjs（含 zh）
# 或单独验证：
ls packages/locale/locales/zh/*.mjs
grep -c "出现错误" packages/locale/locales/zh/erp.mjs   # 应 ≥1
```

### 语言切换机制

- **唯一的运行时切换入口**：右上角头像菜单（`AvatarMenu`）→ "Language" 子菜单 → 选择"中文"。
- 切换会 POST `/api/locale`，写入 `locale` cookie（1 年有效，作用于共享主域，**ERP 和 MES 共用**）。
- 首次访问无 cookie 时，按浏览器 `Accept-Language` 自动判断（中文浏览器自动中文）。
- MES 无独立切换入口，依赖 ERP 设置的 cookie。

### 已补全的硬编码英文（本次工作）

未被 lingui 宏包裹的纯字符串无法被翻译。本次已用 `t\`\`` / `<Trans>` 包裹并补 zh 译的高频界面：

| 类别 | 文件 | 说明 |
| --- | --- | --- |
| 会计表头 | `accounting/ui/FixedAssets/{AssetClassesTable,DepreciationRunTable,FixedAssetsTable}.tsx` | 资产/折旧表列头 |
| 会计表头 | `accounting/ui/{Dimensions/DimensionsTable,Intercompany/IntercompanyTransactionTable,JournalEntries/JournalEntriesTable,Reports/TrialBalanceTable}.tsx` | 维度/公司间/日记账/试算平衡表列头 |
| 错误边界 | `apps/erp/app/root.tsx`、`apps/mes/app/root.tsx` | "Something went wrong"/"Back Home" |
| 税务表单 | `purchasing/ui/Supplier/SupplierTaxForm.tsx` | 税务信息卡 + toast |

### i18n 改动规范（供后续扩展）

> 详见 `llm/cache/i18n-lingui-system.md`。关键坑：

1. 组件内**必须** `import { useLingui } from "@lingui/react/macro"` → `const { t } = useLingui()`，再用 `t\`text\``。
2. **绝不**从 `@lingui/core/macro` 导入 `t`（会命中未激活的全局单例，导致 SSR 崩溃）。
3. `t` 进入 `useMemo`/`useCallback` 依赖数组。
4. `msg\`\`` 仅用于 route `handle.breadcrumb`（只创建 MessageDescriptor，不调用 i18n）。
5. 改动后跑：`pnpm lingui:extract`（提取新 msgid）→ 补 `zh/erp.po` 的 `msgstr` → `pnpm lingui:compile`。

### 待办（后续工作）

未在本次范围内、量较大的硬编码英文：

- `sales` / `purchasing` / `inventory` 模块其余表单 `label=` / `placeholder=`（约 240 处）。
- `file+/*.pdf.tsx` 路由（服务端 PDF，完全未本地化，需在 PDF 渲染处接入 catalog）。
- `throw new Error("...")` 与 toast 文案散落各处。

## 五、复杂装配测试数据

### 数据模型概览

Carbon 的多层 BoM 不是单表，而是三表图：

- `makeMethod`：每个制造件（`replenishmentSystem='Make'` 的 Part）一个，带版本（Draft/Active/Archived）。**插入 item 时由触发器自动创建**（migration `20260410031802_item-interceptors.sql`）。
- `methodMaterial`：BoM 行项（子件）。**嵌套边**靠 `materialMakeMethodId → makeMethod.id` 自连接。
- `methodOperation`：工艺路线/工序（可选）。
- 递归 CTE `get_method_tree(uid TEXT)` 展开整棵 BoM 树（`uid` 是**顶层 makeMethod.id**，不是 item id）。

### seed-assembly.ts（3 层嵌套装配）

新增 `packages/database/src/seed-assembly.ts`，构造一棵精密减速电机总成的 3 层 BoM：

```
L2  ASM-TOP-001  精密减速电机总成  (Make, Serial)
├── L1  ASM-SUB-A  齿轮箱组件  (Make to Order → Make)
│     ├── L0  ASM-LEAF-001  深沟球轴承  ×4  (Buy)
│     ├── L0  ASM-LEAF-002  传动齿轮    ×2  (Buy)
│     └── L0  ASM-LEAF-003  箱体铸件    ×1  (Buy)
├── L1  ASM-SUB-B  电路板组件  (Make to Order → Make)
│     ├── L0  ASM-LEAF-004  控制芯片    ×1  (Buy)
│     └── L0  ASM-LEAF-005  电容阵列    ×6  (Buy)
├── L0  ASM-LEAF-006  电机定子  ×1  (Buy)   ← 顶层直接子件
└── L0  ASM-LEAF-007  电机转子  ×1  (Buy)   ← 顶层直接子件
```

- `Make to Order` 子件（SUB-A/SUB-B）的 `methodMaterial.materialMakeMethodId` 指向其自身 makeMethod，构成嵌套边。
- `Buy` 叶子的 `materialMakeMethodId` 为 NULL。
- seed 末尾用 `get_method_tree` 验证树展开为 **9 条边**（4 顶层 + 3 齿轮箱 + 2 电路板），覆盖全部 10 个 item。

### 灌入测试数据

```bash
# 先确保栈已起、迁移已跑（crbn up）
# 灌基础环境（用户/公司/账套/默认库位）+ 装配 BoM
pnpm run db:seed:dev -- --email dev@carbon.local --assembly
# 登录密码：password（DEV_PASSWORD）

# 也可同时灌打印测试数据：
pnpm run db:seed:dev -- --email dev@carbon.local --printing --assembly
```

成功输出示例：

```
9. Seeding multi-level assembly test data...
  Seeding multi-level assembly test data...
   BoM tree for ASM-TOP-001 exploded to 9 edges (expected 9: ...).
   Multi-level assembly seed complete.
```

### 验证 BoM 结构（SQL）

```sql
-- 在 Studio 或 psql 中（连 SUPABASE_DB_URL）
-- 1. 查看顶层装配的 makeMethod
SELECT id, version, status FROM "makeMethod"
WHERE "itemId" = (SELECT id FROM item WHERE "readableId" = 'ASM-TOP-001');

-- 2. 展开整棵 BoM 树（传 makeMethod.id）
SELECT "itemReadableId", quantity, "methodType",
       "parentMaterialId" IS NOT NULL AS is_child
FROM get_method_tree('<顶层 makeMethod id>');

-- 3. 直接看某层的子件
SELECT mm."itemId", i."readableId", i.name, mm.quantity, mm."methodType"
FROM "methodMaterial" mm
JOIN item i ON i.id = mm."itemId"
WHERE mm."makeMethodId" = '<某 makeMethod id>';
```

## 六、测试运行

### MRP BoM 爆破引擎单测（纯 TS，无 DB）

`packages/database/supabase/functions/lib/mrp-engine.test.ts` 覆盖复杂装配的 MRP 爆破逻辑：

```bash
# 直接用 vitest 跑（database 包无 test 脚本，用根 vitest bin）
node "$(ls node_modules/.pnpm/vitest@4.1.6_*/node_modules/vitest/vitest.mjs | head -1)" \
  run packages/database/supabase/functions/lib/mrp-engine.test.ts
```

覆盖用例（11 个）：

- `splitKey`/`makeKey` 往返、含连字符的 itemId。
- `computeLowLevelCodes`：3 层嵌套的层级赋值（根 0 / 子件 1 / 叶 2）；循环 BoM（A→B→A）不无限递归。
- `explodeBom`：10 单顶层需求按 qty 正确分解到各叶；on-hand 抵扣只传播净需求；job supply 抵扣；提前期按周提前；MTO+Make 子件跳过 bomDerivedDemand（避免子单重复计）；Buy 件不爆破；Buy-and-Make 折叠为 Buy。

### 各 package 单测

```bash
pnpm --filter @carbon/form --filter @carbon/kv --filter @carbon/documents test
# 或全部：pnpm test   （turbo run test，只跑有 test 脚本的 package）
```

### ERP 应用单测

```bash
cd apps/erp
set -a && source ../../.env.local && source ../../.env && set +a   # 加载 env（@carbon/env 在 import 时校验必需变量）
./node_modules/.bin/vitest run
```

> **已知预先存在的失败（非本次改动引入）**：
> - `accounting.utils.test.ts` 的 `getLastDayOfMonth`/`getNextPeriodEnd`（5 个）：日期计算 bug，2 月末/跨年计算少一天。属项目原有待修。
> - `test/i18n-react-macros.test.ts`：列出 ~210 个 route 文件仍用 `msg\`\`` breadcrumb 宏（历史迁移债务）。
> - `test/localized-submodule-ui.test.ts`：sales 模块表仍有 raw 字符串（本次未覆盖 sales，属后续工作）。

## 七、构建生产包

```bash
pnpm build:erp     # turbo 会先跑 lingui:compile，再 react-router build
# 产物：apps/erp/build/
# 实测：✓ built in ~44s
```

构建会自动编译汉化 catalog，确保 `.mjs` 就位。构建本身**不调用外部服务**（Supabase/Redis/Stripe 客户端都是惰性构造），但 `@carbon/env` 在 import 时校验 `SESSION_SECRET`/`SUPABASE_*`/`REDIS_URL` 等必需变量——须有 `.env.local`。

## 八、端到端冒烟验证

1. 启动栈 + ERP dev server：`crbn up --no-portless`（选 ERP）。
2. 浏览器打开 `http://localhost:<PORT_ERP>`（端口见 `crbn status`）。
3. 用 `dev@carbon.local` / `password` 登录。
4. 右上角头像 → Language → 中文：确认界面切换为中文（会计表头、错误页等）。
5. 进 **物料** 模块，搜索 `ASM-TOP-001`：查看精密减速电机总成。
6. 进其 **BoM** 标签：确认 3 层结构（齿轮箱组件/电路板组件/电机定子/电机转子）。
7. 进 **MRP** 或生产计划：确认能基于该 BoM 爆破需求。

## 九、常见问题

### Q1: `pnpm install` 因 supabase postinstall 失败

supabase CLI 的 postinstall 从 GitHub 下载平台二进制，国内镜像源 SSL 校验易失败。已在 `package.json` 的 `pnpm.onlyBuiltDependencies` 移除 `supabase`（crbn 用 Docker 内的 CLI）。若仍报错，确认 `package.json` 中 `pnpm.onlyBuiltDependencies` 数组不含 `supabase`。

### Q2: `crbn up` 卡在 "Boot shared redis" / 镜像拉取超时

镜像源限流。对策：

- 配置 `~/.docker/daemon.json` 的 `registry-mirrors` 为更稳定的源，重启 Docker。
- 用耐心重试脚本（每镜像 20 次重试）。
- 镜像拉完后再次 `crbn up` 会跳过 pull 直接 boot。

### Q3: 切换中文后界面仍部分英文

- 确认 `pnpm lingui:compile` 已生成 `packages/locale/locales/zh/{erp,mes}.mjs`（缺失则静默回退英文）。
- 部分英文是**未被 lingui 宏包裹的硬编码字符串**（见"待办"），需用 `t\`\``/`<Trans>` 包裹并补译。

### Q4: ERP 测试报 `@carbon/env` 变量未设置

ERP 测试 import 链会触发 `@carbon/env` 在模块加载时校验 `SESSION_SECRET`/`SUPABASE_DB_URL`/`REDIS_URL` 等。运行前必须 `source .env.local && source .env`。

### Q5: `get_method_tree` 返回 0 行

传入参数是**顶层 makeMethod.id**，不是 item.id。用 `SELECT id FROM "makeMethod" WHERE "itemId" = (...)` 先取 makeMethod id。

### Q6: Windows 原生 cmd / PowerShell 无法跑 crbn

`crbn` / `setup.sh` 是 POSIX 脚本。Windows 须用 **Git Bash (MINGW64)** 或 **WSL**。`uname -s` 应返回 `MINGW*`/`MSYS*`/`Linux`。
