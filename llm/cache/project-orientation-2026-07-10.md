# Carbon project orientation notes (2026-07-10)

These notes summarize committed-code facts verified from package/config files and
existing cache/workflow documents. Do not treat this as a plan for uncommitted
work.

## Monorepo shape

- Package manager: `pnpm@10.33.4`.
- Workspaces: `apps/*`, `ci`, `examples/*`, `packages/*`.
- Main apps: `apps/erp`, `apps/mes`, `apps/academy`, `apps/starter`.
- Shared packages include `@carbon/auth`, `@carbon/database`,
  `@carbon/documents`, `@carbon/form`, `@carbon/jobs`, `@carbon/kv`,
  `@carbon/locale`, `@carbon/printing`, `@carbon/react`, `@carbon/utils`,
  plus `config`, `dev`, `ee`, `env`, `lib`, `notifications`, `stripe`,
  and `tiptap`.

## Root scripts

- `pnpm dev` runs `crbn up --no-portless`.
- `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm typecheck` delegate through
  Turbo.
- `pnpm db:migrate:new` creates a new Supabase migration through
  `@carbon/database`.
- `pnpm db:migrate` applies migrations through `crbn migrate`.
- `pnpm db:types` and `pnpm generate:types` run
  `scripts/generate-db-types.ts`.
- `pnpm lingui:check` runs extract and compile.

## App architecture

- ERP, MES, Academy, and Starter are React Router SSR apps with Vite,
  Tailwind, and `remix-flat-routes`.
- Each app has `app/routes.ts` using `flatRoutes("routes")` via
  `remixRoutesOptionAdapter`.
- Flat-route ignored files: dot files, CSS, tests, `__*`, `*.server.*`, and
  `*.client.*`.
- Protected areas use `x+/` in ERP/MES/Starter. Public/auth routes use
  `_public+` in ERP/MES/Starter and `_auth+` in Academy.
- Dev ports from Vite config: ERP `3000`, MES `3001`, Academy `4111`,
  Starter `4000`.
- ERP and MES use a custom `macrosSkipLarge()` Vite plugin to avoid running
  Babel macros on large generated files.

## ERP modules

Top-level ERP module directories verified in `apps/erp/app/modules/`:

`account`, `accounting`, `api`, `documents`, `inventory`, `invoicing`, `items`,
`people`, `plm`, `production`, `purchasing`, `quality`, `resources`, `sales`,
`settings`, `shared`, `storageRules`, `users`.

## Database and workflow notes

- Migrations live in `packages/database/supabase/migrations/`.
- `packages/database/package.json` uses `db:migrate:new = supabase migration new`.
- The workflow document still mentions `npm run db:migrate <name>` for creating
  migrations and `npm run db:build`; those names do not match current root
  scripts, so verify package scripts before acting.
- Generated DB types are in `packages/database/src/types.ts` and copied into
  `packages/database/supabase/functions/lib/types.ts`; do not edit generated
  types by hand.
- `packages/database/supabase/config.toml` notes that for local dev only
  `project_id` and `[functions.*]` sections are authoritative; runtime services
  are managed by `docker-compose.dev.yml` via `scripts/dev/cli.ts`.

## Shared package entry points

- `@carbon/react` exports the shared UI primitives and hooks from
  `packages/react/src/index.tsx`.
- `@carbon/documents` does not export `.`; use subpath exports such as
  `./email`, `./pdf`, `./template`, `./zpl`, `./qr`, and `./labels`.
- `@carbon/printing` exports `.`, `./printing.server`, and `./ui`.
- `@carbon/jobs` exports `.`, `./events`, `./inngest`, and `./worker`; its
  scripts are `dev:jobs` and `typecheck`, not a normal `test` script.
- Many library packages have `vitest run` tests, but not all packages or apps
  define a `test` script. Check the relevant package before assuming.

## Maintenance risks to remember

- Always consult `llm/cache/` before source when learning project context.
- For migrations, follow `llm/workflows/database-migration.md`, but reconcile
  outdated command names with current `package.json` scripts.
- Do not rebuild the database yourself to test changes.
- For RLS, use standardized `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies and
  current helper functions such as `get_companies_with_employee_permission(...)`;
  avoid the old `has_role` / `has_company_permission` pattern.
- For event-system trigger changes, merge existing interceptor arrays when
  calling `attach_event_trigger(...)`.
- For UI, prefer `@carbon/react` and existing ERP components before adding new
  custom UI.
