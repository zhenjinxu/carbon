/**
 * psql-based migration runner (fallback when supabase.exe is unavailable).
 * Reads migration files, compares with supabase_migrations.schema_migrations,
 * applies missing ones via psql, and records them.
 *
 * Usage: node scripts/migrate-psql.js [db-url]
 *   default db-url: postgresql://postgres:postgres@localhost:56251/postgres
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PSQL = process.env.PSQL_PATH || "D:\\Program Files\\PostgreSQL\\18\\bin\\psql";
const MIGRATIONS_DIR = path.join(__dirname, "..", "..", "packages", "database", "supabase", "migrations");
const DB_URL = process.argv[2] || "postgresql://postgres:postgres@localhost:56251/postgres";

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

// Get applied versions
const appliedRaw = run(
  `"${PSQL}" "${DB_URL}" -t -A -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"`
);
const applied = new Set(appliedRaw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));

// Get all migration file versions
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
const allVersions = files.map((f) => f.split("_")[0]);

// Find missing
const missing = allVersions.filter((v) => !applied.has(v));

if (missing.length === 0) {
  console.log("  All migrations are up to date.");
  process.exit(0);
}

console.log(`  Applying ${missing.length} missing migration(s)...`);

let success = 0;
let failed = 0;

for (const version of missing) {
  const file = files.find((f) => f.startsWith(version + "_"));
  if (!file) continue;

  const filePath = path.join(MIGRATIONS_DIR, file);
  try {
    run(`"${PSQL}" "${DB_URL}" -v ON_ERROR_STOP=1 -f "${filePath}"`);
    run(
      `"${PSQL}" "${DB_URL}" -c "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('${version}') ON CONFLICT DO NOTHING"`
    );
    success++;
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${file}`);
    console.error(`    ${e.stderr || e.message}`.slice(0, 300));
  }
}

console.log(`  Migrations: ${success} applied, ${failed} failed.`);
if (failed > 0) process.exit(1);
