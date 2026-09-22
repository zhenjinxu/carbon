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

## Batch writes with JSONB/array columns need explicit SQL casts

- Evidence: the AI Routing second-batch dataset writer initially failed with `invalid input syntax for type json` when nested snapshot objects and arrays were bound through the generic query builder; switching to `sql` with `JSON.stringify(...)::jsonb` and `::text[]` casts made the transaction succeed and wrote 12 rows.
- Rule: when a batch insert/update targets JSONB or array columns and the generic bind path has not been proven for that shape, use the Carbon persistence pattern with explicit casts or the `asJsonb` helper from an existing module. Do not assume a successful bind on scalar columns proves the nested snapshot payload is safe.
- Verification: the patched dataset writer inserted 8 Training and 4 Evaluation `aiRoutingSample` rows in one transaction, with four locked Evaluation rows and no formal routing changes.
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

## Do not bundle git housekeeping with software fixes

- When the active task is a software fix, leave push/commit/untracked-file cleanup/history housekeeping alone unless the user explicitly asks for it. Report code and verification status only; git cleanup can wait until the user says the changes are mature enough.


## WodiMES full import requires a stable source window or a consistent snapshot

- Two transaction-scoped `node scripts/import-wodimes.cjs --rollback` runs on 2026-07-17 reached the full write path but safely rolled back after 174s and 160s because `mes_proc_order_details` changed before the importer's final source-signature check. Carbon target counts and latest successful run remained unchanged after both attempts.
- Do not bypass this guard or run a full WodiMES import against a live-changing source merely because `--dry-run` succeeds. Use a verified source quiet/maintenance window, a consistent Mongo snapshot/secondary, or redesign the synchronization boundary before scheduling online re-imports. The current successful import remains valid because its latest-run source records and target counts reconcile exactly.

## MES list routes must be bounded before importing production-scale data

- **Evidence**: after importing 72,738 WodiMES jobs, navigating to MES `/x/jobs` rendered every row. Browser navigation exceeded 60 seconds and the local MES Node process later exited from heap pressure.
- **Rule**: every MES/ERP list route must use server-side pagination or cursoring with an explicit maximum page size. Client rendering must be bounded through pagination or virtualization; never fetch or render the entire tenant dataset by default.
- **Verification**: add a browser-level test using a production-scale fixture or seeded count. Assert first-page response/render time, bounded DOM row count, and that changing pages/searching does not load all records.
## Preserve the global `"0"` permission marker until company scope is resolved

- `get_companies_with_employee_permission` must expand a global `"0"` permission to the authenticated employee's `userToCompany` memberships **before** intersecting explicit permission IDs with those memberships. Intersecting first silently removes `"0"` and makes global administrators see empty RLS-protected lists in newly joined companies.
- Verify both paths when changing this helper: explicit company permissions must remain restricted to employee memberships, and global permissions must resolve to all and only those memberships. Test through a real user JWT, not service-role reads.
## Imported employee types require empty rows for every supported permission module

- The permission-matrix UI derives its editable module list from `employeeTypePermission` rows. A newly imported employee type with zero rows renders no controls, even for an administrator with `users_update`.
- Import or seed migrations must create one all-false permission row for every current supported module for each employee type. Use `ON CONFLICT DO NOTHING` so configured permissions are never overwritten.
- Verify both database row counts and the administrator edit modal; table counts alone do not prove that the UI can render a matrix.
## Group membership RPCs must distinguish no groups from an authentication failure

- `groups_for_user` previously used `array_agg` directly, which returns NULL when an authenticated employee has no membership rows. The ERP protected layout correctly rejects missing RPC data, so those valid employees were logged out immediately after the callback.
- User-group functions must return a typed empty collection (`{}` / `text[]`) for zero memberships. Do not make layout or RLS consumers infer authentication state from an aggregate's NULL result.
- Verify the zero-group case with a real user JWT and a full login callback, in addition to testing employees who do belong to groups.
## Employee-type permissions are templates, not live user authorization

- The employee type permission matrix defines the default snapshot copied into `userPermission` when an employee is explicitly assigned/overwritten or accepts an invite. Runtime claims and route authorization read the user-level snapshot, not `employeeTypePermission` directly.
- Editing a type must not silently overwrite existing users because individual permissions may have been deliberately customized. When applying a changed template to an existing employee, use an explicit overwrite/synchronization action for that employee and invalidate `permissions:<userId>`.
- Verify the three layers after a change: `get_claims`, the Redis cache after refill, and a real protected route for the employee. A type matrix UI alone does not prove effective authorization.
## Internal session-refresh routes must not become post-login destinations

- A failed fetcher POST to `/refresh-session` previously used the request path to build `redirectTo`, so the login page sent the user back to the internal refresh endpoint instead of a usable screen.
- On refresh failure, preserve cookie cleanup and token validation, but map the internal refresh endpoint to a fixed authenticated root path. Keep the original requested path only for real protected page requests.
- Verify both paths with browser automation: an invalid/cleared session must reach `login?redirectTo=/x`, and a new real user session must receive a successful refresh response without navigation or console errors.

## Keep Codex task artifacts inside the project work directory

- Codex-generated logs, PID files, temporary SQL, patches, and similar operational artifacts must be created under `D:\Object\carbon\.codex\work`, not in `C:\Users\zhenjin_xu` or the Carbon repository root.
- Use task-specific names or subdirectories under `.codex/work/`, keep the directory ignored by Git, and remove artifacts when they are no longer needed.

## Radix triggers around existing buttons must use `asChild`

- `TooltipTrigger`, `DrawerTrigger`, `DialogTrigger`, and similar Radix primitives render their own interactive element by default. Wrapping a Carbon `Button` or `IconButton` without `asChild` creates `button > button`, which the browser rewrites before React hydrates and causes a full client-render fallback.
- Compose multiple triggers through `asChild` so only the Carbon control renders a DOM button. Verify with a clean SSR reload: the console must contain neither `Expected server HTML` nor `validateDOMNesting`, and the tooltip/drawer/dialog interaction must still work.

## Direct SQL job seeds must account for the root make-method trigger

- Inserting `job` fires `insert_job_make_method_trigger`, which automatically creates the root `jobMakeMethod`. A seed that then inserts a second stable-ID root makes the `jobs` view duplicate rows and causes `getJob(...).single()` to fail.
- When a seed needs stable method IDs, remove only the trigger-created root after proving it has no `jobMaterial` or `jobOperation` references, then insert the stable root. Abort on referenced conflicts instead of deleting or duplicating them.
- Verify seed idempotency in a rollbacked full-script run, assert exactly one root method per job, compare base-table and `jobs` view counts, and open a real job operation route.

## Docker-hosted Inngest must be allowed through the ERP dev-server host check

- A local Inngest container can receive events while still having zero runnable functions when its SDK sync to `http://host.docker.internal:<port>/api/inngest` is rejected by Vite with `403 forbidden`.
- Keep the container SDK URL on `host.docker.internal` and add that exact hostname to ERP `server.allowedHosts`; do not disable host checking globally.
- Verify the Inngest Apps page reports the Carbon app and expected function count, then prove a real event reaches its handler and creates the first visible run record.

## Imported child identities must include the source primary identifier

- U8 routing data can contain two genuine operations with the same `MoDId` and `OpSeq` but different `OperationId` values. Using only `MoDId:OpSeq` creates duplicate `jobOperation.id` values and makes a batched upsert fail atomically.
- Build the stable operation key from `MoDId:OpSeq:OperationId` when the source operation ID exists. Do not discard one same-sequence operation or use array position as identity.
- Before a real import, dry-run production-like filtered data, assert generated conflict keys are unique, then verify first-run counts and a second idempotent run.

## Production Docker readiness does not prove the local runtime is all Docker

- A production Swarm/Caddy design and successful image builds do not establish that the Windows workstation has stopped using host PostgreSQL, Redis, or Node application processes.
- When the user asks for full Docker operation, inventory actual processes, ports, Compose services, database URLs, and persistent data ownership on the requested host. State local and production status separately.
- Do not mark the task complete until the requested host runs the full service set, real data is restored and reconciled, health/business endpoints pass, and any retained native service is explicitly identified as an unused rollback source.

## Scope destructive queue cleanup to the authorized target and preserve rollback evidence

- A large queue should not be purged based only on an operational warning, but an explicit user instruction is valid authorization to remove the identified target data.
- Quiesce writers and consumers, use the queue extension's official purge API, record the exact before/removed/after counts, then restore the full stack and re-run health and key-data checks.
- Keep the source database and pre-purge backup unchanged. Create a new post-purge forward-migration snapshot so later restores do not silently reintroduce the cleared queue.


## Preserve U8 BOM edge identity and normalize SQL Server rows at the boundary

- **Evidence**: the production-order graph imported on 2026-07-30 contained 3,099 direct U8 edges but 8,264 root-relative branch occurrences. Repeated descendants appeared under different direct parents with different quantities. The Word CTE retained only the root parent and multiplied quantities, so it could not identify those branches.
- **Rule**: use `bom_opcomponent.OpComponentId` as the stable direct-edge identity. Preserve direct parent, child, edge path, part path, direct quantity, and cumulative quantity. Never deduplicate a BOM by root code plus child code.
- **Quantity**: calculate direct usage as `BaseQtyN / BaseQtyD` with decimal arithmetic, then multiply along each branch. Reject a zero denominator.
- **Selection**: prefer a production order's approved assigned `BomId`; if it is missing or not approved, select the latest approved BOM effective on the import date. Apply the effective approved rule recursively to manufactured children.
- **Boundary**: normalize SQL Server PascalCase fields such as `BomId` and `ParentId` once before calling the tree engine. Do not let database driver row casing leak into the normalized graph contract.
- **Import safety**: require dry-run, full-write rollback rehearsal, a stable source signature before commit, deterministic external mappings, target reconciliation, and an idempotent committed rerun before declaring a production BOM import complete. A no-op rerun must not update timestamps or emit downstream events; verify the event-queue sequence before and after.

## Reconcile standard related rows when importing or reusing core entities

- Carbon insert interceptors initialize related records only when the canonical base-row insert path runs. A direct import, historical restore, or identity reuse can leave a valid `item` or `customer` without required cost, planning, payment, shipping, tax, or similar baseline rows.
- Importers and compatibility migrations must explicitly reconcile every standard related-row contract with idempotent, tenant-scoped inserts that preserve existing configuration. Do not assume a base row proves its interceptor-derived records exist.
- Verify missing rows before repair, perform a rollback rehearsal, compare committed counts, run a no-op rerun, and test a real downstream consumer such as the BOM explorer or RFQ conversion.

## Cross-function conversions must validate nested work and compensate partial state

- A successful parent Edge Function transaction does not prove nested function calls or asynchronous interceptors completed. Never discard `functions.invoke` results when their work is required for a valid converted document.
- Rows needed by the current transaction must be created explicitly inside that transaction; an asynchronous interceptor cannot satisfy a same-transaction foreign-key dependency. Make the later interceptor idempotent so event processing cannot duplicate explicit rows.
- When required nested work runs after the parent transaction, validate candidate counts and every invocation result. On failure, use a company-scoped compensating transaction to remove the incomplete target and restore the source workflow state, then return an error.

## Restored migration history does not prove derived objects or ACLs exist

- A restored database can record a migration as applied while views or other derived objects are absent. Verify application-critical views, RPCs, and Storage grants against the live catalog and through the actual PostgREST/API consumer; migration history alone is not acceptance evidence.
- A compatibility migration that recreates a view must explicitly restore its security mode and the SELECT grants required by `anon`, `authenticated`, and `service_role` as applicable. Do not rely on the migration executor's owner or default privileges.
- Reload the PostgREST schema cache after restoring exposed objects, then verify both a real read and the downstream business workflow. The quote and SO000007 PDF failures demonstrated separate missing-view and missing-ACL failure modes.

## Keep lifecycle status and completion timestamps in the authoritative update

- Do not record `completedDate` only as a side effect of creating an external link, document, notification, or other optional artifact. Retries and pre-existing artifacts can skip that branch while the workflow still advances, leaving a valid business state with a missing lifecycle timestamp.
- The authoritative state transition must write its status and completion timestamp together. A historical repair must be idempotent and use persisted business evidence, such as the first Quote PDF, rather than assigning the migration execution time.
- Verify both first-run and existing-artifact paths, then reconcile the live row, artifact count, downstream document, and a no-op migration rerun.

## Separate diagnosis from an applied fix before asking for a retest

- Restarting can only load source, image, or schema changes that were actually made. A confirmed root cause is not a fix, and a service restart cannot repair an unchanged application or a missing database object.
- Before asking the user to retest, record the concrete source/database changes, rebuild or reload the affected runtime, and execute the reported interaction end to end. If work remains diagnosis-only, state that the behavior is still expected to fail.
- For settings metadata, distinguish global registries from tenant-aware projections. If a required projection is missing from a restored database, restore the view, security mode, grants, and PostgREST cache instead of substituting a base table with a different row shape.

## Distinguish an operator shutdown from a runtime crash before changing the model setup

- A disappeared local model process is not evidence of an out-of-memory failure or a bad model. Check the application's shutdown log, process start time, listener, and health endpoint, then confirm operator actions when available.
- The 2026-08-05 MegaMem pilot interruption was caused by the user accidentally exiting Ollama. Its logs showed an orderly desktop/server shutdown, and the restarted service returned the expected local models. Resume from the last committed Episode without changing model limits or retrying already committed notes.
- Keep failed or interrupted attempts in a diagnostic audit list separate from successful graph entries so recovery does not create duplicate Episodes or misstate completion.
## A successful graph command must satisfy graph postconditions

- A zero exit code and a truthy Graphiti result prove only that the Episode call returned. MegaMem 1.7.6 can report success while creating an Episode with zero entities, zero MENTIONS, and zero provenance relationships.
- Preserve entity and edge counts in the sync ledger. Require an Episode UUID and at least one extracted entity before recording success, then query the graph for UUID agreement and orphan nodes after each commit.
- If an empty Episode is found, stop the batch, verify the exact UUID and that it has no relationships, move the entry to the diagnostic attempt log, and delete only that audited empty node before retrying.
## Knowledge-graph timestamps must be timezone-aware before storage

- A naive local `datetime.now()` followed by `replace(tzinfo=UTC)` does not convert time; it relabels the wall clock and can hide fresh Episodes from reference-time queries for the local UTC offset.
- Generate fallback timestamps with `datetime.now(timezone.utc)`. For parsed date/time metadata, establish the intended timezone explicitly before Graphiti receives it.
- Verify the runtime behavior through `get_episodes`, not only direct Neo4j counts, and reject a completed sync when any current Episode has a future `valid_at` without an explicit future source date.

## Validate online structured output as data, not merely JSON

- OpenAI-compatible providers may reject `response_format` or return the supplied JSON Schema itself. Valid JSON is not proof that the payload is a valid response instance.
- Use the provider's compatible mode, inject the Pydantic schema as instructions, validate every returned object with the response model, and issue bounded corrective retries with input-free validation errors.
- Keep the failed attempt in the audit ledger and verify no uncommitted Episode remains before retrying the source note.

## Report semantic search and deterministic retrieval separately

- More extracted entities do not guarantee good Chinese semantic recall when the embedding model is poorly matched to the query language. Measure the exact Top-K path before blaming extraction.
- A bounded lexical fallback over scoped Episode bodies is acceptable when it ranks only from the user question and preserves exact source provenance, but its score must not be reported as semantic-vector success.
- Record both metrics, the retrieval mode, latency, and repeated result-set stability so a later multilingual embedding upgrade can be compared honestly.

## Lingui pre-commit hooks can rewrite unrelated or byte-pinned files

- Evidence: the Ontology Phase A commit hook ran lingui:extract, lingui:compile, and strip-po-headers, deleting the content of 22 locale catalogs; lint-staged also reformatted the byte-pinned ontology snapshot and broke its manifest hash.
- Rule: before committing generated or byte-pinned Ontology artifacts, inspect the hook output and verify the staged snapshot hash and unrelated locale boundary. Use git commit --no-verify only after the required package tests and static checks have passed, then record the reason in the commit review.
- Recovery: restore the exact parent locale files and the canonical snapshot bytes, verify the combined commit diff has no locale net change, and rerun snapshot verification.

## Keep project-snapshot HTTP separate from future company-live authority

- The local Context API is loopback-only and unauthenticated; its response schemas and runtime guard must accept project_snapshot only. A discriminated company_live authority belongs to a future authenticated adapter, not a shared permissive response path.
- Require authenticated userId/companyId from Carbon auth context, reject caller tenant arguments, and verify that the returned company_live authority matches the authenticated company before exposing it.
- Do not add an ontology permission enum or ERP/MCP route until a committed company-scoped ontology source, freshness/revision semantics, and RLS/isolation evidence exist.

## 历史启动日志必须与当前运行状态分离（2026-08-10）

- 用户补充说明启动失败日志来自数小时前；当时的 pnpm install --frozen-lockfile 报 Ontology workspace importer 缺失，但当前 pnpm install --frozen-lockfile --ignore-scripts 已通过，当前 Compose 配置有效，14 个 Carbon 容器健康运行，新的 ERP 镜像也已成功生成。
- 排查启动故障时，先记录日志时间，再分别核对当前 package/lockfile、Compose 配置、镜像创建时间和容器状态，不能把历史失败直接当成当前故障。
## Verify new Lingui UI messages against the active compiled catalog

- User-visible text added through `t`/`Trans` can render as generated message IDs such as `+95T7I` when the active compiled locale catalog lacks the new message.
- Before handing off UI text changes in a localized Carbon page, verify the rendered locale or run the Lingui extract/compile path. For small hotfixes, reuse existing catalog messages only when the resulting message IDs exactly match existing entries.
- When a new message is unavoidable, update and compile the locale catalog in the same change instead of relying on fallback source text.

## Preflight item deletion dependencies before bulk deleting base records

- Deleting from `item` directly can fail on dependent manufacturing records such as `methodMaterial.itemId`; raw Postgres foreign-key messages leak internal table and constraint names to users.
- Bulk delete services must check known business dependencies inside the same transaction before deleting base records, then return an actionable user message such as removing the item from BOMs or deactivating it instead.
- Keep the database foreign key as the final safety net, but do not make normal users discover dependency rules through constraint errors.
## Apply schema migrations before asking users to retest schema-dependent UI

- Evidence: the Parts archive-delete UI called the new deletionArchive table before the local development database had applied migration 20260813134827, so the user hit relation "deletionArchive" does not exist on the first real retry.
- Rule: when a feature adds a table, view, function, enum, or policy that the current running app immediately calls, either apply the scoped local migration before handoff or explicitly block retest until the user applies it. Do not describe the UI path as ready while the active database cannot satisfy it.
- Verification: confirm both to_regclass or catalog existence and the supabase_migrations.schema_migrations version row before asking for another UI retry.
## Treat production/job references as hard blockers for test cleanup archive delete

- Evidence: a 20-row Parts archive-delete retry on 2026-08-13 still failed after methodMaterial cleanup because selected parts were referenced by job and jobMakeMethod records in the live database.
- Rule: archived test cleanup may remove item-owned setup records and editable BOM references, but it must preflight production/job history before writing deletionArchive or deleting any dependent rows. If job/job method references exist, return a specific action message to delete the test jobs first or deactivate the parts.
- Do not expand a cleanup delete from master data into job/MES/history deletion without a separate dependency graph, archive design, and explicit user approval.

## Gate destructive test-job cleanup behind explicit action and execution-safe preflight

- Evidence: the Parts test cleanup flow needed an explicit user-selected option to handle job/jobMakeMethod/jobMaterial references after the default archived delete correctly blocked them.
- Rule: never cascade-delete jobs from an item cleanup by default. Only a developer-only, user-selected cleanup action may delete referenced jobs, and only after locking the job, job method, and job material rows and proving every referenced job is unexecuted (Draft/Planned, zero completed/shipped/received quantity, and no picking list line references).
- If any referenced job is released, in progress, completed, closed, has execution quantities, or has downstream picking records, keep the transaction intact and require deactivation or manual job review instead.

## Keep deletion archive payload readers backward-compatible

- Evidence: live Part archive records created during the 2026-08-13 cleanup work included legacy payloads with `item` and `methodMaterials` snapshots but no `payload.action`; the restore path treated them as `unknown` and failed with `Unsupported archive action`.
- Rule: deletion/archive restore readers must tolerate older payload envelopes whenever the snapshot still contains enough authoritative data to restore safely. Add a regression test before changing the reader, and keep malformed payloads as explicit errors instead of silently restoring.
- When adding new discriminator fields to JSONB recovery payloads, either backfill existing rows in a migration or make the reader infer the legacy shape from stable required snapshots.
## Preserve identifier text semantics in Excel-oriented CSV exports

- Evidence: after the Parts CSV export gained readable Part ID and Name columns, the user reported that exported Part IDs lost their original string form when opened as an Excel document. UTF-8 BOM fixes header encoding only; it does not prevent Excel from coercing numeric-looking identifiers.
- Rule: CSV columns containing business identifiers such as part/readable IDs must opt into explicit Excel text preservation when the export is intended for Excel. Add a regression test with leading-zero or long numeric-looking IDs before changing export formatting.
- Keep the behavior scoped through column metadata instead of globally wrapping every string, so normal text, dates, statuses, and downstream machine-readable exports are not unexpectedly converted to Excel formulas.
## Whitelist writable columns when restoring archived snapshots

- Evidence: restoring a live Parts deletion archive failed with `cannot insert a non-DEFAULT value into column "readableIdWithRevision"` because the archived item payload included the generated `item.readableIdWithRevision` display field and the restore insert builder wrote it back to `item`.
- Rule: archive/restore payloads may keep display or read-only fields for audit and listing, but restore insert builders must explicitly whitelist writable database columns and omit generated/read-only columns. Add regression coverage that simulates the database rejecting generated columns before changing restore logic.
- For `item`, restore `readableId` and `revision`; let PostgreSQL regenerate `readableIdWithRevision`.
- For `methodMaterial`, restore `quantity` and `scrapQuantity`; let PostgreSQL regenerate `productionQuantity`.
## Validate live foreign keys when restoring archived relationship snapshots

- Evidence: restoring the remaining Parts deletion archives on 2026-08-14 failed with `methodMaterial_materialMakeMethodId_fkey` because archived BOM snapshots kept `methodMaterial.materialMakeMethodId` values whose original `makeMethod` rows had been deleted with the item.
- Rule: restore paths must not blindly write optional foreign keys from archive payloads. Validate each archived FK target in the current company and remap derivable references to the current live target; if an optional relationship cannot be resolved safely, write null and let existing derived views or follow-up editing rebuild it.
- For `methodMaterial.materialMakeMethodId`, keep the archived ID only when the live `makeMethod` still exists; otherwise resolve the restored item's current `activeMakeMethods` row for Make-to-Order materials, or null when none exists.

## Distinguish OpenAI API base URLs from network proxies

- A Codex `model_providers.*.base_url` is an OpenAI-compatible API base URL, not an `HTTP_PROXY`/`HTTPS_PROXY` network proxy. For host-side AI SDK calls, set `OPENAI_BASE_URL` to that URL; for Docker consumers, test the equivalent `host.docker.internal:<port>` URL before recreating containers.
- Do not assume a Codex local proxy is suitable for Carbon business AI calls. Verify the exact wire mode the application uses: non-streaming `/v1/responses` must complete, structured outputs must validate, and response metadata must not show Codex-injected system instructions.
- If a proxy only works for Codex streaming requests or injects Codex instructions, treat it as a Codex session transport, not a production-quality model endpoint for PDF extraction or other auditable business workflows.
## Tell vision models whether schema coordinates are normalized or pixel-based

- Evidence: the AI Routing PDF full-schema probe for Part `1927930202` returned a parseable extraction object, but Zod rejected it because every `boundingBox` coordinate was a rendered PNG pixel value while `aiRoutingDrawingExtractionSchema` requires normalized page fractions from 0 to 1.
- Rule: when a structured vision schema includes coordinate fields, the prompt must explicitly define the coordinate system and conversion formula, and a focused test must assert that the request includes that instruction. Do not rely on field names like `boundingBox` to imply normalized coordinates.
- Verification: after adding the normalized-coordinate instruction, the same 1684x1191 PDF image passed the full schema and live extraction `aide_DXtRjyVqUFJJuiPCkz8mdL` stored a `Succeeded` `aiDrawingExtraction` row.

## Validate real `input_image` vision endpoints before dataset writes

- Evidence: during the AI Routing second-batch board-part PDF run on 2026-08-18, all 12 drawings rendered and queued, but the non-streaming vision endpoint produced only 4 successful `aiDrawingExtraction` rows and 8 failures, including Headers Timeout, operation timeout, and schema mismatch errors.
- Rule: do not treat a text-only structured output check as proof that a PDF/drawing extraction endpoint is usable. Before writing Training/Evaluation roles, training samples, or evaluation conclusions, preflight the same non-streaming `/v1/responses` endpoint with real `input_image` data URLs and representative drawings, then verify success rate, latency, schema validity, and retry behavior.
- Safety: when image extraction is unstable, keep the affected rows Pending/Failed, record extractionId/model/timing without secrets, and switch to a verified stable vision endpoint or run a controlled retry. Do not create learning samples or holdout conclusions from failed or partial drawing extractions.

## Recover stale Processing rows when extraction IDs are idempotency keys

- Evidence: the AI Routing second-batch worker stopped after creating a `Processing` `aiDrawingExtraction` row for Part `1927930502`; no worker or recent execution remained, and enqueueing the same scope reused the old extraction ID instead of creating a retryable event. A controlled retry later failed with `AI_NoObjectGeneratedError`, confirming the original row was stale rather than still running.
- Rule: long-running extraction jobs whose event payload uses `extractionId` as an idempotency key must define a bounded stale `Processing` policy. Reuse active `Pending` rows and recent `Processing` rows, but replace stale rows with a new extraction ID. Missing or invalid processing timestamps must fail closed as stale rather than block retries forever.
- Concurrency: stale-row failure and replacement `Pending` creation must occur in one transaction protected by a scope advisory lock and an active-row `FOR UPDATE`; send the retry event only after commit. Mark the old row `Failed` with an auditable error code such as `STALE_PROCESSING_TIMEOUT` and retain the original extraction record.
- Verification: `aiRoutingDrawingExtractionQueueDecision` regression coverage passed with the focused AI Routing suite; the live second-batch status check ended at `4 Succeeded / 8 Failed / 0 Processing`. This recovery removes the permanent retry lock but does not authorize dataset writes while the real-image vision endpoint remains unstable.

## Responses metadata is part of the Carbon AI endpoint contract

- Evidence: on 2026-08-19, the local Codex proxy and `api.aixhan.com` both returned HTTP 200/completed non-streaming `/v1/responses` results for `input_image` data URLs from the ERP container, but both included Codex-injected system instructions in response metadata.
- Rule: HTTP success, image acceptance, and even structured-output success are insufficient for a Carbon business endpoint. Inspect response metadata and reject any endpoint that injects Codex system instructions; do not create extraction rows, dataset roles, Training samples, Evaluation conclusions, or formal routing from that transport.
- Verification: no controlled retry row was created; the ERP container was restored to its base Compose configuration; the read-only second-batch dry-run remained `4` succeeded / `8` failed with `readyForDatasetWrite=false`.
