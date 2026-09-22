# Carbon AI Coding Instructions

Before analyzing or changing Carbon:

1. Read `../AGENTS.md`.
2. Read the canonical Carbon development standard at `E:\AI_Project_Vault\项目开发\Carbon\Carbon 开发规范.md`.
3. Query the relevant `../llm/cache/` files before source, then load the applicable `../llm/conventions/`, `../llm/workflows/`, and `../llm/tasks/lessons.md`.
4. Verify technical facts against current package files, configuration, migrations, generated types, and committed source. Do not copy outdated commands from prose documentation.
5. Preserve unrelated working-tree changes. Do not commit, push, clean, rebuild the database, or perform destructive/external operations unless the user explicitly requests them.
6. Treat generated code and AI output as untrusted until types, validation, permissions, tenant isolation, transactions, tests, and behavior have been reviewed.
7. When a verified recurring issue yields a general rule, update the canonical Obsidian standard and its change log. Do not add speculative or task-specific rules.

If the Obsidian file is unavailable, follow `../AGENTS.md` and the repository-local guidance above, then disclose that the canonical standard was not checked.
