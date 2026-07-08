# Session Breakpoint — 2026-07-08 (continued)

## Issues Fixed Today

### 1. Company Delete Not Working
- **Root cause**: `company.tsx` was a flat-route parent without `<Outlet />`, so child routes (including `company.delete.tsx`) silently never rendered. The delete modal was invisible.
- **Secondary issues fixed**:
  - `checkCompanyRelatedData` was too strict — included `location`/`warehouse` (have CASCADE) and `employeeJob` (no CASCADE but seed data). Removed location/warehouse from check, delete employeeJob before company delete.
  - `customFieldTable.companyId does not exist` — `customFieldTable` is a global registry (no companyId column). Fixed `getCustomFields` to query `customField` instead, and `getCustomFieldsTables`/`shared.server.ts` to not filter by companyId.
- **Files**: `company.tsx`, `company.delete.tsx`, `settings.service.ts`, `shared.server.ts`

### 2. Inngest "Unable to reach SDK URL"
- **Root cause**: Docker container's `localhost` resolved to 127.0.0.1 (container itself) due to `/etc/hosts` precedence over `extra_hosts` mapping.
- **Fix**: Changed `--sdk-url` from `${ERP_URL}/api/inngest` to `http://host.docker.internal:${PORT_ERP}/api/inngest` in docker-compose.local.yml.

### 3. pgmq Schema Not Found
- **Root cause**: `SUPABASE_DB_URL` pointed to `carbon` database which didn't have pgmq extension. Installed pgmq + event_system queue in carbon.
- **Resolution**: Changed `SUPABASE_DB_URL` to point to `postgres` database (the canonical app database).

### 4. "period" Relation Does Not Exist
- **Root cause**: Same as #3 — `carbon` database was missing most schema.
- **Resolution**: Same fix — `SUPABASE_DB_URL` now points to `postgres`.

### 5. Database Cleanup
- `carbon` database had 0 tables, 0 views, 0 functions — only pgmq extension we just installed.
- No data migration needed — dropped `carbon` database entirely.
- All connections now unified on `postgres` database.

## Architecture After Cleanup

```
Docker (Supabase services)     Local PostgreSQL :56251
┌──────────────────────┐      ┌──────────────────────┐
│ Kong :54322          │──────│ postgres database     │
│ PostgREST            │      │  ✅ 406+ tables       │
│ GoTrue (auth)        │      │  ✅ pgmq extension    │
│ Storage              │      │  ✅ period, custom...  │
│ Edge Runtime         │      │  ✅ Full schema       │
│ Inngest :49285       │      └──────────────────────┘
│ Inbucket :49284      │      
└──────────────────────┘      ~~carbon database~~ (DELETED)

ERP/MES dev servers → Kong → PostgREST → postgres (same DB)
Edge functions/Kysely → SUPABASE_DB_URL → postgres (same DB)
```

## Key Configuration Changes
- `.env.local`: `SUPABASE_DB_URL` changed from `.../carbon` to `.../postgres`
- `docker-compose.local.yml`: Inngest `--sdk-url` uses `host.docker.internal`

## Today's Commits
1. `0eae0e012` — 213 files: Vite crash fix, modal UX, server-side file uploads, i18n
2. `489136638` — Inngest SDK URL Docker networking fix
3. `e08dc26f0` — Company delete + customFieldTable fixes
4. `fb3b8a378` — company.tsx missing `<Outlet />` fix

## After Restart Checklist
- [ ] Restart dev server (Ctrl+C → scripts\start-local.bat)
- [ ] Test /x/production/procedures → "规划"/"预测" (period table)
- [ ] Test /x/settings/custom-fields (customFieldTable fix)
- [ ] Test company delete modal appears
- [ ] Test all core pages load without errors
