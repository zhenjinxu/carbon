# Lessons

Patterns learned from corrections. Review at the start of each session.

## `*.picking-list.dev` is the LOCAL dev server (crbn + portless)

- The domains `erp.picking-list.dev`, `mes.picking-list.dev`, `api.picking-list.dev`, and `mail.picking-list.dev` (Inbucket) are **not** a remote/preview deployment. They are the **local** dev server that the `crbn` dev CLI spins up for the branch and exposes via **portless** (which maps the branch's local dev processes to those domains).
- Consequence: the site reflects the **current working tree** with HMR. Uncommitted local edits are live there after a reload — **do NOT commit/push to "deploy" for testing**. Just reload the page. (Respect the no-auto-commit rule for everything else.)
- The local dev DB is already migrated/seeded by `crbn up`, so feature migrations are applied there (but still don't rebuild the DB yourself — wait for the user).
- Auth on these domains uses the real magic-link flow: submit the email at `erp.<...>.dev/login`, fetch the link from Inbucket at `mail.<...>.dev` (API: `GET /api/v1/mailbox/<mailbox>` then `/<mailbox>/<id>`), visit the `api.<...>.dev/verify?...` URL (decode `&amp;` → `&`).

## Postgres NUMERIC comes back as a STRING in edge functions — coerce before `+`

- In the Deno/Kysely edge functions (e.g. `post-picking`, `post-stock-transfer`), a NUMERIC column read via `selectAll()` is a **string**, so `(line.quantityPicked ?? 0) + quantity` does **string concatenation** (`"0.0000" + 4 = "0.00004"`), which then rounds to `0.0000` when written back to `NUMERIC(12,4)` — silently losing the value. Symptom: the action "succeeds" and side effects (ledger moves, status) happen, but the quantity column stays ~0 so the UI looks unchanged ("button does nothing"). Always `Number(...)` numeric columns before arithmetic. Subtraction (`-`) coerces and is safe; only `+` concatenates.
- Local Supabase `functions serve` hot-reloads edited edge functions, but can take ~5–10s — re-test after a short wait before concluding the code didn't change.

## Picking list: inclusion + source are relative to the operation's work center

- A job material needs picking **unless it is already staged at the operation's OWN work center lineside**. Decide this by **actual on-hand at the op's work-center lineside bin**, NOT by where `jobMaterial.storageUnitId` points. That field is the recorded *source* shelf; comparing its `get_effective_work_center_id` to the op's `workCenterId` answers the wrong question and misses parts that are line-stocked at the op's WC while the jobMaterial still points at the warehouse/another line (real miss: PL000015, Assembly 2, P000000001 had 9 on-hand at A2 but was still added). Correct rule: resolve the op's lineside bin (default first, else oldest — mirrors `get_or_create_work_center_lineside`), sum its `itemLedger` on-hand, and skip when `lineside_on_hand >= quantityToIssue`. Fixed in both `get_picking_schedule` (SQL, LATERAL join) and `generatePickingList` (`getItemOnHandByStorageUnit`). Open follow-up: partial-stock still picks the full qty, not just the shortfall.
- A pick's **source** must be a WAREHOUSE (non-lineside) bin resolved by on-hand — never another work center's lineside bin (don't "rob" another line; matches SAP/Epicor). If no warehouse stock exists, the line is generated with a null source and shows a yellow `⚠ NO STOCK` badge + tooltip in the source column — but **Pick stays enabled**: a kitter can pick material the system shows no stock for (counts are often wrong), and on-hand simply goes negative at the source until reconciled. Only the lineside destination is required server-side; a null source is allowed. See `resolveWarehouseSource` and `llm/research/picking-list-source-resolution.md`.

## MES uses `size="lg"`, ERP uses `size="md"`

- Sized components (`Button`, `NumberControlled`/form inputs, `ItemThumbnail`, modal buttons, etc.) follow an app-level size convention: in **MES** (`apps/mes`, shop-floor touch UI) **always** use `size="lg"`; in **ERP** (`apps/erp`, desktop) **default to** `size="md"`.
- When converging UI that exists in both apps (e.g. the picking-list line components / `ShortPickModal`), do **not** copy sizes verbatim — the MES copy gets `lg` on every sized control, the ERP copy gets `md`.
- A **shared** component in `@carbon/react` used by both apps must **not hard-code** a size — expose a `size?: "md" | "lg"` prop (default `"md"`) and apply it to every inner input/button, so ERP renders default and MES passes `size="lg"`. (Done for `TrackedEntityPicker`.)

## Never wrap `<Enumerable>` in a `<Badge>`

- `Enumerable` already renders its value as a styled chip/badge. Wrapping it (`<Badge><Enumerable .../></Badge>`) double-wraps and looks wrong. Use `<Enumerable value={...} />` directly (e.g. in a `CardDescription` or inline). If you just need a plain badge for non-enumerable text, use `<Badge>` alone.

## No parentheses around numbers in the UI

- Don't wrap counts/numbers in parentheses in UI labels (e.g. `Generate Picking List (3)` or `2/5 (40%)`). The user dislikes this style. Show the number plainly or with a separator instead: `Generate Picking List 3`, `2/5 · 40%`. (Note: some existing components like KanbansTable use `(n)` — don't copy that pattern into new UI.)

## Flat-route parent must render `<Outlet/>`

- In the dot-style flat routes (`apps/*/app/routes/x+/`), a file like `picking.tsx` becomes the **parent layout** of `picking.$pickingListId.tsx`. If `picking.tsx` renders page content (a dashboard) with **no `<Outlet/>`**, the child route silently never renders — navigating to `/x/picking/<id>` shows the parent's content instead. Fix: make `picking.tsx` a pure layout (`<Outlet/>`) and move the index content to `picking._index.tsx`. (Hit this on the MES picking execution route.)

## `issue` edge function: "Set Quantity" reverses consumption cleanly

- To un-issue / reverse a job-material consumption, call `issue` `partToOperation` with `adjustmentType: "Set Quantity"` and `quantity = targetIssued`. "Set Quantity" issues the **delta** (`target - quantityIssued`) and writes the **opposite-signed** Consumption ledger entry, so the same call handles pick (increase) and unpick (decrease/reverse) symmetrically. "Positive Adjmt." is NOT a reversal (it still increments quantityIssued). Used in picking's `setPickingListLineQuantity`.

## RLS Policies

- **NEVER** use the old `has_role('employee', "companyId") AND has_company_permission(...)` RLS pattern. It is deprecated.
- **ALWAYS** use the new pattern with `get_companies_with_employee_permission()` helper function and standardized policy names ("SELECT", "INSERT", "UPDATE", "DELETE").
- Reference migration: `20250201181148_rls-refactor.sql`
- Correct pattern:
  ```sql
  CREATE POLICY "SELECT" ON "public"."tableName"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('module_view'))::text[]
    )
  );
  ```
## Event-system interceptors (Carbon-specific)

- Carbon uses `attach_event_trigger(table_name, BEFORE[], AFTER[])` defined in `20260116215036_event_system_impl.sql` / `20260410030406_event-system-after-interceptors.sql`, not plain Postgres triggers. Each call **DROPs and re-CREATEs** the event trigger — so when adding interceptors to a table that already has some registered, the new call must include every existing interceptor plus the new ones, otherwise the old ones silently detach. Grep `attach_event_trigger('<table>'` across migrations to find the latest registration and merge arrays.
- Interceptor functions take `(p_table TEXT, p_operation TEXT, p_new JSONB, p_old JSONB) RETURNS VOID`. Short-circuit early on operations that don't apply (`IF p_operation <> 'UPDATE' THEN RETURN; END IF;`). `RAISE EXCEPTION` to block; `RETURN` silently to skip.

## Identifiers over free text

- When a field names another record ("the operation that triggers shelf life"), store it as a foreign-key ID (`processId`) rather than a string description. Typo-proof, rename-safe, and the DB enforces existence. The first cut of shelf-life matched against `jobOperation.description` — the user flagged it as a caveat; switching to `processId` removed the fragility without changing the UX (a combobox lets the user create/pick a process by name).

## "Presence of a row = feature enabled"

- When a feature is opt-in per item (or per company, per whatever), don't encode the opt-in state as a `mode = 'NotManaged'` value on the parent table. Use a side table keyed by the parent's id; absence of a row = not enabled. Cleaner queries (no `WHERE mode <> 'NotManaged'` plumbing), narrower parent table, CHECKs on the side table can be tighter (no need to permit NULL fields for the "not enabled" case).
- Applied to `itemShelfLife` — started on `item` with a 3-value enum and two conditional fields; refactored to a side table with a 2-value enum where absence means the third case.

## Upsert helpers must not clobber on partial submits

- A single server action can receive form data from multiple different forms (different UIs posting to the same `$id.details.tsx`). If the upsert helper treats `undefined` as "clear the row", any form that doesn't include the field silently deletes data. Rule:
  - `undefined` -> no-op (form didn't opine, leave it alone)
  - explicit sentinel like `'NotManaged'` -> clear (user explicitly opted out)
  - real value -> upsert
- The Zod validator's `.default("SomeValue")` can defeat this: a missing form field gets the default, which is then passed as an explicit value to the helper. Mark the field `.optional()` instead and gate defaults on the form's `initialValues`.

## `.merge()` breaks after `.refine()`

- Zod's `.refine()` returns a `ZodEffects`, which is no longer a `ZodObject` — so downstream `.merge(...)` calls fail with a type error. When a base object needs to be shared across several validators AND have refines, keep the raw `z.object()` exported for merging and apply the refines in a helper applied to each merged child validator. See `applyStorageAndShelfLifeRefines` in `items.models.ts`.

## Supabase upsert with `onConflict` clobbers audit fields

- `.upsert({ createdBy, updatedBy, ... }, { onConflict: "itemId" })` sets both `createdBy` and `updatedBy` via `ON CONFLICT DO UPDATE SET ... = EXCLUDED....`, which overwrites `createdBy` on every update. When audit semantics matter, do an explicit `SELECT ... maybeSingle()` + branch on existence: `INSERT` sets `createdBy`, `UPDATE` sets `updatedBy`/`updatedAt`. `upsertItemShelfLife` follows this pattern.

## ERP app has no vitest infrastructure

- `apps/erp` has no vitest config and no tests. Adding unit tests for validators there requires setting up vitest + mocking the supabase client — not a 5-minute job. If a task says "add validator tests", the estimate should include test-infrastructure setup unless `packages/*` (which does have vitest) is the right home for the pure function.

## Use `accountId` not `accountNumber`

- The codebase has migrated from `accountNumber` to `accountId` for GL account references. The old `accountNumber`-based foreign keys in the DB schema (e.g., on `purchaseOrderLine`, `purchaseInvoiceLine`) are from older migrations — current code uses `accountId`. Always use `accountId` when referencing GL accounts.

## Do not commit without being asked

- Never create git commits unless the user explicitly asks to commit. Stage and commit only on request. The user wants to review changes before committing.

## Bash fallbacks when tools are missing

- `pandoc` is not on the user's machine. For `.docx` extraction, use the `anthropic-skills:docx` skill's `unpack.py` (needs `defusedxml`; install via `mise x python@3.14.2 -- pip install defusedxml`) or an equivalent Python/JS extraction, rather than assuming pandoc is available.

## Verify which component a callsite actually renders before calling it "broken"

- When auditing a shared component's callsites, confirm the JSX tag resolves to
  the import you think it does. A name like `<StorageUnit>` can be a *local*
  function in the same file (ShipmentLines defines its own `StorageUnit` over
  `useStorageUnits` + `Combobox`), not the shared shim. I wrongly concluded the
  shim was "broken" and edited the callsite, breaking the type (`storageUnit`
  was a `string` there, not `ListItem`).
- Rule: before claiming a callsite is broken or changing its `onChange` shape,
  grep the file for a local `function <Name>` / `const <Name> =` shadowing the
  import, and check the actual prop/callback types at that callsite.

## Deno/Edge Runtime uses `rustls`, not OpenSSL — Node.js SSL env vars don't work

- **`SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS`** are Node.js/OpenSSL conventions. Deno uses Rust's `rustls`, so these are silently ignored.
- **`DENO_TLS_CA_STORE`** only accepts `"system"` or `"mozilla"` — NOT file paths. Setting it to a path does nothing useful.
- **Custom CA certs in Deno** require the `--cert=<file>` flag on the command line, not environment variables.
- **PowerShell quirk**: `$env:HOME` is not set by default in PowerShell. Tools expecting `HOME` (like path resolution for `${HOME}/.dev-sidecar/...`) fail silently. Fix: `$env:HOME = $env:USERPROFILE`.
- **Symptoms**: SSL errors like `invalid peer certificate: UnknownIssuer` in Edge Runtime containers.
- See `llm/cache/edge-runtime-ssl-fix.md` for the full root-cause chain and fix.

## Never leave debug `console.log` statements in auth/session code

- When debugging auth/session issues (file uploads, permission problems, etc.), it's tempting to add `console.log` to `requirePermissions`, `requireAuthSession`, `verifyAuthSession`, `useUser`, `usePermissions`, layout loaders, etc. **Remove them before finishing the task.**
- **Why**: These functions run on EVERY request/render. Debug logging causes:
  1. Excessive console output that floods the terminal
  2. Performance degradation (especially in hooks that run on every render)
  3. **Stack buffer overrun crashes** (Windows exit code 3221226505 / 0xC0000509) from memory pressure or Node.js console buffer overflow
- **Symptoms**: Dev server crashes with `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command failed with exit code 3221226505` after showing many `[requirePermissions] Claims:` or similar debug logs.
- **Rule**: If you add debug logging, either (a) remove it when done, or (b) gate it behind `if (process.env.DEBUG_AUTH)` so it's opt-in.
- **Files to check**: `packages/auth/src/services/auth.server.ts`, `session.server.ts`, `apps/erp/app/hooks/useUser.tsx`, `usePermissions.tsx`, `apps/erp/app/routes/x+/_layout.tsx`, `RealtimeDataProvider.tsx`.

## Layout loader 中 `getUser()` 必须使用 `getCarbonServiceRole()`，不能用用户 JWT client

- **根因**：user 表的 RLS 策略会阻止用户用自己的 JWT 查询自己的数据。`getCarbon(accessToken)` 创建的是用户 JWT 的 client，用它调用 `getUser(client, userId)` 在自托管环境下会返回空数据（因为 `auth.uid()` 被 RLS 过滤），导致登录后 layout loader 失败，整个应用崩溃。
- **症状**：登录成功后页面白屏/报错，`user.error` 或 `!user.data` 为 true。
- **修复**：在两个 layout 文件中使用 `getCarbonServiceRole()` 创建 service role client 来查询 user 数据：
  - `apps/erp/app/routes/x+/_layout.tsx`：`getUser(getCarbonServiceRole(), userId)`
  - `apps/mes/app/routes/x+/_layout.tsx`：`getUser(serviceRoleForUser, userId)`
- **规则**：**layout loader 中的 `getUser()` 必须用 service role**，其他查询（如 `getCompanies`、`getUserGroups` 等）可以用用户 JWT client，因为它们通常有自己的 RLS 豁免或不需要 bypass。

## `requirePermissions` 返回的 `client` 不应暴露给服务端业务代码做 DB 写操作

- **根因**：`requirePermissions` 返回的 `client` 是用户 JWT 的 client，在自托管 Supabase 环境下 JWT context 不会被 Storage API 传播到 Postgres（`auth.uid()` 为 NULL）。所以用这个 client 做 `upsertDocument` 或 `.from("table").insert(...)` 等操作会被 RLS 拦截。
- **正确做法**：服务端上传/写入路由应该：
  1. 从 `requirePermissions` 只解构 `companyId`、`userId`（用于权限验证），**不解构 `client`**
  2. 使用 `getCarbonServiceRole()` 创建 service role client 来做 storage upload 和 DB 写入
- **影响的文件**：`document.upload.ts`、`model.upload.ts`、`storage.upload.ts`、`storage.remove.ts`

## `destroyAuthSession()` 在 loader 中必须加 `throw`

- **根因**：`await destroyAuthSession(request)` 只是执行了销毁逻辑但不会终止 loader 执行，也不会触发页面重定向。如果忘记 `throw`，loader 会继续执行后续代码，可能导致 NPE 或其他异常，但用户看不到正确的重定向。
- **规则**：在所有 layout/route loader 中，销毁 session 后**必须 throw**：
  ```typescript
  if (!claims || user.error || !user.data || !groups.data) {
    throw await destroyAuthSession(request);
  }
  ```
- **检查方法**：grep `destroyAuthSession(` 确保每个调用前面都有 `throw`。

## React Router v7 ErrorBoundary 的 `WithErrorBoundaryProps` 包装器问题

- **根因**：React Router v7 会自动用 `WithErrorBoundaryProps` 高阶组件包裹所有导出的 `ErrorBoundary`。这个包装器内部调用 `useErrorBoundaryProps` hook，而该 hook 又调用 `useLoaderData`。当数据路由上下文不可用时（某些错误场景），会导致 "useLoaderData must be used within a data router" 错误。
- **症状**：页面闪退，控制台显示 `useLoaderData must be used within a data router` 错误，堆栈跟踪包含 `useErrorBoundaryProps` 和 `WithErrorBoundaryProps2`。
- **影响**：任何导出 `ErrorBoundary` 的路由文件都可能触发此问题，包括 `root.tsx` 和子路由（如 `_public+/refresh-session.tsx`）。
- **当前状态（待修复）**：
  - 已从 `apps/mes/app/routes/_public+/refresh-session.tsx` 和 `apps/erp/app/routes/_public+/refresh-session.tsx` 移除 `ErrorBoundary` 导出
  - `root.tsx` 中的 `ErrorBoundary` 已重构为类组件，但问题仍未解决
  - 错误可能来自其他有 `ErrorBoundary` 导出的路由，或需要更深入调查 React Router v7 的内部机制
- **待办**：继续调查为什么移除所有 `ErrorBoundary` 导出后错误仍然存在，可能需要检查：
  1. 是否有其他路由文件导出了 `ErrorBoundary`
  2. React Router 的缓存/生成类型是否需要清理
  3. 是否需要完全避免使用 `ErrorBoundary` 导出，改用其他方式处理错误
