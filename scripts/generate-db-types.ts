import { closeSync, copyFileSync, openSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error(
    "SUPABASE_DB_URL not set (expected in .env or .env.local). Run `pnpm dev:up` first."
  );
  process.exit(1);
}

if (!/(localhost|127\.0\.0\.1)/.test(dbUrl)) {
  console.error(
    `Refusing to generate types against non-local DB: ${dbUrl.replace(/:[^:@/]+@/, ":***@")}`
  );
  process.exit(1);
}

const typesPath = join("packages", "database", "src", "types.ts");
const fnTypesPath = join(
  "packages",
  "database",
  "supabase",
  "functions",
  "lib",
  "types.ts"
);
const tempTypesPath = `${typesPath}.tmp`;
const supabaseBinary = join(
  "node_modules",
  "supabase",
  "bin",
  process.platform === "win32" ? "supabase.exe" : "supabase"
);

// Keep the existing generated types intact unless Supabase completes.
const out = openSync(tempTypesPath, "w");
const r = spawnSync(
  supabaseBinary,
  [
    "gen",
    "types",
    "typescript",
    "--db-url",
    dbUrl,
    "--schema",
    "public",
    "--schema",
    "storage",
    "--schema",
    "graphql_public"
  ],
  { stdio: ["ignore", out, "inherit"] }
);
closeSync(out);

if (r.status !== 0) {
  rmSync(tempTypesPath, { force: true });
  console.error(
    `supabase gen types failed: ${r.error?.message ?? `exit ${r.status}`}`
  );
  process.exit(r.status ?? 1);
}

renameSync(tempTypesPath, typesPath);
copyFileSync(typesPath, fnTypesPath);
console.log(`wrote ${typesPath}\nwrote ${fnTypesPath}`);
