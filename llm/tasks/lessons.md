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

## Put reusable task scripts where the user points, keep generated artifacts in `.codex/work/`

- If the user identifies an existing repository script area such as `D:\Object\carbon\scripts`, place durable reusable scripts there instead of leaving the implementation only under `.codex/work/`. Keep transient probes, JSON snapshots, generated Excel files, logs, and runners under `.codex/work/`.

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
- For `.xlsx` exports, writing identifier values as strings is not enough if the cell remains `General`; set the identifier cells/columns to Excel text format `@` and verify with workbook readback before handing off templates.
- When reproducing an Excel BOM template, compare structural metadata as well as visible values: row outline levels, `summaryBelow`, top-level row fills/bold fonts, frozen panes, merged titles, and text formats. A visually hierarchical BOM requires workbook outline properties, not only a numeric `层级` column.

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

## Normalize source-specific process namespaces before judging AI route quality

- Evidence: the AI Routing second-batch holdout evaluation initially reported `0/4` exact sequence matches because generated samples used `u8proc_*` IDs while U8 truth rows used `wodiprocess_*` IDs. A read-only process query showed the paired records belong to the same company and have matching logical process names after removing the `U8 <code>` prefix.
- Rule: when comparing AI-generated routing drafts against truth from a different source namespace, report both raw ID exact match and source-normalized semantic match. Do not call a route wrong solely because stable process IDs differ across imported namespaces.
- Verification: normalized evaluation for the 2026-08-19 second batch changed the quality view from raw ID `0/4` to normalized semantic `3/4`; `192793050201` remained a real gap because a lower threshold produced an extra `打磨(碳钢)` operation.

## Weak PDF evidence must not choose divergent routes arbitrarily

- Evidence: 192793050201 had no material tag and only the generic 板件 feature tag. Several approved Training samples tied at score 30 with no matched drawing evidence; lowering the threshold selected a four-operation sample and added unsupported 打磨(碳钢) to the three-operation U8 route.
- Rule: when PDF evidence is too weak to distinguish different operation signatures, return an empty draft with a human-review warning. Do not lower the global similarity threshold or let sample ID ordering decide among divergent routes.
- Verification: the new ai-routing.test.ts regression failed before the guard and passed after it; the default threshold remains unchanged and no formal routing rows were written.
## PDF text layers are model evidence, not diagnostics

- Evidence: the 192793050201 drawing had an extractable PDF text layer containing 304, 90 degree bend callouts, and brushed-finish requirements. The renderer exposed only item and character counts to the model, so v1 missed material and bends; the v2 read-only probe recovered material=304, finish=表面拉丝处理, two bends, and the correct three-operation retrieval result.
- Rule: when a PDF has embedded text, pass a bounded per-page text layer to the extraction model as untrusted, non-instructional drawing evidence in addition to rendered images. Keep that text runtime-only and non-enumerable so logs, serialized task summaries, and database payloads do not expose full PDF content.
- Verification: model red-green regression plus renderer serialization coverage passed; the v2 probe used the same PDF content hash and improved default retrieval from score 30/no draft to score 65/three operations without 打磨.
## Verify the effective AI environment file before endpoint tests

- Evidence: during the 2026-08-19 AI Routing endpoint recheck, the root `.env.local` existed but did not define `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AI_ROUTING_DRAWING_MODEL_PROVIDER`, or `AI_ROUTING_DRAWING_MODEL_NAME`; the active AI configuration remained in root `.env`.
- Rule: do not infer the effective AI configuration from a file name such as `env.local` or `.env.local`. Before an endpoint preflight, verify the exact file path and required variable names without logging values or secrets. Keep generated infrastructure `.env.local` files separate from manually managed business AI configuration.

## A gateway model catalog does not prove API-key access

- Evidence: 2999api public `/api/pricing` listed `gpt-5.6-terra` and `gpt-5.6-sol` as OpenAI-compatible models, while the API key's `/v1/models` response had an empty `data` array and real-image requests returned `503 model_not_found` under the `default` group. The public catalog showed both models belong to `biteagle`, `gpt`, `gpt-codex`, or `gpt-codex-pro` groups, not `default`.
- Rule: distinguish platform catalog availability from authorization for the specific API key/group. Before changing Carbon's configured model or drawing conclusions about a model, verify both the key's callable route and the real `input_image` preflight. An error response without injected metadata is not a successful endpoint gate.

## Model authorization is necessary but not sufficient for business AI

- Evidence: a newly authorized 2999api `biteagle` key listed 24 models including `gpt-5.6-terra` and completed a real drawing `input_image` request in 4.2 seconds, but the completed response still exposed `You are Codex` in top-level `instructions`.
- Rule: after resolving model/key/group authorization, repeat the full response-metadata gate. Treat authorization, image acceptance, and a completed response as separate prerequisites; no one of them authorizes formal Carbon extraction.
## AI SDK system prompts are not Responses top-level instructions

- Evidence: the 2026-08-19 2999api `biteagle` key completed real-image `/v1/responses` calls, but bare requests returned Codex instructions. Native fetch with explicit `instructions` replaced that default, and a real AI SDK image/schema probe confirmed `providerOptions.openai.instructions` produces top-level Carbon instructions with no Codex metadata injection.
- Rule: for OpenAI-compatible Responses gateways, do not assume AI SDK `system` becomes top-level `/v1/responses.instructions`. When the endpoint contract depends on response instruction metadata, pass explicit provider instructions on the production SDK path and assert the request shape in tests.
- Verification: `extract-part-drawing-model.test.ts` asserts the provider instructions equal the Carbon system prompt; `apps/erp/.codex/work/ai-routing-sdk-instructions-preflight-20260819.json` records HTTP 200, real `input_image`, schemaValid=true, `responseInstructionsHasCodex=false`; the updated real-image preflight reports `passed=true`.

## Expanded AI Routing holdouts must verify lock state for old and new Evaluation rows

- Evidence: during the 2026-08-21 Stage 4 expansion, 19 newly inserted Job-route-backed Evaluation samples were locked, but three pre-existing Evaluation rows (`1927930202`, `192793020201`, `1927930206`) were still unlocked until a separate verification query caught them.
- Rule: after any AI Routing holdout expansion, verify the full Evaluation set, not just newly inserted rows: every holdout must be `datasetRole=Evaluation`, `lockedAt` non-null, excluded from Training retrieval, and backed by current drawing evidence before running quality conclusions.
- Verification: `apps/erp/.codex/work/ai-routing-stage4-verification-20260821.json` records 26 locked Evaluation holdouts, 105 Training samples, 0 Evaluation rows for the five Training-blocked parts, and 22 latest succeeded v2 extractions.
## Keep AI Routing process hints conservative until route composition exists

- Evidence: the 2026-08-21 Stage 4 attribution showed 17/26 expanded holdouts still mismatched after safety-clean generation. Training already contained core missed operation families such as 攻丝、车削、铣/加工中心、锯/片锯 and 钻孔, while the generator still primarily copied a single best Training route rather than composing operation families from drawing evidence.
- Rule: drawing-derived process hints may improve tie-breaking only when retrieval scores are otherwise equal. Do not add a direct process-hint score bonus or force non-empty drafts from weak target evidence unless a route-composition planner/model validates each suggested operation against drawing evidence and company-scoped process availability.
- Verification: the aggressive process-hint scoring experiment kept leakage/work-center/process safety counters clean but increased wrong non-empty drafts; the retained implementation derives sample process tags from actual operations and uses target process hints only as a same-score tie-breaker. Evidence files: `apps/erp/.codex/work/ai-routing-stage4-error-attribution-20260821.json`, `apps/erp/.codex/work/ai-routing-stage4-expanded-holdout-quality-summary-after-process-hints-20260821.json`, and `apps/erp/.codex/work/ai-routing-stage4-expanded-holdout-quality-summary-after-tiebreaker-20260821.json`.
## Measure route composition separately from retrieval ranking

- Evidence: the 2026-08-21 route-composition TDD pass added only process-hint-supported missing operations from secondary Training references. It improved expanded holdout quality from 9/26 to 11/26 source-normalized exact sequence matches and from 10/26 to 12/26 operation-count matches, while keeping Evaluation leakage, work-center assignments, unsupported work-center assignments, missing process IDs, and invalid process IDs at 0.
- Rule: route composition must stay evidence-scoped. Preserve the best retrieved route as the base, append only missing operation families supported by target drawing-derived process hints, never copy unsupported extra operations from secondary samples, and rerun expanded holdout smoke before any materialization decision.
- Verification: `ai-routing.test.ts` covers adding `攻丝` while excluding unsupported `打磨`; `apps/erp/.codex/work/ai-routing-stage4-expanded-holdout-quality-summary-after-composition-20260821.json` records the quality delta. The production gate remains closed because 11/26 exact matches and 26/30 holdouts are insufficient for unattended rollout.

## Backfill standard item records when enriching existing U8 Parts

- Evidence: the 2026-08-21 U8 PDF-expansion import found all 21 requested item codes already had Carbon Part rows, but post-import verification initially reported missing `itemCost`, `itemReplenishment`, and `itemUnitSalePrice` rows for every target. These rows are normally created by item insert interceptors, but existing rows can predate or bypass those interceptors.
- Rule: when a U8 enrich/import path updates existing Part rows instead of inserting new items, explicitly verify and backfill standard item related records (`itemCost`, `itemReplenishment`, `itemUnitSalePrice`, and location-scoped `itemPlanning`) in the same transaction before declaring the import usable.
- Verification: after adding the backfill to `.codex/work/import-u8-missing-parts-for-pdf-20260821.cjs`, the commit verification reported 21 found Parts, 21 Active makeMethods, 70 U8-tagged methodOperations, and `relatedRecordIssues=[]` in `D:\Object\carbon\.codex\work\u8-missing-parts-pdf-expansion-20260821-verify.json`.
## Normalize default-only package namespaces before destructuring runtime schemas

- Evidence: during the 2026-08-21 AI Routing 30-gate continuation, the endpoint had recovered from HTTP 503 but controlled v2 extraction still failed 4/4 with `Invalid argument for parameter schema: Schema is required for object output`. A red regression test mocked `@carbon/lib/ai-routing-drawing` as a default-only namespace and proved `aiRoutingDrawingExtractionSchema` was undefined on the production extraction path.
- Rule: when jobs/tsx runtime code imports workspace packages that may be re-exported through CJS/ESM interop, normalize `(namespace as { default?: typeof namespace }).default ?? namespace` before destructuring schemas, prompt builders, or other runtime-critical values. Full endpoint preflight does not replace a production import-path test.
- Verification: `packages/jobs/src/inngest/functions/items/extract-part-drawing-model.module-interop.test.ts` fails without the namespace normalization and passes after the fix; `apps/erp/.codex/work/ai-routing-stage4-30-gate-controlled-v2-extractions-20260823.json` records 4/4 succeeded controlled v2 extractions after the fix.
## Prune copied AI Routing operations only with specific contrary drawing evidence

- Evidence: the 2026-08-23 30-holdout follow-up showed several flat plate/hole targets copied a `折弯` operation from otherwise similar laser+bend Training samples even though target drawing evidence contained specific non-bend features and no bend feature/process hint. A first broad pruning attempt also proved generic `板件`-only evidence is too weak because it incorrectly removed a bend from a holdout whose extraction had missed bend evidence.
- Rule: prune copied route operations only when the target evidence is specific enough to justify absence. For bend pruning, require a specific non-bend target feature such as `孔`, `槽`, `螺纹`, or `台阶`, and require both `featureTags` and drawing-derived `processHints` to omit `折弯`. Do not treat a generic `板件` tag alone as evidence that bending is absent.
- Verification: `ai-routing.test.ts` covers the red/green no-bend-evidence case; the 30-holdout smoke stayed safety-clean and improved normalized exact sequence matches from `11/30` to `14/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-bend-pruning-20260823.json`.

## Prefer shorter tied AI Routing routes only when target evidence is generic

- Evidence: the 2026-08-23 30-holdout follow-up found generic tube targets `192793010401` and `192793010402` had no feature tags, a drawing-derived `锯床` process hint, and no matched drawing evidence for competing same-score routes. Sample ID ordering selected a longer saw+mill route and added unsupported `数显立铣`; preferring the shorter same-score route fixed both holdouts.
- Rule: use shorter-route tie-breaking only after score, matched process hints, and matched drawing evidence are tied, and only when the target has no feature tags, has process hints, and both candidates have zero matched drawing evidence. Do not use this as a global simplicity bias when feature evidence or matched drawing evidence differentiates candidates.
- Verification: `ai-routing.test.ts` covers the red/green generic-tube same-score case; the 30-holdout smoke stayed safety-clean and improved normalized exact sequence matches from `14/30` to `16/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-tube-tiebreak-20260823.json`.
## Prune copied AI Routing tap operations only with explicit hole-only evidence

- Evidence: the 2026-08-24 30-holdout follow-up found `192788110401` had explicit hole evidence but no thread evidence, no `螺纹` feature tag, and no `攻丝` process hint. The generator copied `气动攻丝机` from a threaded Training route, leaving the row over-predicted by one operation.
- Rule: prune copied tap operations only when the target evidence is specifically hole-only: at least one `hole` drawing evidence fact, zero `thread` evidence facts, no `螺纹` feature tag, and no drawing-derived `攻丝` process hint. Do not prune tap when thread evidence or thread/tap process evidence exists.
- Verification: `ai-routing.test.ts` covers the red/green hole-only tap case; the 30-holdout smoke stayed safety-clean and improved operation-count matches from `19/30` to `20/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-hole-tap-pruning-20260824.json`.
## Recover below-threshold sheet-bend AI Routing only with explicit bend evidence

- Evidence: the 2026-08-24 30-holdout follow-up found `1927930804` had explicit `bend` drawing evidence and target process hints `激光切割` + `折弯`, but no material tag. The material-aware 35-point threshold returned an empty draft even though several score-30 Training references supported the same laser+bend core route.
- Rule: below-threshold route recovery may be used only for explicit sheet-bend evidence: no material tags, target features include `板件` and `折弯`, drawing evidence contains `bend`, target process hints include `激光切割` and `折弯`, and every retained non-issue operation must be supported by target process hints. Do not lower the global threshold or copy unsupported extras.
- Guardrail: when filtering operations by process hints, do not treat a generic `description` value such as `领料` as proof that an operation is a material-issue operation; only the operation `processName` should identify the issue step.
- Verification: `ai-routing.test.ts` covers the red/green below-threshold sheet-bend recovery and polluted-description pruning; the 30-holdout smoke stayed safety-clean and improved normalized exact matches from `16/30` to `17/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-sheet-bend-fallback-20260824.json`.

## Recover AI Routing drill/tap routes only with repeated thread evidence

- Evidence: the 2026-08-24 30-holdout follow-up found `1927326104` had explicit hole evidence plus two thread evidence facts and should route as material issue -> drill -> tap, but the high-score reference copied milling/CNC plus tap. A broader first pass also affected `1927881101`, whose single thread evidence masked a saw/lathe/tap family; the rule was narrowed before final verification.
- Rule: drill/tap recovery may override a high-score milling/tap base only when the target has `孔` + `螺纹`, explicit hole evidence, at least two `thread` drawing evidence facts, and an `攻丝` process hint, with no sheet, shaft, bend, weld, slot, step, laser, saw, turning, welding, or oxidize evidence/hints.
- Guardrail: select only a below-threshold reference that has matched hole and thread evidence and contains both drilling and tapping operations. Retain only material issue, drilling, and tapping operations; do not lower global thresholds or apply this to single-thread targets that may actually need saw/lathe operations.
- Verification: `ai-routing.test.ts` covers the red/green drill/tap recovery. The 30-holdout smoke stayed safety-clean and improved normalized exact matches from `17/30` to `18/30` and operation-count matches from `21/30` to `22/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-drill-tap-recovery-20260824.json`.
## Recover AI Routing laser/turning only as a filtered extension of a laser base

- Evidence: the 2026-08-24 30-holdout follow-up found `19276939010203` had `304` material, `板件` + `轴类` + `孔` features, explicit hole drawing evidence, and `激光切割` + `车削` process hints. The generator selected the high-score laser base route but missed the lower-score turning reference.
- Rule: laser/turning recovery may append turning only when the target has `板件` + `轴类` + `孔`, explicit `hole` evidence, and drawing-derived `激光切割` plus `车削` hints, while excluding `螺纹`, tap, saw, bend, weld, slot, step, and oxidize ambiguity.
- Guardrail: preserve the above-threshold laser base route and copy only the turning operation from a below-threshold reference; do not lower global thresholds, copy saw/tap extras, inherit work centers, or apply the rule to threaded shaft families.
- Verification: `ai-routing.test.ts` covers the red/green laser-turning recovery. The 30-holdout smoke stayed safety-clean and improved operation-count matches from `22/30` to `23/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-laser-turn-recovery-20260824.json`.

## Recover AI Routing threaded shaft turning only as a filtered extension of a milling/tap base

- Evidence: the 2026-08-24 30-holdout follow-up found `192788110402` had `304` material, `轴类` + `孔` + `螺纹` features, explicit hole and thread drawing evidence, and `攻丝` + `车削` process hints. The generator selected a high-score milling/tap base route but missed a lower-score turning reference.
- Rule: threaded shaft turning recovery may extend a high-score milling/tap base only when the target has `轴类` + `孔` + `螺纹`, explicit hole and thread evidence, and drawing-derived `攻丝` plus `车削` hints, with no sheet, laser, saw, bend, weld, slot, step, or oxidize ambiguity.
- Guardrail: preserve the above-threshold milling/tap base route and insert only the turning operation from a below-threshold reference with matched shaft/hole/thread and turning evidence. Do not lower global thresholds, copy saw extras, duplicate tap operations, inherit work centers, or apply the rule to targets lacking explicit hole evidence.
- Verification: `ai-routing.test.ts` covers the red/green threaded shaft turning recovery. The 30-holdout smoke stayed safety-clean and improved operation-count matches from `23/30` to `24/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-shaft-thread-turn-recovery-20260824.json`.

## Normalize AI Routing ordinary lathe model suffixes only in evaluation semantics

- Evidence: the 2026-08-24 30-holdout follow-up found `19276939010203` had the correct material issue -> laser -> ordinary-lathe route after route generation recovery, but normalized evaluation still mismatched `普通车床CA6150B/A×2000（机加工）` against `U8 JPC01 普通车床CA6140A×2000(机加工）` because model suffixes were treated as semantic process differences.
- Rule: AI Routing normalized evaluation may collapse ordinary-lathe machine model suffixes to `普通车床(机加工)` after source-prefix and bracket normalization. Keep raw process IDs separate and do not use this normalization in route generation, persistence, work-center capability checks, or materialization decisions.
- Guardrail: do not broaden this to all machining labels. CNC machining centers, milling, drilling, saw, tap, laser, weld, oxidation, and other process families remain distinct unless separately proven with red/green tests and holdout evidence.
- Verification: `ai-routing-evaluation.test.ts` covers the red/green lathe semantic normalization. The 30-holdout smoke stayed safety-clean and improved normalized exact matches from `18/30` to `19/30` in `apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-lathe-normalization-20260824.json`.

## Stop AI Routing route replacement when remaining holdouts require destructive inference

- Evidence: after the 2026-08-24 ordinary-lathe normalization, the remaining 11 normalized mismatches were triaged in apps/erp/.codex/work/ai-routing-stage4-remaining-mismatch-triage-after-lathe-normalization-20260824.json. The most tempting shaft/thread rows (192472540414, 192739030308) had only thread evidence and no explicit hole evidence, while exact improvement would require dropping tap/CNC and composing saw/turn/mill from multiple weak references. The oxidized shaft row (192472540409) lacked a coherent Training reference that included saw/turn/mill/tap plus external oxidation.
- Rule: do not add AI Routing generation heuristics when the improvement requires destructive replacement of an existing route family, removal of plausible operations, or composition across unrelated weak references without explicit per-operation drawing evidence.
- Guardrail: when residual holdouts are blocked by missing Training coverage or extraction ambiguity, write a triage artifact and move to data governance/extraction improvements instead of lowering thresholds or broadening fallback rules.
## Bump AI Routing drawing prompt when improving extraction evidence boundaries

- Evidence: after the 2026-08-24 remaining-mismatch triage, the next safe work was extraction evidence rather than route-generation replacement. A RED test showed the drawing extraction prompt did not explicitly distinguish part class vs stock form, solid bar vs hollow tube, standalone thread specifications vs visible hole evidence, or saw/turning/external-oxidation cues.
- Rule: when improving model evidence boundaries for AI Routing drawing extraction, bump the auditable prompt version and add focused prompt-shape tests before changing the prompt. Do not claim holdout quality improvement until same-content-hash controlled extractions are rerun with the new prompt version.
- Guardrail: prompt guidance may collect evidence hints for future routing, but it must still forbid proposing operations and must not change route generation, sample roles, work-center assignment, or materialization gates by itself.
- Verification: packages/jobs extraction tests passed 3 files / 11 tests after prompt v3, and scoped Biome passed for the changed jobs files. Evidence: apps/erp/.codex/work/ai-routing-drawing-prompt-v3-evidence-governance-20260824.json.

## Do not map AI Routing turned drawing class directly into shaft routing evidence

- Evidence: prompt v3 same-content re-extraction identified turned/bar for 192759010202 and turned/unknown for 192472540414 and 192739030308. A broad route-generation mapping from part.class = "turned" to 轴类/车削 passed the focused unit red/green check, but the 30-holdout quality gate regressed 192759010202 operation-count delta from -1 to -3.
- Rule: part.class=turned and stockForm=bar are extraction evidence only. Do not globally convert them into route-generation 轴类 feature tags or 车削 process hints without operation-level guardrails that distinguish saw/turn/mill/tap families from sheet/laser/tap mixed families and without holdout proof of no regressions.
- Guardrail: when prompt improvements expose a stronger part class or stock form, first diff persisted extraction evidence and run the holdout quality gate before changing retrieval/routing semantics. If the change only improves one evidence field but harms a mixed-family route, reject and record the regression instead of keeping the heuristic.
- Verification: rejected artifacts are apps/erp/.codex/work/ai-routing-turned-class-mapping-rejected-20260824.json, apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-turned-class-mapping-rejected-20260824.json, and apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-turned-class-mapping-reverted-20260824.json.

## Do not override AI Routing retrieval solely because Training has an exact route family

- Evidence: the 2026-08-24 residual Training coverage diagnostic found 7 remaining normalized mismatches where an exact or covering approved Training route-family signature exists, but the target drawing evidence does not explicitly support every missing operation family. Examples include saw/turn replacements for targets with only hole/thread/tap evidence, and saw/turn actual routes for targets whose extraction points to weldment/welding.
- Rule: Training coverage is necessary but not sufficient for AI Routing generation. Do not override retrieval, replace the selected route, or add saw/turn/mill/tap families solely because an exact Training family exists. Each added or replaced operation family still needs explicit target drawing evidence, process hints, or a previously verified narrow guardrail.
- Guardrail: use residual coverage diagnostics to decide whether the next gate is data governance, extraction improvement, ranking investigation, or TDD implementation. If evidence is weak or contradictory, record the gap and keep materialization closed.
- Verification: apps/erp/.codex/work/ai-routing-residual-training-coverage-diagnostic-20260824.json and apps/erp/.codex/work/ai-routing-residual-training-coverage-decision-20260824.json.
## Do not promote AI Routing data-governance residuals without source review

- Evidence: the 2026-08-24 data-governance residual audit inspected 1927930206, 192769010102, 192472540409, and 192759010202. All four had active Part PDFs and latest succeeded extraction rows, but all four lacked coherent approved Training routes covering their locked actual non-issue operation families. Each also had extraction/source evidence conflicts such as laser hints without laser truth, missing saw/turn/drill/mill support, or turned/bar extraction coexisting with sheet/laser target tags.
- Rule: active PDF evidence, a succeeded extraction, and a locked Evaluation truth route are not enough to promote a residual row into Training coverage or route-generation logic. If extraction-derived target hints conflict with locked actual families, require manual source/PDF review and coherent Training coverage planning before sample-role writes or heuristics.
- Guardrail: keep production/materialization closed for data-governance residuals until source review proves the extraction evidence and route family are coherent. Record the audit artifact instead of using mismatches as direct generation authorization.
- Verification: apps/erp/.codex/work/ai-routing-data-governance-residual-audit-20260824.json.

## Do not infer AI Routing laser solely from sheet/plate evidence or 板 text

- Evidence: human source review on 2026-08-24 confirmed U8 routes are correct for 1927930206, 192769010102, 192472540409, and 192759010202. 1927930206 and 192769010102 are sheet/plate-type parts, but their raw material is not suitable for laser cutting, so laser is a false positive. 1927930202 is a sheet/plate part whose material is suitable for laser cutting, so it is the positive contrast. 192759010202 is 推板连接杆, meaning a connecting rod for the push plate, not a plate part.
- Rule: AI Routing must treat process suitability as material/stock-dependent. Do not infer 激光切割 from 板件, sheet/plate class, or the character 板 alone. Distinguish compound names where 板 modifies a parent object or assembly rather than the part class.
- Guardrail: future code changes must use TDD to preserve laser-positive sheet/plate cases like 1927930202 while removing laser false positives for laser-unsuitable material/stock cases and suppressing 推板连接杆-style 板件 false positives. Do not reopen materialization or write Training roles from these rows until coherent source-reviewed Training coverage exists.
- Verification: apps/erp/.codex/work/ai-routing-human-source-review-findings-20260824.json records the human findings and keeps route-generation/sample-role/work-center/materialization gates closed.
## Do not globally remove AI Routing sheet-laser hints without material suitability data

- Evidence: a 2026-08-24 TDD implementation tried to remove implicit sheet/plate -> 激光切割 hints unless explicit laser evidence existed. The focused tests passed, but the 30-holdout gate regressed normalized exact matches from 19/30 to 14/30 and operation-count matches from 24/30 to 19/30 because existing positive laser sheet/bend rows do not yet expose raw-material suitability as separate target evidence.
- Rule: material-aware laser routing needs an explicit material/stock suitability source. Until that source exists in drawing extraction or item/raw-material evidence, do not globally remove sheet/plate laser hints. Suppress laser only when explicit negative material/stock evidence says the part is not laser-suitable, or when a targeted semantic disambiguation proves the part is not actually sheet/plate.
- Guardrail: keep positive contrast cases such as 1927930202 working, and treat 1927930206/192769010102 as source-reviewed data constraints that require additional raw-material suitability evidence before a broader production rule can be enforced.
- Verification: apps/erp/.codex/work/ai-routing-material-aware-laser-guardrail-decision-20260824.json records the rejected broad attempt and retained narrow guardrail; apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-material-aware-laser-guardrail-20260824.json records normalized exact 19/30, operation-count 24/30, and all safety counters 0.
## Do not infer AI Routing laser suitability from unstructured raw-material names

- Evidence: the 2026-08-24 material suitability source audit inspected 1927930206, 192769010102, and positive contrast 1927930202. Each target has one Active make-method raw-material row, but neither the target item nor the raw-material item has populated structured material properties such as materialSubstance, materialForm, materialType, dimension, grade, or finish. The raw-material item names differ (`定尺铝合金毛坯6061-T6` vs `SUS304 拉丝板-3.0×1220×2440`), but no explicit positive/negative laser suitability field or text exists in current structured target evidence.
- Rule: method raw-material item names are audit clues, not route-generation authorization. Do not suppress or add 激光切割 from free-text names such as 毛坯 or 拉丝板 without an approved curated mapping or explicit source field that represents laser suitability.
- Guardrail: before implementing broader material-aware laser routing, expose or import structured raw-material/stock suitability evidence, then use TDD to preserve 1927930202 while suppressing 1927930206 and 192769010102 only from that explicit evidence source.
- Verification: apps/erp/.codex/work/ai-routing-material-suitability-source-audit-20260824.json and apps/erp/.codex/work/ai-routing-material-suitability-source-decision-20260824.json.
## Treat U8 laser raw-material packets as positive evidence, not negative rules

- Evidence: 2026-08-24 U8 SELECT-only packets sampled active routes containing XJG01 数控激光切割. The initial 100-part analyzer found plate/flat recursive leaf raw material in 99/100 parts and purchased + operationSequence 0020 + plate/flat raw material in 98/100 parts, while also finding non-plate edge cases and one laser-positive 毛坯 row. The expanded 1000-part analyzer confirmed the part-level signal is stable: plate/flat recursive leaf raw material covers 993/1000 parts, and purchased + operationSequence 0020 + plate/flat raw material covers 986/1000 parts.
- Rule: positive-only laser samples can support a future positive evidence source, especially recursive leaf raw material tied to the laser operation, but they do not prove that non-plate, 毛坯, or missing plate evidence should suppress laser. Negative suppression needs no-laser/control samples and an explicit U8 raw-material evidence adapter.
- Guardrail: keep route generation unchanged until the evidence source is connected to AI Routing target evidence, the signal is stable on the larger sample, and RED tests preserve laser-positive examples while suppressing only source-proven laser-unsuitable examples.
- Verification: D:\Object\carbon\.codex\work\u8-laser-material-evidence-analysis-20260824.json, D:\Object\carbon\.codex\work\u8-laser-material-evidence-analysis-20260824.md, D:\Object\carbon\.codex\work\u8-laser-material-evidence-analysis-1000-20260824.json, D:\Object\carbon\.codex\work\u8-laser-material-evidence-analysis-1000-20260824.md, and D:\Object\carbon\.codex\work\u8-laser-query-100-vs-1000-20260824.md.



## Exclude component assemblies from AI Routing Training and generation scope for now

- Evidence: on 2026-08-25 the process owner/user confirmed that component parts such as `1000001801 / 2408340800 / 3T上封头组件（1600)` can temporarily be left out of Training samples and AI process-route generation. The 1000-part XJG01 sample contains 67 names/codes matching `组件`.
- Rule: `组件` parts may be valid U8/process data, but they are out of current AI Routing Training/reference and route-generation scope. Exclude them into a separate scope bucket; do not mix them into illegal laser-positive samples and do not use them to infer part-level routes.
- Guardrail: this is a scope exclusion, not a data-quality judgment. If component routing is later required, create a separate component/assembly routing plan with its own Training set and validation rather than reusing part-level laser evidence directly.
- Verification: `.codex/work/ai-routing-laser-component-out-of-scope-samples-20260825.csv`, `.codex/work/ai-routing-laser-legal-data-filter-20260825.json`, and `.codex/work/ai-routing-laser-suitability-review-template-20260825.xlsx` record 67 component exclusions, 928 scope-eligible legal candidates, and 5 in-scope illegal rows.
## Filter U8 laser-positive evidence by plate-class raw material legality

- Evidence: on 2026-08-25 the process owner confirmed that laser cutting is only suitable for parts whose constituent raw material includes plate-class material; U8 routes that contain laser but whose recursive leaf raw materials contain no plate-class material are not legal data. A category-only filter found 993 legal candidates and 7 illegal route-positive rows; after manual confirmation that `372239001002 / 定尺不锈钢毛坯-316` is fixed-size stainless plate, the reviewed filter has 995 legal candidates, 5 illegal rows, and 2 manual-override legalized rows (`24018403`, `24018503`).
- Rule: a U8 laser-positive sample may be used as legal laser-positive evidence only when the recursive leaf raw materials include at least one plate-class raw material, either from U8 category `板材/平板` or an explicit approved raw-material-code override such as `372239001002 / 定尺不锈钢毛坯-316`. Not every raw material must be plate-class: multi-material parts such as `2401870400 / 10T下封头组件（单点下液位）`, with `SUS304 2B平板-3.0×1220×2440` plus `304SMS活结 51` and `10T2300无折边封头`, remain legal candidates because they include plate material.
- Guardrail: plate-class raw material is necessary but not sufficient. It supports laser only with geometry/drawing/process evidence and reviewer approval; raw-material free text, BOM operationSequence `0020`, U8 route truth, or an approved plate-material override alone must not add/suppress laser or reopen materialization.
- Verification: `.codex/work/ai-routing-laser-legal-data-filter-20260825.json`, `.codex/work/ai-routing-laser-illegal-non-plate-positive-samples-20260825.csv`, and `.codex/work/ai-routing-laser-suitability-review-template-20260825.xlsx`.
## AI Routing laser controls require no-laser routes plus recursive raw-material evidence

- Correction: a no-laser control set is not just "part name contains 板 but no XJG01". That is only one useful subgroup.
- Rule: control samples for material-aware laser evidence should require an active U8 route with no XJG01/no laser-or-cutting-equivalent operation, an active BOM, and recursive expansion to leaf raw materials. Preserve route operations, BOM operation sequence such as 0010/0020/0030, `OpComponentId`, raw-material code/name/specification, purchase/make flags, and recursive level.
- Required groups: name contains 板 with no laser, recursive leaf raw material is 板材/平板 with no laser, 毛坯/6061-T6 with no laser, plate-like geometry with machining route, and non-plate boundary samples such as tube/bar/head/purchased finished components.
- Evidence: `.codex/work/u8-no-laser-control-summary-20260824.json` and `.codex/work/u8-no-laser-control-report-20260824.md` exported 1,182 de-duplicated control parts and 32,936 leaf raw-material rows, including 1927930206 and 192769010102 with `定尺铝合金毛坯6061-T6` and no route filter violations.

## AI Routing structured extraction prompts must constrain enum arrays

- Evidence: the valid `19267202010201` Part PDF repeatedly failed with `No object generated: response did not match schema` even though rendering and text-layer extraction succeeded. A direct model diagnostic showed the model returned a complete object, but `explicitUnknowns` contained `tolerances`, which is not in `aiRoutingDrawingUnknownFields`.
- Rule: when an AI structured-output schema contains enum arrays, the prompt must explicitly list allowed enum values and forbid common near-miss labels. Bump the prompt version and add a focused prompt-shape regression test before retrying business extraction.
- Verification: `extract-part-drawing-model.test.ts` failed before the prompt guidance, passed after prompt v4, and `19267202010201` succeeded with extraction `aide_TQYBS3gcGcRNac2Zbek1Cy`; imported PDF training coverage reached 247/247 with 0 Evaluation samples.

## Do not ship component-scope retrieval exclusion before replacing unique route-family coverage

- Evidence: the 2026-08-25 Phase 2 filtered retrieval simulation excluded three component-scope Training samples in memory (`191967100102 / 转轴座组件2`, `19271341030100 / 后挡板调节组件`, and `192728690100 / 滑动组件`). Safety counters stayed clean, but `19276939010203` lost its turning operation after `191967100102 / 转轴座组件2` was excluded, dropping operation-count matches from 22/30 to 21/30.
- Rule: component assemblies should stay out of part-level AI Routing retrieval, but the exclusion must not be shipped until any unique process-family support they were providing, especially turning/drill-tap/saw support, is replaced by legal non-component Training coverage or handled by a narrower reviewed rule.
- Guardrail: before implementing retrieval-side component exclusion, run the locked 30-holdout filtered-pool gate and stop on operation-count or semantic-route regression; do not treat clean safety counters alone as sufficient.
- Verification: `.codex/work/ai-routing-filtered-training-simulation-20260825.json`, `.codex/work/ai-routing-filtered-training-simulation-20260825.md`, and `.codex/work/ai-routing-filtered-training-coverage-20260825.csv`.

## Do not confuse AI Routing component-exclusion regressions with total coverage gaps

- Evidence: the 2026-08-25 filtered-pool regression diagnostic for `19276939010203` found that component filtering removed `191967100102`, the only eligible laser/turning recovery candidate inside the current top-20 search window. The target still had valid plate, shaft, hole, laser-cutting, turning, and explicit hole evidence.
- Rule: when excluding unsafe or out-of-scope Training samples regresses AI Routing, distinguish actual coverage absence from candidate reachability. Inspect eligible candidates beyond the helper's current ranking window before deciding to keep unsafe examples or add new heuristics.
- Guardrail: a component-scope exclusion may be valid while the recovery helper still needs a narrower evidence-specific search or ranking adjustment. Any such change must be simulated on the locked holdouts and 247 drawing-backed smoke set before implementation.
- Verification: `.codex/work/ai-routing-filtered-pool-regression-diagnostic-20260825.json` recorded 11 retained non-component PDF-backed `keep_candidate` turning samples satisfying the existing laser/turning criteria anywhere in the ranked pool, but 0 inside the top-20 recovery window; the first retained replacement was `192770010401` at filtered rank 35.

## Do not infer AI Routing shaft/turning from bearing-seat text

- Evidence: the 2026-08-25 remediation simulation showed that broadening laser/turning recovery beyond the top-20 window fixed `19276939010203`, but also incorrectly appended turning to `19267202210104 / 轴承座板`. The target route is laser-only, but target evidence contained shaft/turning because the text includes the character `轴` inside `轴承`.
- Rule: `轴承`, bearing-seat, and bearing-housing terms are not shaft-part evidence by themselves. Do not infer `轴类` or `车削` from the single character `轴` when it appears as part of bearing-related nouns.
- Guardrail: before widening evidence-specific laser/turning candidate search, add semantic disambiguation and rerun both the locked 30-holdout gate and 247 drawing-backed smoke set. A holdout improvement is insufficient if a smoke sample gains an unsupported operation.
- Verification: `.codex/work/ai-routing-filtered-pool-remediation-simulation-20260825.json` recorded 30-holdout operation-count improvement `21 -> 22`, but 247-PDF smoke regression on `19267202210104` with exact matches `101 -> 100`, operation-count matches `130 -> 129`, and turning matches `209 -> 208`.
## Keep AI Routing laser/turning reachability widening helper-scoped

- Evidence: the 2026-08-25 TDD reachability regression proved that a laser/turning target can lose turning when the only legal retained turning reference is ranked beyond the helper top-20 window. The RED test produced only `proc-ll -> proc-laser`; after the helper-scoped fix it produced `proc-ll -> proc-laser -> proc-turn` without copying saw or tap extras.
- Rule: do not widen global AI Routing retrieval or unrelated recovery helpers to fix a laser/turning reachability gap. Widen only the strict `laserTurnEvidenceOperations` evidence search, after the target has plate + shaft + hole + explicit hole evidence + laser and turning hints, and after bearing-seat semantic disambiguation prevents false shaft evidence.
- Guardrail: after any helper-specific search-window change, rerun the focused AI Routing tests plus the locked 30-holdout and 247 drawing-backed smoke gates. The change is not valid if it adds unsupported operations, assigns work centers, leaks Evaluation samples, or changes materialization state.
- Verification: `pnpm --filter erp exec vitest run app/modules/items/ai-routing.test.ts` passed 24/24; `.codex/work/ai-routing-filtered-pool-remediation-simulation-20260825.json` recorded filtered-pool 30-holdout current operation-count matches 22/30 and 247-PDF smoke unchanged at exact 101/247, operation-count 130/247, turning 209/247, with all safety counters 0.
## Gate AI Routing Training-reference eligibility before ranking

- Evidence: after component-scope and laser-material legality review, current Approved Training rows can remain useful audit evidence while being unsafe as part-level retrieval references. A RED test proved `rankSimilarRoutingSamples` still ranked component and illegal-laser-marked samples until a runtime eligibility gate was added.
- Rule: keep unsafe AI Routing samples out of retrieval at the domain ranking boundary before scoring. Do not require immediate sample deletion, retirement, or Evaluation reclassification when a recoverable audit trail can be preserved.
- Contract: component text is excluded as `component_scope`; process-owner or audit results can use existing `aiRoutingSample.customFields.aiRoutingScope.exclusionReasons` with reasons such as `component_scope` or `illegal_laser_no_plate` so future imports need no schema migration.
- Verification: `pnpm --filter erp exec vitest run app/modules/items/ai-routing.test.ts app/modules/items/ai-routing.server.test.ts` passed 44/44; `.codex/work/ai-routing-runtime-scope-eligibility-audit-20260825.json` recorded 345 Approved Training samples, 342 eligible references, and 3 component-scope exclusions; filtered-pool simulation kept all safety counters at 0.

## Use the process department standard workbook for AI Routing process/work-center references

- Rule: for the current AI Routing work, treat `E:\Wodi_Project\工艺标准模板.xlsx` as the authoritative current process/work-center standard source supplied by the process department. Use sheet `工作中心代码` for work-center code/name standards and sheet `工序名称` for process-name/content standards.
- Guardrail: this authorizes standard-source mapping and audit evidence only. Do not directly write work centers into AI Routing drafts, formal routes, or materialized routes until a mapping/capability adapter is designed and verified against holdout/PDF smoke gates.
- Verification: `.codex/work/ai-routing-process-standard-source-audit-20260826.json` records 75 work-center rows, 73 unique work-center codes, 49 process-name rows, and 47 unique process names from the workbook. Duplicate codes/names and exact-label mismatches are mapping work items, not automatic data-quality failures.
## Invalidate permission cache after onboarding repairs employee membership

- Evidence: liming@carbon.local had valid database membership, employee, employeeJob, Admin employee type permissions, and get_claims returned role: employee; however Redis still stored permissions:79d201d2-c51e-4f41-8a9c-37dfe2140df3 as {"permissions":{},"role":null} from the earlier partial onboarding state. After /callback, /x SSR threw usePermissions must be used within an authenticated route until onboarding cleared that cache.
- Rule: any onboarding, invite, company-selection, or company-creation path that creates or repairs employeeJob, employee type, user-company membership, or permission-bearing rows must invalidate getPermissionCacheKey(userId) before redirecting to the authenticated root.
- Guardrail: onboarding company data must be split by destination table. Do not pass company-only fields such as baseCurrencyCode, website, tax IDs, phone, fax, or email into location; update existing seeded default locations instead of inserting duplicate Headquarters, and idempotently ensure terms and companySettings for partially restored companies.
- Verification: pnpm --filter erp exec vitest run app/routes/onboarding+/company.helpers.test.ts --config vitest.config.ts passed 1/1; pnpm --filter erp build passed; deployed rebuilt ERP bundle to carbon-erp-1; runtime liming flow produced callback 302, onboarding 302 to /x, /x HTTP 200, no Application Error, no permission hook error, and Redis claims refreshed with role: employee.

## 2026-08-26 — userDefaults is a derived view, not a repair target

- When repairing a user's selected/default company or location, do not insert/update/delete `userDefaults` directly. It is a derived view from `user` + `employeeJob` + `location`; repair the underlying `employeeJob` rows and membership rows instead.
- For user/company migrations, validate and update `userToCompany`, `employee`, `employeeJob`, and `userPermission`, then verify `userDefaults` read-only output after the transaction.

## 2026-08-26 — Do not force-delete companyGroup protected accounting seeds

- Empty onboarding-created companies can be safely deleted only after verifying no members, no item/part/business rows, no non-cascade company references, and no userPermission references. Let company-scoped seed/config rows cascade from `company` when guarded.
- Do not force-delete an associated `companyGroup` if it cascades into protected system accounts. The `protect_system_accounts()` trigger is an intentional guardrail; deleting the company row removes the selectable company without bypassing protected accounting seed rules.

## 2026-08-26 — Accept pending employee invites before onboarding company creation

- Evidence: caowx@carbon.local, chend@carbon.local, and panyb@carbon.local all had valid target-company employee/employeeJob rows but were missing `userToCompany`, so magic-link login selected or created empty onboarding companies instead of the data company. A runtime regression user with `membership=0`, `employee.active=false`, and one pending employee invite was accepted during `/callback`, redirected to `/x/items/parts`, and ended with target-company membership, active employee, accepted invite, and target permissions.
- Rule: magic-link callback and onboarding/company submit must check for exactly one pending, unrevoked employee invite for the authenticated email before company selection or company creation. If present, accept it using the normal invite activation path, prefer that company for the session cookie, update billing in Cloud, and clear permission cache through the existing invite permission path.
- Guardrail: do not auto-accept multiple pending employee invites; require explicit company/invite choice to avoid ambiguous company assignment. Do not restore old deactivated employees that have no pending invite.
- Verification: `pnpm --filter erp exec vitest run app/modules/users/pending-invite-login.server.test.ts app/routes/onboarding+/company.helpers.test.ts --config vitest.config.ts` passed 3/3; `pnpm --filter erp build` passed; deployed rebuilt ERP bundle to `carbon-erp-1`; runtime pending-invite login produced callback 302 to `/x/items/parts`, page HTTP 200, no Application Error, target company visible, DB `userToCompany=1`, employee active true, accepted invite count 1, pending invite count 0, and target permission row present.
## Treat process-owner folded-edge closure confirmation as explicit AI Routing weld evidence

- Evidence: the filled 2026-08-28 weld-evidence review workbook for `192766040302 / 防护罩1` and `192766040304 / 护罩2` marks both rows `工艺路线正确` and `允许`, with explanation `折弯边需要封闭所以需要氩弧焊`, even though the PDF text layer has no `焊/焊接/焊缝/weld` text and only contains `表面拉丝处理`.
- Rule: absence of weld text in the PDF text layer is not enough to reject weld/grind positive evidence when a process owner explicitly confirms a geometric manufacturing reason for welding. Treat the confirmation as human source evidence, not as a broad visual/text heuristic.
- Guardrail: do not infer welding from every folded edge globally. Any route-generation use of this pattern must have a guarded target-evidence/sample-metadata path, red-green tests, and read-only impact simulation proving no Evaluation regression, no unsupported process IDs, no work-center assignment, and no materialization.
- Verification: `.codex/work/ai-routing-weld-evidence-human-review-filled-20260828.json` records 2 allowed weld/grind positive samples, 0 rejected, 0 pending. Code verification then covered the guarded parser and server forwarding with red/green tests; full AI Routing tests passed `52/52`, Biome checked 4 files, and read-only impact scans kept existing Evaluation regressions and safety counters at `0`. Live weak-row metrics intentionally did not change because no Carbon DB/sample metadata was written.


## Preserve Unicode literals in generated diagnostic scripts

- Evidence: the first 2026-08-30 outsourcing/surface diagnostic script pass encoded Chinese match constants as `??`, which incorrectly classified all three rows as `hold`. Rewriting the script with Unicode escape literals restored the expected split: `needs_base_route_guard=2`, `hold=1`.
- Rule: when generating temporary diagnostics that match Chinese process names, write match constants with Unicode escapes or verify the source file immediately after writing. Do not trust a diagnostic artifact until the source constants and output counts are checked.
- Verification: `.codex/work/ai-routing-outsourcing-surface-evidence-diagnostic-20260830.json` records 3 rows, with `192672060101` and `192713850911` requiring base-route guard and `192744070201` held for missing target surface evidence.
## Treat shaft saw/cutoff as stock-preparation evidence only with same-type support

- Evidence: the 2026-08-31 U8 same-type diagnostic for `192744070201 / 旋转轴` checked active shaft-like routes and found strict shaft+turning support 4278/4929 with saw/cutoff; 651 same-cohort rows still lacked saw/cutoff. The target route has saw/cutoff before turning.
- Rule: for a reviewed strict shaft-like part with turning evidence, saw/cutoff may be treated as stock-preparation evidence when supported by user/process confirmation, the target active route, and same-type U8 cohort evidence. This is not a universal rule and does not apply to names containing bearing, plate, seat, bracket, assembly, or mounting terms.
- Guardrail: do not turn this into a broad generation rule without a narrow TDD guard, source/evidence packet, and read-only impact simulation proving no unsupported operations, work-center assignments, sample-role changes, or materialization.
- Implementation update: the generator may consume this evidence only through exact `process_owner_review` evidence type `shaft_stock_preparation_requires_saw_cutoff`, with `锯床` as the required process hint; `镀锌` is separately guarded by explicit drawing/title/note/surface evidence.
- Verification: `.codex/work/ai-routing-shaft-saw-route-diagnostic-20260831.json` records the cohort counts and target classification; the 2026-08-31 narrow TDD cycle passed full AI Routing tests 53/53, Biome 4 files, locked Evaluation regression flags 0, and safety counters 0; production/materialization gates remained closed.
## Do not treat high U8 cohort support as explicit milling evidence

- Evidence: the 2026-08-31 oxidation/milling diagnostic found strong same-type U8 support for milling before tap/oxidation: `192672060101 / 连接板1` had 216/218 support in the no-laser/no-bend connection-plate tap+oxidation cohort, and `192713850911 / 推箱垫1` had 148/152 support in the no-laser/no-bend pad tap+oxidation cohort.
- Rule: strong same-type U8 support is useful for process-owner review and target-specific diagnostics, but it is not by itself target-available evidence for adding `铣削/加工中心` when the drawing/extraction lacks explicit milling/machining-center evidence.
- Guardrail: before implementing milling base-route recovery, require either explicit target drawing evidence or an exact whitelisted human/process-owner evidence type, then use RED/GREEN tests and read-only impact simulation.
- Verification: `.codex/work/ai-routing-oxidation-milling-base-route-diagnostic-20260831.json` records `readyForTddGuardCount=0`, `generationRuleAuthorizedCount=0`, and production gate closed.

## Use process-owner confirmation for tapped/anodized plate-pad milling only through exact human evidence

- Evidence: the 2026-08-31 oxidation/milling diagnostic showed strong but non-universal same-type U8 support for milling before tap/oxidation (`192672060101` 216/218 and `192713850911` 148/152). On 2026-09-07 the process owner confirmed that `连接板`/`垫` parts with explicit tapped holes and anodizing require `数显立铣` / `立式铣床` / `加工中心` as the base route even when the drawing text does not explicitly say milling.
- Rule: route generation may consume this only through exact `process_owner_review` evidence type `machined_plate_pad_tap_oxidation_requires_milling_base_route`, with `allowed=true`, non-empty text/explanation, and a required `铣削` process hint.
- Guardrail: this does not convert U8 cohort support into a universal generation rule, does not infer laser, does not assign work centers, and does not write sample roles or formal routes. Targets without this exact human evidence or explicit drawing milling evidence must continue to have unsupported milling pruned.
- Verification: the 2026-09-07 TDD gate first failed on missing `铣削`, then passed focused, adjacent, and full AI Routing tests (54/54), Biome, and read-only impact simulations with locked Evaluation routeChanged=0/topReferenceChanged=0/regressionFlags=0 and safety counters 0.
## Keep operation-granularity gaps out of generation until evidence separates variants

- Evidence: the 2026-09-07 operation-granularity diagnostic checked 8 current granularity rows against U8 active routes. Same-type support was mixed rather than rule-grade: fixed-plate drill support 396/888, adjust-plate drill support 22/38, guide-rod saw+turn support 30/87, and welded plate/cavity machining-center support 10/1420.
- Rule: drill-before-tap, drill-only, guide-rod saw/turn/mill, and welded-cavity machining-center variants require exact drawing evidence or process-owner confirmation before they become route-generation evidence. U8 cohort support alone is not enough when exceptions are common.
- Guardrail: duplicate actual-route rows must be treated as sample/data-quality cleanup first. If U8 active routes are not duplicated but Carbon Evaluation/Training snapshots are duplicated, do not count the mismatch as an AI generation error and do not learn from the duplicate actual route.
- Verification: `.codex/work/ai-routing-operation-granularity-next-diagnostic-20260907.json` and `.codex/work/ai-routing-operation-granularity-human-review-questions-20260907.json` record 5 process-owner confirmation rows, 3 duplicate-snapshot cleanup rows, zero generation-authorized rows, and closed production/materialization gates.
## Keep SSR route labels locale-safe

- Evidence: the Items personal workbench route first used top-level Lingui `t(...)` labels and SSR failed with `Lingui: Attempted to call a translation function without setting a locale`; replacing those runtime labels with stable rendered text restored the container and browser page. A later route render also exposed uncompiled message IDs from newly added sidebar/breadcrumb descriptors.
- Rule: do not call global Lingui translation functions while route modules are loading or in SSR paths before locale activation. For newly introduced labels, ensure they are compiled into the locale catalog or use a stable existing-language literal when the route must render safely before catalog initialization.
- Verification: `pnpm --filter erp exec vitest run app/modules/items/workbench.test.ts` passed 5/5; scoped Biome passed; ERP production build passed; `carbon-erp-1` healthy; browser verified `/x/items/workbench` and `preset=2w` without a 500. The 2026-09-03 Activity Projection pass also checked temporary production SSR logs for `Uncompiled message`, `Application Error`, `workbenchActivity`, `PGRST`, and `42P01`; no matching errors remained after adding catalog entries for `我的工作台` and `个人工作台`.

## Keep workbench projections separate from compliance audit writes

- Evidence: the 2026-09-03 Items workbench activity projection implementation writes the existing company audit log and the new `workbenchActivity` projection in separate Inngest steps. Focused jobs tests passed 15/15, and the migration rollback test proved the projection RPC can be created and rolled back without changing live data.
- Rule: do not hide projection failures behind successful compliance audit writes. Keep durable audit insertion and derived workbench projection as separately named retryable steps so a projection outage can retry without duplicating or silently dropping the compliance audit record.
- Guardrail: projection tables are read models. Keep writes service-role-only through validated RPCs, preserve idempotency keys, and do not bypass the existing audit log as the source event stream.

## Schema-qualify helpers used by database ID generators

- Evidence: caowx's 2026-09-10 Items workbench backfill failed inside `upsert_workbench_activity_batch` because the `workbenchActivity.id` default calls `public.id('wba')`; that function used unqualified `uuid_to_base58(...)`, which is invisible when called from a SECURITY DEFINER function with `search_path = pg_catalog, pg_temp`.
- Rule: database helper functions used by table defaults, SECURITY DEFINER RPCs, or hardened migrations must schema-qualify their helper calls and set an explicit safe `search_path` when they depend on non-`pg_catalog` objects.
- Verification: a rollback test first reproduced `function uuid_to_base58(uuid) does not exist`; migration `20260910121742_schema_qualify_id_generator.sql` then allowed `public.id('wba')` and `upsert_workbench_activity_batch` to run in the same restricted context. The live fix backfilled 22 caowx import activities and the workbench page showed “22 条活动记录”.

## Strip quoted environment values during temporary production verification

- Evidence: the 2026-09-03 temporary ERP production verifier on port 3010 only authenticated correctly after loading `.env` and `.env.local` with surrounding quotes stripped; otherwise session cookie signing secrets can mismatch the running app.
- Rule: when starting or probing a temporary Carbon production-style process from PowerShell, normalize environment file values by removing only matching surrounding single or double quotes before building cookies or comparing secrets.
- Guardrail: keep these verifier scripts in `.codex/work/`, delete temporary scripts after use, and do not restart or mutate the live Docker stack unless the user explicitly authorizes it.

## Pass full-Docker env files when running Docker Compose directly

- Evidence: the 2026-09-04 ERP image build succeeded, but running `docker compose` directly without explicit env files emitted blank-variable warnings for `PORT_ERP`, `PORT_DB`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ERP_URL`, and related full-Docker variables. Recreating only `erp` with `--env-file .env --env-file .env.local` preserved the expected `localhost:3000` mapping.
- Rule: when bypassing `crbn up` and invoking `docker compose` directly in this repository, include both `.env` and `.env.local` before the compose file so interpolation and runtime env match the active local stack.
- Guardrail: prefer service-scoped operations such as `up -d --no-deps --force-recreate erp` when only ERP needs replacement; do not restart the full stack unless the task explicitly requires it.

## U8采购接口资料目录以模块目录为准

- 2026-09-03 U8 EAI 采购订单开发中，用户纠正旧路径 `D:\U8dev\采购订单` 不存在，当前采购单和请购单完整接口资料位于 `D:\U8dev\采购管理`。
- 规则：后续查 U8 采购接口文档时先列 `D:\U8dev\采购管理`，并区分 `采购订单-*` 与 `请购单-*` 文档；不要沿用旧的 `采购订单` 目录名。

## U8 EAI HTTP 登录由服务器端外部系统注册控制

- 2026-09-03 U8 EAI 采购订单装载实测中，`D:\U8dev\u8eai` Demo 和 `U8开发之EAI接口.docx` 均表明 HTTP 模式只 POST EAI XML 到 `/U8EAI/import.asp`，请求中不传 U8 用户名密码；`sender` 是外部系统注册码。
- 实测 `http://192.168.1.21/U8EAI/import.asp` 网络可达，`sender=006`、`sender=001` 与 `sender=110` 均返回 `EAI数据源eai default-login failed`，说明请求已到达 U8 EAI；即使 sender 使用账套号，服务器端 EAI 数据源或账套登录配置仍会先阻断请求。
- 规则：后续 U8 EAI 程序不得再混入 U8 开放平台 AppKey/AppSecret、OpenAI Key 或 SQL 直连作为运行路线；应先确认 `企业应用集成(EAI) -> EAI 接口设置 -> 外部系统注册` 中的 sender、账套、数据源和绑定 U8 集成用户权限。


## U8 EAI API 模板优先使用 GB2312 请求编码

- 2026-09-03 复查 `D:\U8dev\u8eai\src\main\resources\Template\API` 后确认，采购订单 API 模板 `采购订单_加载.xml`、`采购订单_新增.xml`、`采购订单_修改.xml` 均声明 `encoding="gb2312"`，且加载接口为 `U8API/PurchaseOrder/GetVoucherData`。
- 证据：同一 `sender=006`、采购订单 `P260904978`、`GetVoucherData` 请求，按 UTF-8 XML/字节发送会触发 U8 服务端空引用异常；程序已改为 GB2312 XML 声明和 GB2312 字节发送，并通过新增回归测试。
- 规则：后续 U8 EAI XML/HTTP 程序应优先按模板生成 GB2312 XML 声明，并用 GB2312 字节 POST；除非厂家确认该接口版本支持 UTF-8，不要用 UTF-8 调采购管理 U8API 模板。
- 后续排查重点：`GetVoucherData` 模板默认 `varVoucherID` 为单据主表 ID，不能假定采购订单号 `cPOID` 可直接完成装载；若 GB2312 后仍异常或空数据，应确认正确的 `varVoucherID/strWhere/strLocateWhere` 组合、账套年度和 U8API 服务端日志。

## U8 EAI PurchaseOrder CancelconfirmPo server null-reference needs vendor-side diagnosis

- Evidence: On 2026-09-03, purchase order `P260904978` in account set `006` was read-only verified as audited (`POID=1000011299`, `cVerifier=徐振金`, `iverifystateex=2`, `uftsBigint=470400113`). Two GB2312 EAI XML/HTTP `U8API/PurchaseOrder/CancelconfirmPo` calls were made with `proc="unverify"`: one fuller DomHead payload and one required-field-minimal DomHead payload. Both reached `/U8EAI/import.asp` and returned HTTP 200 with `succeed="-2147467261"` and `错误位置:15`; a final read-only status query showed the order remained audited and unchanged.
- Rule: Do not treat SQL-read reconstructed DomHead payloads as proven valid for purchase-order unverify. Until U8 `GetVoucherData` can return a usable BO or the vendor confirms the exact EAI XML contract, keep `CancelconfirmPo` failures as server/API-contract diagnostics rather than adding retries or fallback writes.
- Artifacts: `.codex/work/u8-eai-cancelconfirm-P260904978-test-20260903.md`, `*-request.xml`, `*-response*.xml`, and `*-result.json`.

## U8 v16.5 EAI HTTP uses raw XML body, not xml form parameter

- Evidence: On 2026-09-03, the user confirmed U8 is v16.5. A read-only `U8API/PurchaseOrder/GetVoucherData` probe for `P260904978` compared four POST modes. Raw GB2312 XML body with `application/x-www-form-urlencoded; charset=gb2312` and raw GB2312 XML body with `text/xml; charset=gb2312` both reached U8API and returned the known server null-reference error. `xml=` form parameter submissions, both percent-encoded and plain, returned `succeed="101"` / `传入的是非法的Xml数据`.
- Rule: For this U8 v16.5 EAI endpoint (`/U8EAI/import.asp`), continue sending the complete EAI XML as the raw request body. Do not switch to old-style `xml=` form-parameter submission unless a separate server explicitly proves that requirement.
- Artifacts: `.codex/work/u8-eai-post-mode-probe-20260903.md`, `.codex/work/u8-eai-post-mode-probe-20260903.json`, and `.codex/work/u8-eai-post-mode-*-response.xml`.

## U8 EAI GetVoucherData returns BO rowsets through CDATA params

- Evidence: On 2026-09-03, read-only `U8API/PurchaseOrder/GetVoucherData` probes for purchase order `P260904978` showed that successful U8 v16.5 responses place purchase-order data in `<param name="domhead">` and `<param name="dombody">` CDATA rowsets, not direct `<field>` child nodes. The successful response contained one header row and two body rows with `varVoucherID=1000011299`.
- Rule: U8 EAI parsers must parse `domhead/dombody` parameter CDATA as rowset XML and read `z:row` attributes case-insensitively. Do not assume BO output arrives as ordinary `<field name="..." value="..."/>` nodes.
- Guardrail: For this purchase-order `GetVoucherData` path, `strWhere` variants using `cPOID` or `POID` returned empty rowsets, while `varVoucherID=POID` returned BO in the successful probe. Treat order-number-to-POID resolution as an unresolved EAI contract/vendor question; do not implement runtime SQL lookup as an interface shortcut.
- Current blocker: Subsequent identical raw GB2312 `varVoucherID=1000011299` requests reproduced U8API server null-reference `succeed="-2147467261" / 错误位置:15` five consecutive times, so live service stability or server-side U8API configuration must be diagnosed before further `CancelconfirmPo` tests.

## U8 EAI real DomHead must be filtered to the action BO schema

- Evidence: On 2026-09-04, after EAI default-login recovery, `GetVoucherData` returned a valid purchase-order `DomHead` for `P260904978`. Sending every returned rowset attribute to `CancelconfirmPo` reached the API but returned `BO对象不存在字段cvoucherstate`; `cvoucherstate`, `bstorageorder`, `iprintcount`, and `editprop` are response extensions absent from the documented unverify BO.
- Rule: For U8 v16.5 purchase-order unverify, start from the real `GetVoucherData` row, preserve its values, and project only fields declared by the `采购订单-弃审订单` BO definition. Do not blindly echo all response rowset attributes. Use one guarded request and re-read the order through EAI after a successful response.
- Verification: Removing only those four undefined fields produced `issuccess="true"`; the subsequent read-only `GetVoucherData` returned `cstate=0`, `iverifystateex=0`, `cvoucherstate=开立`, no verifier, and the original two detail rows.
## U8 VoucherSave BO 不能直接回显 GetVoucherData 的全部 rowset 字段

- 2026-09-07 对采购订单 `P260904978` 做 EAI `VoucherSave` 修改时，直接把 `GetVoucherData` 返回的表体字段全部回显会依次被 U8 v16.5 拒绝：`cgroupcode`、`ccomunitcode`、`ireceivedqty` 均不是该修改接口 BO 的合法字段。移除这些返回扩展/只读字段后，`VoucherSave` 成功并回读确认数量变更。
- 规则：更新类 U8API 必须按对应接口文档的 BO 字段白名单投影输入，不能把装载接口返回 rowset 当作可写 BO 原样提交；每次写入后必须通过同一 EAI 装载接口回读验证，未验证成功时不得继续状态动作。
- U8 v16.5 本次成功契约：原始 XML Body 以 GB2312 发送，读取请求保留 `strLocateWhere` 和 `returnParams` 中的 `DomHead`/`DomBody`；响应按 XML 声明选择 UTF-8 或 GB2312 解码。

## U8 VoucherSave 新增应以返回主键和回读单号为权威

- 2026-09-07 复制采购订单 `P260904978` 时，客户端建议 `cpoid=P260907001`，U8 `VoucherSave` 返回 `curID=1000011442` 后实际生成 `P260905098`。新增已成功，不能把建议单号不一致误判为失败。
- 规则：新增响应只认 `issuccess=true` 与非空 `curID`；后续必须按返回主键回读，使用回读 `cpoid` 作为最终单号。建议单号与实际单号不同不得触发第二次新增。
- 保护：源单读取、字段白名单、明细行数/数量、业务字段、未审核状态和原始请求/响应证据仍必须核对；回读失败时停止，不重试写入。
- 证据：`.codex/work/u8-eai-clone-add-P260907001-20260907-response.xml`、`.codex/work/u8-eai-clone-created-final-P260905098-20260907-104356-response.xml`、`.codex/work/u8-eai-clone-P260905098-20260907-104356-result.json`；离线回归 `.codex/work/u8-eai-clone-regression.test.ps1`。

## U8 EAI 空引用必须分类为业务层不可用，不能当作空数据

- 2026-09-07 至 2026-09-08，完全相同的 765 字节 GB2312 `GetVoucherData` 请求（SHA-256 `7FE507E78FAD96B7E5EDB6BD8BE36B1EA1191177F7B7C4D0B6235250CB8ABBE0`）曾成功，也曾返回 `succeed=-2147467261 / 未将对象引用设置到对象的实例 / 错误位置:15`。连接复用、`strWhere/strLocateWhere` 变体和单一订单数据差异均不能解释该现象，故障边界在远程 U8 EAI/U8API 采购业务对象运行态。
- 规则：该错误必须进入 `Unknown/NeedsServiceRecovery`，绝不能转换成“订单不存在”。只读允许最多 3 次、500ms/1000ms 有界退避，并记录 GB2312 请求 SHA-256、尝试数、错误码和位置；普通业务错误不重试，写操作永不自动重试。
- 写入健康门槛：写操作前先让一个已知订单连续 3 次只读成功，再只读预检目标状态。任一空引用、超时或不明确响应都必须冻结写操作并进入服务恢复流程。
- 服务恢复顺序：优先检查/回收 U8EAI IIS 应用池和 U8API/采购 BO/COM 组件，结合 IIS、Windows 事件和 U8 EAI/U8API 日志定位；不要先改 XML、改订单数据或重启 SQL。客户端有限重试只是隔离瞬时故障，不等于修复服务端根因。

## U8 PurchaseOrder/Delete 必须显式分配 CurDom，失败后不得重试

- 2026-09-08 对 `P260905098` 的唯一一次删除请求被 U8 拒绝：`issuccess=False / The parameter:curdom hadn't be assigned value !`。随后 `GetVoucherData` 回读明确返回订单和两条明细，因此订单仍存在，不能写成删除成功。
- 官方删除示例说明 `CurDom` 是 `MSXML2.IXMLDOMDocument2` OUT 参数，但调用时仍必须先分配参数变量；EAI XML 适配层必须显式声明/分配对应 `CurDom` 参数，不能只发送 `DomHead/domBody`。
- 规则：删除请求计数必须持久化并固定为 1；业务失败、网络超时或回读为 `Exists/Unknown` 时都不得自动再次删除。修正契约后如需重试，必须重新只读预检并取得新的显式授权。
## U8 PurchaseOrder/Delete 最终成功且必须回读 NotFound

- 2026-09-08，`P260905098`（POID `1000011442`）在只读健康检查和目标预检通过后，使用补齐 `CurDom` OUT 参数的 `U8API/PurchaseOrder/Delete` 请求成功；本轮删除请求只发送 1 次。
- U8 返回 `issuccess=true`；随后 `GetVoucherData` 回读的 `DomHead`、`DomBody` 均为空 rowset，明确为 `NotFound`。只有这两个条件同时满足才能报告删除成功。
- 第一次缺少 `CurDom` 的请求已记录为失败且未重试；修正契约后的再次删除必须重新预检并取得新的显式授权。证据：`.codex/work/u8-eai-delete-P260905098-20260908-092119-*`，Obsidian：`证据/2026-09-08-P260905098/`。

## Validate final U8 MOrder XML at the byte boundary

- Evidence: On 2026-09-09, the only authorized U8API/MOrder/MOrderUpdate request for J260900063 was rejected with succeed=101 because the generated XML had an unterminated family attribute and mojibake Chinese text. Offline node checks passed, but the bytes sent were malformed.
- Rule: Generate MOrder XML with a DOM builder or ASCII-only control attributes. Persist exact GB2312 bytes, decode them as GB2312, parse again, and assert quote closure, roottag, proc, apiurl, node counts, and required fields before sending. Any failure blocks the write.
- Guardrail: Invalid XML still consumes the one-shot write attempt. Never retry automatically or infer that the U8 business contract is invalid; obtain new explicit authorization and repeat read-only preflight before a corrected write.


## Prevent Windows U8 helper encoding/startup regressions

- Evidence: A generated PowerShell append helper was interpreted with the wrong code page on 2026-09-09. Chinese text became mojibake and the parser reported a broken hash literal. Separately, the environment has intermittent CreateProcessWithLogonW 1385 startup failures.
- Rule: Persist helper scripts as UTF-8 with BOM or ASCII-only. Read the exact file as UTF-8, syntax-parse it, and byte-inspect the final XML before any EAI call. Keep process-launch recovery separate from payload generation.
- Guardrail: A 1385 startup failure or script parse/encoding failure must stop the workflow; never modify XML or retry a one-shot U8 business write to compensate. Use a short controlled elevated invocation only for the helper, then repeat read-only preflight and obtain explicit authorization for any corrected write.

## U8 MOrder 编辑接口的明确不支持结果（2026-09-09）

- 对生产单 J260900063 的唯一标准 EAI MOrder/Edit 请求，U8 返回 HTTP 200 但业务码 succeed=710：“本模块暂不提供此功能！”。
- succeed=710 是明确业务不支持，不是空引用、网络失败或订单不存在；HTTP 200 不能视为成功。
- 本次请求计数为 1，未自动重试；写后只读回查仍为 1 条原明细，目标物料 192759010101 未新增。
- 后续如需继续，必须取得新的明确写授权，重新完成连续 3 次只读健康检查和目标预检，并先确认 U8API/MOrder/MOrderUpdate 的 extbo 可写契约；不得因为标准 EAI 被拒绝而盲试或重复发送。
- 证据：.codex/work/u8-eai-morder-update-J260900063-continuation-20260909-130448025-request.xml、response.xml、result.json，以及 u8-production-order-J260900063-read.json。

## U8 生产订单响应解码边界（2026-09-09）

- U8 响应可能声明 UTF-8，即使请求字节是 GB2312；必须保存原始字节，按 XML 声明解码，再解析和分类。
- 响应 dsc 含未转义字符、OutOfMemoryException 或解析失败时，先归类为响应/服务异常，不得解释为业务对象不存在，也不得触发写请求重试。
## 区分生产订单创建人与接口会话账号（2026-09-09）

- J260900063 的创建/释放用户为 xuzhenjin，但标准 MOrder XML 没有操作员字段，sender=006 代表账套配置，不代表个人账号。
- 是否必须使用创建人账号取决于 U8API/COM 会话的认证和权限实现；不能从 RelsUser 单字段推断。
- 本次 MOrder/Edit 的 succeed=710 是模块不支持，不是账号或权限证据；切换账号前仍需确认可写的 U8API/MOrder/MOrderUpdate extbo 契约。
- 不读取、传播或写入密码；账号核对只记录用户名、账套和权限结论。

## 生产订单数量更新不能直接套采购订单 BO 容器（2026-09-09）

- J260900063 原明细 Qty/MrpQty 10 -> 9 的唯一 U8API/MOrder/MOrderUpdate 请求返回“未找到参数，参数名:DomHead”，写后回读仍为 10。
- 采购订单成功模板的 apiParams + bo/head/body 传输骨架可以参考，但生产订单 ExtensionBusinessEntity 需要其自身 DomHead/DomBody 绑定；不能凭字段文档猜测容器。
- HTTP 200、apiSuccess=False、请求计数 1 都不能视为成功；失败后不得自动重试。下一次必须确认真实契约、重新健康预检并取得新授权。
## MOrderUpdate 的 extbo 不能从采购订单参数布局推导（2026-09-09）

- 第二次 J260900063 数量更新仅发送 1 次，DomHead、domBody、CurDom 显式放入 apiParams，U8 仍返回三项参数均未找到。
- 写后 Qty/MrpQty 仍为 10，业务数据未变化；失败不重试。
- 采购订单接口的 DomHead/domBody/CurDom 结构不能推导生产订单 ExtensionBusinessEntity extbo 的 XML 序列化。没有真实 MOrderUpdate 示例或服务器元数据前，必须冻结继续写入。


## U8 MOrderUpdate outer success is not business success

- Evidence: On 2026-09-11, a Python U8 EAI probe for `J260900063` completed 3/3 read-only `MOrderLoad` calls with HTTP 200 and `issuccess=true`, then generated but did not send a `MOrderUpdate` dry-run for `Qty/MrpQty 10 -> 9`. The prior 2026-09-10 guarded `datatype="exbo"` update returned outer `issuccess=true`, but SQL post-check still showed `Qty=10` and `MrpQty=10`.
- Rule: For production-order `MOrderUpdate`, empty-return `u8apireturn issuccess="true"` only proves the outer EAI/API call completed. Treat it as `NoBusinessEffect` until SQL/EAI post-check proves the exact target fields changed.
- Guardrail: Python is preferred for deterministic XML bytes, hashes, response decoding, and capped read-only probes, but it must obey the same one-shot write counter, fresh 3/3 health gate, target preflight, and no-retry boundary. Do not send further production-order writes until the real `ExtensionBusinessEntity` transport/token/serialization contract is proven.
## U8 MOrderUpdate exbo may require EAI token/object binding

- Evidence: On 2026-09-11, read-only extraction of `D:\U8SOFT\EAI\U8ApiService.dll` UTF-16 strings found `//u8apiservice/apiParams/param[name='token']`, `exbo`, `GetBoParam`, `ConstructLogin`, `InternalConstructLogin`, `U8Login.clsLogin`, `userToken`, and `access_token`. The same investigation found no production-order `MOrderUpdate` HTTP API template in `D:\U8dev\XML\u8eai\src\main\resources\Template\API`, while the guarded inline `<param name="extbo" datatype="exbo"><Mom_Order>...</Mom_Order></param>` write returned outer success but left `Qty/MrpQty=10/10`.
- Rule: Do not treat inline `Mom_Order` XML under `datatype="exbo"` as a proven writable transport. The likely missing contract is an EAI/U8API token or framework-bound object handoff, not another guessed XML wrapper.
- Guardrail: Freeze additional production-order writes until one of these is available: the missing `U8API 和 U8EAI 整合` document, a vendor-supplied `MOrderUpdate` HTTP XML sample for `ExtensionBusinessEntity`, or a controlled local U8 API Framework call whose exact EAI-visible object/token binding is captured and followed by SQL/EAI post-check evidence.
## U8 MOrderUpdate empty Boolean retval is not business success

- Evidence: the 2026-09-10 18:46:59 U8 EAI server log for `U8API/MOrder/MOrderUpdate` logged sender `006` mapped to `xuzhenjin`, created `APIU8ApiService.U8ApiInvoker`, and returned outer `<u8apireturn issuccess="true">`, but `<param name="retval"></param>` was empty and SQL postcheck kept production order `J260900063` detail `MoDId=1000118479` at `Qty/MrpQty=10/10`.
- Rule: for U8API methods whose official return value is `System.Boolean`, an empty `retval` must be classified as `NoBusinessEffect/Unknown`, not success. Treat EAI outer `issuccess=true` as transport/API-wrapper success only; require a non-empty/expected return plus authoritative readback of the exact business fields before declaring the operation successful.
- Guardrail: server `EaiDistributeLog` may say `API调用此结果不适用`; therefore success/failure must be determined from request fingerprint, response params, and SQL/EAI postcheck together. Do not retry a write just because the outer wrapper succeeded.

## U8 MOrder/Add needs RsXml Allocate supplemental fields

- Evidence: On 2026-09-11, a guarded Python `MOrder/Add` clone attempt for source production order `J260900063` generated valid GB2312 XML with one `Order`, one `OrderDetail`, one `MOrderDetail`, and one `Allocate`, using local logical IDs and no source SQL IDs. U8 returned HTTP 200 with business `succeed=101`: `NO.1 :单号[J260900174]行号[1]物料编码[19260501030302]新增失败:表“Allocate”中列“AuxUnitCode”的值为 DBNull。`; SQL postcheck proved `J260900174` was not created and the source order remained unchanged.
- Evidence: `D:\U8SOFT\EAI\XML` and `D:\U8dev\XML` have identical SHA-256 hashes for `Operation\Dir.xml`, `Operation\Distribute.xml`, `Template\MOrder.xml`, `RsXml\MOrderXmlRs.xml`, and `StyleSheet\MOrder.xsl`; `D:\U8dev\生产制造\新增生产订单.txt` also lists the direct API child-allocation fields `DAuxUnitCode`, `DChangeRate`, `DAuxBaseQtyN`, `DAuxBaseQty`, `DAuxQty`, `DAuxIssQty`, and `DReplenishQty`.
- Rule: for standard EAI production-order add, do not rely only on the simplified `MOrder.xsd` / `Template\MOrder.xml` field list. The production `RsXml\MOrderXmlRs.xml` / `StyleSheet\MOrder.xsl` mapping expects the Allocate supplemental fields `AuxUnitCode`, `ChangeRate`, `AuxBaseQtyN`, `AuxQty`, and `ReplenishQty`. Populate `AuxUnitCode` from the component inventory unit when `mom_moallocate.AuxUnitCode` is NULL, and include consistent `ChangeRate`, `AuxBaseQtyN`, `AuxQty`, and `ReplenishQty` in dry-run assertions before any new write attempt.
- Guardrail: a `succeed=101` add failure still consumes the one-shot write attempt for that candidate order number. Do not automatically resend with patched XML; choose a fresh candidate code, rerun 3/3 read-only health checks, and obtain explicit authorization before the next write.

## U8 MOrder unaudit must prove business state before update

- Evidence: the 2026-09-11 11:24 `U8API/MOrder/MOrderUnauditing` log for production order `J260900063` shows `sender=006` logged into account set `006` as `xuzhenjin` and created `APIU8ApiService.U8ApiInvoker`; the response returned outer `issuccess=true` with empty `<param name="retval"></param>`, while the SQL postcheck kept the order at `Status=3`, `AuditStatus=1`, `RelsUser=xuzhenjin`, and detail `Qty/MrpQty=10/10`.
- Rule: do not continue from unaudit to update unless unaudit is proven by business-state readback. For U8API `System.Boolean` methods, empty `retval` is not `true`; classify it as `NoBusinessEffect/Unknown` until a non-empty return and authoritative readback agree.
- Guardrail: purchase-order audit/unverify patterns are reusable only at the success-gate level, not as production-order XML containers or return-value semantics. Purchase-order `ConfirmPO/CancelconfirmPo` returns an error-description `System.String retval` where empty means correct, and it succeeded because subsequent `GetVoucherData` status fields changed. Production-order `MOrderUnauditing` returns `System.Boolean retval`; empty is not `true`, and it did not change `J260900063`, so no `MOrderUpdate` should follow it.

## U8 production MOrderLoad null-reference blocks writes

- Evidence: on 2026-09-11 13:32, three read-only `U8API/MOrder/MOrderLoad` probes for `J260900063` tested return params `<param name="extbo"/>`, `<param name="extbo" datatype="exbo"/>`, and `<param name="extbo" datatype="ExtensionBusinessEntity"/>`. All returned HTTP 200 with `succeed=-2147467261` / U8 business-layer null reference and no non-empty `extbo`.
- Rule: production-order writes require a healthy read contract first. If `MOrderLoad` returns null-reference or empty/ambiguous business object, freeze unaudit/update/add-detail writes and diagnose U8 EAI/U8API runtime state; do not reinterpret it as NotFound or retry a write.
- Guardrail: U8 probe scripts must persist full request/response artifacts to files, but console output should be ASCII-safe summaries. U8 error payloads may contain mojibake/private-use characters that fail under a Windows GBK console even after the artifacts were correctly written.

## U8 MOrder extbo deserialization does not prove business effect

- Evidence: `C:\Users\zhenjin_xu\Desktop\U8EAIService.log.2026-09-10` shows repeated `U8ApiInvoker.Transact` calls for `J260900063` where EAI logged `mocode` as `System.String`, serialized `extbo`/`retval`, and successfully deserialized a full `<Mom_Order>` / `<Mom_OrderDetail>` / `<Mom_MoAllocate>` `ExtensionBusinessEntity`; immediately afterward the MOM broker raised missing-result errors for `errMsg`, `sretmsg`, `domhead`, and `dombody`. A later 18:47 call deserialized only empty `<Mom_Order></Mom_Order>` and then raised missing `errMsg/sretmsg`.
- Rule: do not keep treating production-order failure as a pure `datatype` or XML-shape problem once service logs prove `ExtensionBusinessEntity` deserialization. The next diagnostic gate is the MOM API result/error contract and business-state postcheck: required result names, `retval` semantics, `errMsg/sretmsg` availability, and final SQL/EAI readback.
- Guardrail: a service log line saying `通过XML反序列化构造ExtensionBusinessEntity结束` is only transport evidence, not business success. Continue freezing production-order writes until a route produces both a reliable success/error channel and changed authoritative business rows.

## U8 standard MOrder/Query requires paginate on the root interface

- Evidence: On 2026-09-11, three standard `MOrder/Query` health requests for `J260900063` without root `paginate` all returned `succeed=4100 / not found attribute【paginate】`. The official sample `D:\U8SOFT\EAI\XML\Samples\生产订单.xml` includes `paginate="0"`; adding that root attribute moved the request past the 4100 template error into the U8 business layer.
- Rule: Standard U8 EAI `MOrder/Query` requests must include root `paginate="0"` along with `roottag="MOrder"`, `proc="Query"`, `codeexchanged="N"`, `exportneedexch="N"`, and `version="2.0"`. Missing `paginate` is a request-shape error, not an empty order result.
- Guardrail: Passing the `paginate` gate does not prove U8 production-order service health. If the same read-only query then times out or returns `succeed=-2147467261 / 错误位置:15`, block `MOrder/Add` and do not consume the one-shot write counter.

## U8 PurchaseOrder VoucherSave DLL requires explicit CurDom binding (2026-09-11)

- Evidence: x86 U8 API Framework `U8API/PurchaseOrder/VoucherSave` failed before business write with `The parameter:curdom hadn't be assigned value !` when `CurDom` was omitted; the official C# sample explicitly creates `MSXML2.IXMLDOMDocument2` and calls `AssignNormalValue("CurDom", CurDom)`. After binding `MSXML2.DOMDocumentClass`, one save returned an empty error-description string and DLL readback proved both quantities changed from 3 to 4.
- Rule: every DLL `VoucherSave` call must bind a real `MSXML2.IXMLDOMDocument2` `CurDom` object, check `Invoke()`/exception/return string, and verify the persisted business values by a fresh `GetVoucherData` readback before any subsequent audit operation.

- 2026-09-14 U8 DLL 生产订单克隆验证：`ExtensionBusinessEntity.ItemCount` 不支持缩小；从完整 `MOrderLoad` 对象克隆单明细时使用 `Remove(index)`，再调用 `MOrderAdd` 并立即 `MOrderLoad` 回读。固定 x86 进程，写入前设置调用计数保护，避免重复新增。

- 2026-09-14 U8 DLL 追加明细：`ExtensionBusinessEntity.Clone` 复制目标订单后，用 `NewItem()` 新增明细，并通过 `ExtensionBOMeta.MainFields` 递归复制字段和子实体分配；递归到叶实体时必须允许 `SubBONames=null`。写入前检查目标不存在同物料明细，写后立即 `MOrderLoad` 回读，调用计数固定为 1。

## U8 OpTransformAdd and FC92 transfer-report success are different

- Evidence: On 2026-09-14, the earlier guarded x86 C# DLL call to `U8API/MoRoutingBill/MoRoutingBillAdd` for `J260900117-0001` / material `23992114020302` generated `fc_MoRoutingBill.cVouchType=FC90` (`0000001056` / `MID=1000001056`), not FC03094/FC92. The user could not find it in the U8 transfer-report client, which matches the database evidence.
- Evidence: A later guarded x86 C# DLL call to `U8API/OpTransform/OpTransformAdd` generated three actual工序转移单 rows for the same target: `DocCode=0000151965-0000151967`, `TransformId=1000151965-1000151967`, `QualifiedQty=672`, `TransOutQty=672`, `Status=1`, and routing `ReportQty=672`.
- Rule: Do not report FC03094/FC92 转移报工 success from `MoRoutingBillAdd` merely because rows appeared in `fc_MoRoutingBill`; verify `cVouchType=FC92`, `VT_ID=31066`, `fc_MoRoutingBilldetail.TransformId`, and matching `sfc_optransform.RefDocCode/RefDocDId`.
- Rule: `OpTransformAdd` success is proved by `sfc_optransform` and routing quantity readback, not by `fc_MoRoutingBill`. It saves工序转移单 records and does not by itself create the FC92 report-bill header.
- Guardrail: If the user specifically needs a client-visible FC03094/FC92 report bill, continue via official `BFMoRoutingBillSave/MoRoutingBillSave` DLL research; never patch `fc_MoRoutingBill` or `sfc_optransform.RefDocCode` with direct SQL.

## U8 FC92 DLL/BF automation must guard COM+ fallback and orphan transfer cleanup

- Evidence: On 2026-09-16, `BFMoRoutingBill.MoRoutingBillSave` for `J260900117-0001` / `23992114020302` failed through the public COM+ wrapper with `System.EnterpriseServices.RegistrationException` under the non-admin local agent, but reflected internal `BFMoRoutingBillSave.SaveMoRoutingBill(DataSet, PackDocParameter("FC92"))` saved the correct FC92 bill `MID=1000001068`, `cVouchCode=0000001067`, `VT_ID=31066`.
- Evidence: Public `BFMoRoutingBill.Verify` hit the same COM+ registration boundary; constructing `OpTransformDs` from saved `FC_MoDetail`, saving with internal `BFTransformSave.Save(..., PackDocParameter("FC31"))`, and then calling `BOMoRoutingBill.UpdateStatusByMDId` produced linked transfer rows `1000155331-1000155333` with `RefDocCode=0000001067`, matching `RefDocDId=MDId`, and quantity 672.
- Evidence: A failed retry after `BFTransformSave.Save` but before bill status/link update left orphan `sfc_optransform.TransformId=1000155330`; deleting it via `OpTransform.Delete()` plus `BFTransformSave.Save` restored routing quantities and final preflight returned `AlreadyComplete` with bad-row counts zero.
- Rule: For FC92 DLL automation in this environment, guard every write with call-count files and readback checkpoints; if public BF calls hit COM+ admin registration, fall back to U8 internal BF/BO methods instead of requesting SQL updates or retrying blindly.
- Guardrail: After any failed or resumed verify, scan for transforms whose `RefDocCode/RefDocDId` match the FC92 bill detail but whose `TransformId` is not the detail's linked `TransformId`; remove only those scoped orphan rows through U8 DLL/BO delete, never by direct SQL.

## U8 FC92 client-load safety requires NULL shift fields

- Evidence: On 2026-09-16, U8 client `FC03094` / 转移报工查询 `0000001067` failed with `参数名:index` because `fc_MoRoutingBilldetail.MoRoutingShiftId=0` while the loaded routing shift collection had zero rows.
- Rule: For FC92 rows without routing shifts, keep `MoRoutingShiftId`, `WorkShiftId`, `EmployCode`, `EQId`, and `dutyclasscode` as `NULL`; do not convert missing `DutyClassCode` to `""`, because `BFMoRoutingBillSave.SaveMoRoutingBill` treats that as shift data and may backfill `MoRoutingShiftId=0`.
- Guardrail: After FC92 DLL writes, verify client-load safety separately from business completion: read back those five nullable fields and run the DLL load diagnostic to prove `IsPropertyNull("MoRoutingShiftId")=true` and no UI getter would throw. Evidence: `.codex/work/u8-fc92-transfer-report-J260900117-0001-23992114020302-preflight.result.json` and `.codex/work/u8-fc92-client-load-diagnostic-0000001067.json`.
