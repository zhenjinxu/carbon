# Obsidian AI 知识约束试点研究

> 研究日期：2026-08-04
> 研究边界：只核对候选项目官方 GitHub 仓库的 README、manifest 和仓库元数据；不安装插件、不运行候选服务、不连接外部图数据库。

## 结论摘要

MegaMem 最适合做 Carbon 的小范围检索试点：它同时提供 Obsidian 插件、时序知识图谱、可配置实体/边类型和 MCP。但它的本体主要用于 AI 抽取和 Pydantic 模型生成，不是 SHACL/OPA 级别的强制约束；其 MCP 默认能力包含写笔记、移动/删除文件和 `clear_graph`，必须采用工具白名单。

AILSS 的默认安全边界更接近 Carbon 的要求：读取工具默认可用，写入工具需要环境开关并且每次带 `apply=true`。不过仓库仍处于早期阶段，GitHub 仓库元数据没有声明许可证，不能直接作为 Carbon 的长期依赖。

Onto Tracker 更像本体驱动的文件分类/元数据映射工具，README 只承诺 Heurist 本体格式和映射规则，没有发现 MCP 能力。`green-dalii/obsidian-llm-wiki` 对源笔记保持只读，只在 `wiki/` 下生成页面，适合知识整理，但它明确说明自定义词汇只是 LLM 提示，不是写入强制门；README 未显示 MCP 服务器。

## 候选比较

| 候选 | 已核实能力 | 安全/约束边界 | 对 Carbon 的判断 |
|---|---|---|---|
| [MegaMem](https://github.com/C-Bjorn/MegaMem) | Obsidian 插件；Graphiti 时序图；Neo4j/FalkorDB；多库/多 Vault；自定义实体、边和属性；MCP | README 列出 23 个图/文件工具，包含读、写、删除和 `clear_graph`；自定义 ontology 生成抽取模型，不等同于硬校验；MIT | 首选隔离试点，必须只开读工具、只用副本、只连 localhost |
| [AILSS](https://github.com/maehwasoo/AILSS) | 本地 SQLite 索引；本地 HTTP MCP；typed links；读取上下文、搜索、校验、断链检查 | 默认只读；写工具要求 `AILSS_ENABLE_WRITE_TOOLS=1` 且 `apply=true`；仓库元数据未声明 license | 可作为安全对照组，不作为首期主方案 |
| [Onto Tracker](https://github.com/jdchart/onto-tracker) | Obsidian 中展开本体；按 MIME 类型和映射规则写入元数据；支持 Heurist 本体 | README 的待办仍包含其它本体格式；未发现 MCP 或 AI 抽取服务；MIT | 不满足 AI 检索入口，暂不采用 |
| [Karpathy LLM Wiki](https://github.com/green-dalii/obsidian-llm-wiki) | Obsidian 内生成 entity/concept/wiki 页面；`[[wiki-links]]` 图检索；多模型；源文件只读 | 原笔记不改，只写 `wiki/`；自定义 tag vocabulary 明确是 schema injection hint，不是 enforcement gate；Apache-2.0；未发现 MCP | 可作为后续本地知识整理对照，不承担 Carbon 约束 |

## 研究依据

### MegaMem

官方 README 将其定义为 Obsidian 与 Graphiti 时序知识图谱的 MCP 插件，支持 Neo4j 或 FalkorDB、多个命名数据库、自定义 ontology 以及 Obsidian CLI 文件工具。manifest 当前显示 `1.7.6`、桌面端插件、MIT 许可。README 的工具表同时列出 `read_obsidian_note`、`search_obsidian_notes`、`explore_vault_folders`、`clear_graph`、创建/管理/删除类文件工具。此能力组合决定了试点必须把“插件可访问的 Vault”换成副本，并在 MCP 层做 allowlist。

### AILSS

官方 README 将 Vault 作为事实源，将索引写入 `<Vault>/.ailss/index.sqlite`，并通过本地 HTTP MCP 服务提供读取工具。写工具单独列出，并要求 `AILSS_ENABLE_WRITE_TOOLS=1` 与 `apply=true`。这证明“默认只读 + 显式应用”是可行的安全模式，但其仓库元数据当前没有 license 字段，Carbon 不应在未完成法务和维护评估前引入。

### Onto Tracker

官方 README 的核心流程是加载本体、展开到 `ontos/`，再通过 `mappings/` 文件按 MIME 类型写入类别。README 说明当前只支持 Heurist 格式，并未展示 MCP、时序图或 AI 抽取接口。因此它更适合作为本体文件管理参考，不适合作为 Carbon AI 上下文层。

### Karpathy LLM Wiki

官方 README 说明插件不修改原始笔记，只在 `wiki/` 目录写生成内容；它使用 `[[wiki-links]]` 和 Personalized PageRank 进行检索，不依赖向量数据库。README 同时明确指出自定义 tag vocabulary 只是注入提示，小模型仍可能漂移，Lint 只能发现问题。这个边界与 Carbon 的结论一致：LLM/插件负责召回和整理，数据库、静态检查、LinkML/SHACL/OPA 和测试负责拒绝非法状态。

## 对 Carbon 的设计影响

1. Obsidian 规范、源码、迁移和测试仍是事实源；图谱只是带来源的检索副本。
2. 首期不把任何候选的 ontology 当成合并前、迁移前或生产权限校验。
3. 试点必须将源 Vault 复制到专用目录，原 Vault 以只读方式保存并做 hash 快照。
4. MCP 采用本机 stdio 或绑定 `127.0.0.1` 的 HTTP；只允许搜索、读取、列目录、图查询，拒绝写笔记、移动/删除、建目录和 `clear_graph`。
5. 机器约束单独建模：LinkML 描述实体/字段，SHACL 或等价检查描述关系约束，OPA/SQL/TypeScript 测试继续作为发布门。
6. 研究阶段只提交文档；任何插件、Neo4j/FalkorDB、Python bridge 或 MCP 配置变更都必须经过明确批准。
