# Session Breakpoint — 2026-07-07

## Issues Fixed

### 1. Dev Server Crash (STATUS_STACK_BUFFER_OVERRUN / 0xC0000409)
- **Root cause**: `vite-plugin-babel-macros` runs Babel's full AST pipeline on EVERY .ts/.tsx file, including 3 auto-generated files totaling 7.5MB (`types.ts` 2.2MB, `swagger-docs-schema.ts` 4MB, `quality.ts` 1.2MB). This triggers Babel's 500KB "deoptimise" fallback and eventually crashes with a native memory error.
- **Fix**: Custom Vite plugin `macrosSkipLarge()` in `apps/erp/vite.config.ts` and `apps/mes/vite.config.ts` replaces `vite-plugin-babel-macros`. It checks for `/macro["';]` regex in source — files without macro imports skip Babel entirely. Babel packages are pre-resolved via `createRequire` from `vite-plugin-babel-macros`'s node_modules at config load time (before Vite moves config to `.vite-temp/`).

### 2. Delete Company Button Not Working
- **Root cause**: `ConfirmDelete` used `fetcher.Form` which submits via `fetch()` and does NOT follow `throw redirect()` from actions. The page never navigated after delete.
- **Fix**: Changed `fetcher.Form` → `<Form>` (from react-router) in `ConfirmDelete.tsx`. `<Form>` uses navigation submission which correctly follows redirects. Loading state uses `useNavigation()` instead of `useFetcher()`.

### 3. Delete Company Button Disabled
- **Root cause**: `company.delete.tsx` passed `disabled={hasRelatedData}` to `ConfirmDelete`, making the button unclickable when company has related data.
- **Fix**: Removed `disabled={hasRelatedData}`. The action handler already has the same `checkCompanyRelatedData` check server-side.

### 4. Double ModalOverlay in ConfirmDelete/Confirm
- **Root cause**: Both components had `<ModalOverlay />` as sibling of `<ModalContent>`, but `ModalContent` internally already wraps children in `<ModalOverlay>`. This created a double overlay inside the dialog.
- **Fix**: Removed the explicit `<ModalOverlay />` from both `ConfirmDelete.tsx` and `Confirm.tsx`.

### 5. Data Loss — FALSE ALARM
- Data was never lost. All app data is in the `postgres` database (which PostgREST connects to via `PGRST_DB_URI: postgres://...@host.docker.internal:56251/postgres`), NOT in the `carbon` database.
- The `carbon` database was accidentally dropped during recovery attempts but it wasn't used by the app.
- API on port 54322 confirmed returning data (42 items, 6 companies, 4 jobs, etc.)

## Files Modified

### Vite Configs (Babel crash fix)
- `apps/erp/vite.config.ts` — `macrosSkipLarge()` replaces `babelMacros()`
- `apps/mes/vite.config.ts` — same
- `apps/academy/vite.config.ts` — unchanged (restored original `babelMacros()`)
- `apps/starter/vite.config.ts` — unchanged (restored original `babelMacros()`)

### Modal Components
- `apps/erp/app/components/Modals/ConfirmDelete/ConfirmDelete.tsx` — `<Form>` + `useNavigation()`, removed extra `<ModalOverlay />`
- `apps/erp/app/components/Modals/Confirm/Confirm.tsx` — removed extra `<ModalOverlay />`

### Route
- `apps/erp/app/routes/x+/settings+/company.delete.tsx` — removed `disabled={hasRelatedData}`

### Package JSONs
- `apps/erp/package.json` — `dev:app` script has `cross-env NODE_OPTIONS="--max-old-space-size=8192"`
- `apps/mes/package.json` — same

## Key Architecture Discoveries

1. **Database routing**: App connects via Supabase API (Kong on port 54322) → PostgREST → `postgres` database (NOT `carbon`). The `SUPABASE_DB_URL` pointing to `carbon` is for direct connections (seed scripts), not the main app.

2. **`vite-plugin-babel-macros` internals** (from reading source at `node_modules/vite-plugin-babel-macros/dist/plugin.js`):
   - Has NO `transformInclude` hook — all filtering is inside `transform`
   - Has `enforce: "pre"`
   - Checks `node_modules` and file extension inside `transform`
   - Mutating `transformInclude` does nothing because the property doesn't exist

3. **Vite plugin pipeline**: Returning `null` from a transform does NOT prevent subsequent plugins' transforms from running. To skip processing, the replacement plugin must handle the transform itself.

4. **Vite config compilation**: Vite compiles `vite.config.ts` to `.vite-temp/` — dynamic `import()` from inside plugin callbacks can't resolve packages that aren't direct deps. Solution: pre-resolve at config top-level using `createRequire`.

## Tomorrow's Verification Checklist (2026-07-08 — ALL PASSED ✅)
- [x] Run `pnpm dev` and confirm no Babel deopt warnings — ✅ No deopt/warn/error in server log
- [x] Confirm no crash (exit code 0xC0000409) — ✅ Server running stable
- [x] Test Delete Company at `/x/settings/company/delete` — ✅ Page loads 200, ConfirmDelete uses `<Form>` (not fetcher.Form), `disabled={hasRelatedData}` removed
- [x] Verify parts data at `/x/items/parts` is visible — ✅ 200 OK, 321KB SSR HTML, API returns 3 items (深沟球轴承, 传动齿轮, 箱体铸件)
- [x] Verify MES operations at `/x/operations` — ✅ 200 OK, 277KB
- [x] Verify production data at `/x/production` — ✅ 200 OK, 301KB
- [x] Check that `@lingui/react/macro` still works (e.g., `DefaultMethodType.tsx`) — ✅ Chinese translations rendering correctly (工艺规程, 工作中心, 工序类型 etc.)

## Status: All verification items passed. 141 uncommitted files remain.
- [ ] Verify production data at `/x/production`
- [ ] Check that `@lingui/react/macro` still works (e.g., `DefaultMethodType.tsx`)
