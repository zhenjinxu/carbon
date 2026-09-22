import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
function findRoot(start: string) {
  let current = start;
  for (;;) {
    try { if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") return current; } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}
const requestedReadableIds = [
  "1919671001", "1919671002", "1927326104", "1927881101", "1927881103", "1927930801",
  "1927930802", "1927930803", "1927930804", "191967100102", "192713640301", "192744140302",
  "192769010102", "192769010103", "192788110401", "192788110402", "192788110601", "192788110602",
  "192793010401", "192793010402", "192793080101", "192793080201", "19266541010201", "19276939010203"
];
const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");
const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-source-route-availability-20260820.json");
try {
  const client = await pool.connect();
  try {
    const tables = (await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND (lower(table_name) LIKE '%u8%' OR lower(table_name) LIKE '%wodi%' OR lower(table_name) LIKE '%route%' OR lower(table_name) LIKE '%operation%')
      ORDER BY table_schema, table_name
    `)).rows;
    const columns = (await client.query(`
      SELECT table_schema, table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema')
        AND (lower(table_name) LIKE '%u8%' OR lower(table_name) LIKE '%wodi%' OR lower(table_name) LIKE '%route%' OR lower(table_name) LIKE '%operation%')
      ORDER BY table_schema, table_name, ordinal_position
    `)).rows;
    const itemRouteState = (await client.query(`
      WITH requested AS (
        SELECT unnest($2::text[]) AS "requestedReadableId", generate_subscripts($2::text[], 1) AS "inputOrder"
      ), matched_item AS (
        SELECT DISTINCT ON (requested."requestedReadableId")
          requested."requestedReadableId", requested."inputOrder", item."id" AS "itemId", item."readableId", item."name"
        FROM requested
        LEFT JOIN "item" item ON item."companyId" = $1 AND (item."readableId" = requested."requestedReadableId" OR item."readableIdWithRevision" = requested."requestedReadableId")
        ORDER BY requested."requestedReadableId", item."updatedAt" DESC NULLS LAST, item."createdAt" DESC NULLS LAST
      ), method_state AS (
        SELECT mm."itemId", mm."id" AS "makeMethodId", mm."status"::text AS status, COUNT(mo."id")::int AS ops
        FROM "makeMethod" mm
        LEFT JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
        WHERE mm."companyId" = $1
        GROUP BY mm."itemId", mm."id", mm."status"
      ), job_routes AS (
        SELECT
          jmm."itemId",
          COUNT(DISTINCT jmm."id")::int AS "jobMakeMethodCount",
          COUNT(jo."id")::int AS "jobOperationCount",
          STRING_AGG(DISTINCT j."jobId", ', ' ORDER BY j."jobId") AS "jobIds"
        FROM "jobMakeMethod" jmm
        JOIN "job" j ON j."companyId" = jmm."companyId" AND j."id" = jmm."jobId"
        LEFT JOIN "jobOperation" jo ON jo."companyId" = jmm."companyId" AND jo."jobMakeMethodId" = jmm."id"
        WHERE jmm."companyId" = $1
        GROUP BY jmm."itemId"
      )
      SELECT
        mi."requestedReadableId",
        mi."itemId",
        mi."readableId",
        mi."name",
        COALESCE(jsonb_agg(jsonb_build_object('makeMethodId', ms."makeMethodId", 'status', ms.status, 'ops', ms.ops)) FILTER (WHERE ms."makeMethodId" IS NOT NULL), '[]'::jsonb) AS "methods",
        COALESCE(MAX(jr."jobMakeMethodCount"), 0)::int AS "jobMakeMethodCount",
        COALESCE(MAX(jr."jobOperationCount"), 0)::int AS "jobOperationCount",
        MAX(jr."jobIds") AS "jobIds"
      FROM matched_item mi
      LEFT JOIN method_state ms ON ms."itemId" = mi."itemId"
      LEFT JOIN job_routes jr ON jr."itemId" = mi."itemId"
      GROUP BY mi."requestedReadableId", mi."inputOrder", mi."itemId", mi."readableId", mi."name"
      ORDER BY mi."inputOrder"
    `, [companyId, requestedReadableIds])).rows;
    const output = { companyId, checkedAt: new Date().toISOString(), matchingTables: tables, matchingColumns: columns, itemRouteState };
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      matchingTables: tables.map((t:any)=>`${t.table_schema}.${t.table_name}`),
      itemRouteState
    }, null, 2));
  } finally { client.release(); }
} finally { await pool.end(); }