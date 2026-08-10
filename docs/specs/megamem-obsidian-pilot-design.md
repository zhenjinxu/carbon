# MegaMem 隔离只读试点设计

## Summary

本试点验证 MegaMem 是否能为 Carbon 开发提供“带来源的语义检索和关系发现”，同时不改变 Carbon 的事实源、工程约束或用户数据。试点只处理 Carbon Obsidian Vault 的一份脱敏副本，图数据库只运行在本机隔离网络，MCP 只暴露读和搜索能力。试点不安装到生产 Vault，不写入原始笔记，不把 MegaMem ontology 当作权限、迁移、类型或发布门。

## Research

研究依据见 [`llm/research/megamem-obsidian-pilot.md`](../../llm/research/megamem-obsidian-pilot.md)。关键发现：

- MegaMem 提供 Graphiti 时序图、自定义实体/边和 MCP，但工具表同时包含写文件、移动/删除和 `clear_graph`。
- AILSS 默认只读且写入需要显式 `apply`，适合作为安全对照，但当前仓库没有声明许可证。
- Onto Tracker 主要做 Heurist 本体展开和 MIME 映射，没有核实 MCP。
- Karpathy LLM Wiki 对源笔记只读、只写 `wiki/`，但自定义词汇明确不是强制校验。

## Scope and non-goals

### In scope

- 以 Carbon 项目文档验证实体、关系、时间线和来源回溯。
- 评估 MegaMem 的本地部署、抽取稳定性、检索质量、延迟和工具权限边界。
- 建立一份与 MegaMem 解耦的约束样例，用来证明哪些规则必须由 LinkML/SHACL/OPA/SQL/测试执行。
- 形成是否扩大试点、转向 AILSS 或停止使用的证据。

### Out of scope

- 不连接 Carbon PostgreSQL、Supabase、U8、WodiMES、Redis、生产 MCP 或远程图数据库。
- 不把源码、密钥、`.env`、客户/员工数据、数据库导出或生产日志放进试点 Vault。
- 不修改原始 Obsidian 笔记、`.obsidian` 配置、Carbon 源码、数据库迁移或权限。
- 不启用 MegaMem 的写工具、`clear_graph`、文件管理工具、Streamable HTTP 远程访问或 Tailscale。
- 不以图谱查询结果直接触发代码修改、数据库迁移、权限变更或部署。

## Design decisions

### 1. 事实源与副本

**Question:** 图谱是否可以直接读取规范 Vault？

**Evidence:** MegaMem 的文件工具能够读取和写入 Vault；同步过程还会生成本地图和分析状态。

**Our approach:** 原始目录 `E:\AI_Project_Vault\项目开发\Carbon` 只作为 hash 快照输入。执行目录使用独立副本，例如 `D:\Object\carbon\.codex\work\megamem-pilot\vault`，副本只包含批准的 Markdown 文件。每次重建先删除并重建副本，不对原目录执行任何写操作。副本和图数据库均标记为临时试验资产，报告完成后可整体移除。

### 2. 试点样本

首期固定 15 篇文档：Carbon 摘要、项目背景、功能框架、基本功能、技术框架、基础数据结构与数据库、用例说明、开发规范、本地登录说明、U8 工单管理与生产仪表盘实施计划、WodiMES-导入计划、Carbon项目，以及项目管理目录中的里程碑、风险、决策各一篇。若某篇包含真实凭据、个人信息或未公开连接信息，先排除并在样本清单记录原因，不临时扩大范围。

### 3. 图数据库与网络

MegaMem 支持 Neo4j/FalkorDB。首期只允许一个本机容器和一个临时命名卷，图数据库端口只绑定 `127.0.0.1`，不加入 Carbon Compose 网络，不暴露到局域网或互联网。MCP 首选本机 stdio；若必须使用 HTTP，只绑定 `127.0.0.1` 并生成一次性 bearer token。禁止云图数据库、Tailscale 和远程客户端。

### 4. MCP 工具白名单

允许的能力只包括：列出注册 Vault/组、浏览目录、搜索笔记、读取笔记、搜索图节点/事实和查看关系。具体工具名以安装版本的官方清单为准，并在启动前写入 allowlist。默认拒绝任何 create/edit/delete/move/copy/manage folder/sync、`add_memory`、`clear_graph` 和未知工具。拒绝不是靠提示词，而是由 MCP 客户端配置和一组负向测试共同证明。

### 5. Ontology 与硬约束分层

MegaMem ontology 只定义抽取语义，不承担 Carbon 合规。试点使用以下概念作为抽取目标：

| 类型 | 示例关系 | 来源 |
|---|---|---|
| `CarbonProject` | `hasMilestone`, `hasRisk`, `hasDecision` | 项目页和项目管理页 |
| `CarbonStandard` | `constrains`, `requiresEvidence` | 开发规范 |
| `CarbonModule` | `implements`, `dependsOn` | 功能框架、技术框架 |
| `CarbonMigration` | `changes`, `verifiedBy` | 迁移/验收记录 |
| `CarbonSourceEvidence` | `supports`, `contradicts` | 代码、测试、日志引用 |
| `CarbonRisk` / `CarbonDecision` / `CarbonMilestone` | `mitigatedBy`, `supersedes`, `blocks` | 项目管理页 |

下列规则必须由独立校验器执行：

- 每个风险、决策、里程碑必须指向一个已知 Carbon 项目。
- 规范、迁移、测试和运行证据的引用必须可解析到文件和标题。
- 决策日期、里程碑状态和风险状态必须符合枚举和日期格式。
- 已废弃或被 supersede 的决策不得作为当前规范唯一依据。
- 任何“代码必须”“迁移必须”“不得写入”等约束必须有可定位的规则 ID 和验证命令。

LinkML 负责字段/枚举模型，SHACL 或同等图检查负责关系约束，OPA/SQL/TypeScript 测试继续负责发布和数据库边界。图谱通过校验器失败时只报告问题，不自动改笔记。

## Workflows

### A. 预检与快照

1. 记录原始 Vault 文件相对路径、大小、SHA-256 和修改时间。
2. 扫描凭据模式、`.env`、私钥、JWT、邮箱和大段日志；发现命中则排除，不上传。
3. 将固定样本复制到隔离目录，复制后重新计算 hash。
4. 记录插件版本、Obsidian 版本、图数据库镜像 digest、模型提供方和配置摘要（不记录密钥）。

### B. 只读同步

1. 在副本 Vault 上运行 MegaMem 同步。
2. 关闭自动同步和远程 HTTP；同步只针对固定目录。
3. 保存同步计数、失败文件、实体/边数量和耗时。
4. 将抽取结果视为候选数据，不回写原文或 Carbon 仓库。

### C. 检索评估

准备 20 个固定问题，覆盖规范、模块依赖、U8 导入边界、生产迁移决策、风险责任和时间线。每个问题要求返回：答案、来源文件、标题/行号或等价定位、置信度。评估人员用已知答案表标记正确实体、关系、时间和来源。

### D. 约束评估

准备合法和非法 frontmatter/关系夹具。先运行 LinkML/SHACL/OPA/测试，再把同一内容交给 MegaMem 抽取。比较：

- 独立校验器是否 100% 拒绝非法夹具。
- MegaMem 是否能把约束关联到正确来源。
- 当图谱抽取错误时，发布门是否仍然失败而不是被图谱结果绕过。

### E. 关闭与回滚

停止插件和图容器，导出只包含统计和错误摘要的报告，删除副本 Vault、图数据库卷、token 和临时日志。重新计算原始 Vault hash，确认与预检完全一致。若任一步发现原 Vault、Carbon Compose 网络或外部地址被访问，立即停止并删除所有试点运行资产。

## Acceptance criteria

| 类别 | 通过条件 |
|---|---|
| 源完整性 | 试点前后原始 Vault 文件列表和 SHA-256 100% 相同 |
| 隔离 | 图数据库只监听 localhost；Carbon 数据库、Compose 网络和外部地址无连接 |
| 样本 | 15 篇批准文档全部可追溯，排除项有记录，零凭据命中 |
| 检索 | 20 个固定问题中至少 18 个返回正确实体/关系，并且每个答案带可定位来源；P95 < 3 秒（本机冷启动除外） |
| 时间语义 | 关键里程碑/决策的日期和 supersede 关系无遗漏；不允许把文件修改时间当业务日期 |
| 约束 | 100% 非法夹具被 LinkML/SHACL/OPA/测试拒绝；MegaMem 误抽取不能让校验器通过 |
| 写保护 | MCP 写工具不可见或全部拒绝；试点前后副本和原始笔记内容不变，`clear_graph` 不可调用 |
| 可复现 | 同一 hash 快照在相同版本配置下重跑，实体/边计数和失败清单在允许的模型非确定性范围内可解释 |
| 可运维 | 可记录版本、配置、耗时、失败文件和清理结果；无秘密进入报告、日志或图数据 |

## Edge cases and stop conditions

- 同一项目存在中英文标题、别名或旧文件名时，必须保留来源 ID，不以名称覆盖。
- 规范更新但图同步延迟时，查询结果必须显示来源日期或同步批次，不能声称实时。
- 一个实体被多个公司或客户文档提及时，首期直接排除跨租户业务数据，避免把名称相似当成同一实体。
- Markdown frontmatter 缺失、重复字段、无效日期和循环关系进入负向夹具，不由模型“猜测修复”。
- 模型、插件或图数据库尝试访问外网、写原始 Vault、连接 Carbon 服务、创建未知 MCP 工具或无法给出来源时，试点立即停止并判定失败。

## Rollout decision

- **继续扩大：** 所有 acceptance criteria 通过，且两次独立重跑结果可解释。
- **换用 AILSS：** 需要更严格的默认只读和本地索引、但 MegaMem 的抽取/部署成本无法接受时，复用同一问题集和约束夹具比较。
- **停止：** 任何源完整性、网络隔离、写保护或硬约束门失败；不以检索效果抵消安全失败。

本规格只描述方案和验收门。除非用户明确批准“安装并运行隔离试点”，否则不执行下一阶段。
