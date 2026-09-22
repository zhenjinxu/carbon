import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnv(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
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
const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnv(resolve(root, ".env"));
loadEnv(resolve(root, ".env.local"), { override: true });
loadEnv(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");
const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-resource-capability-audit-20260820.json");
const routeProcessIds = [
  "u8proc_f6e011e7882189b9fc05a4b2",
  "u8proc_4b1d56bd2a2820b629040581",
  "u8proc_b47b49251b71b7cdf6f2601c"
];
try {
  const client = await pool.connect();
  try {
    const summary = (await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "process" WHERE "companyId" = $1)::int AS "processCount",
        (SELECT COUNT(*) FROM "process" WHERE "companyId" = $1 AND COALESCE("active", true) = true)::int AS "activeProcessCount",
        (SELECT COUNT(*) FROM "workCenter" WHERE "companyId" = $1)::int AS "workCenterCount",
        (SELECT COUNT(*) FROM "workCenter" WHERE "companyId" = $1 AND "active" = true)::int AS "activeWorkCenterCount",
        (SELECT COUNT(*) FROM "workCenterProcess" WHERE "companyId" = $1)::int AS "workCenterProcessCount",
        (SELECT COUNT(*) FROM "workCenterProcess" wcp INNER JOIN "workCenter" wc ON wc."id" = wcp."workCenterId" AND wc."companyId" = wcp."companyId" WHERE wcp."companyId" = $1 AND wc."active" = true)::int AS "activeWorkCenterProcessCount",
        (SELECT COUNT(*) FROM "methodOperation" WHERE "companyId" = $1)::int AS "methodOperationCount",
        (SELECT COUNT(*) FROM "methodOperation" WHERE "companyId" = $1 AND "workCenterId" IS NOT NULL)::int AS "methodOperationWithWorkCenterCount"
    `, [companyId])).rows[0];

    const processCapabilities = (await client.query(`
      SELECT
        p."id" AS "processId",
        p."name" AS "processName",
        COALESCE(p."active", true) AS "processActive",
        COUNT(wcp."workCenterId")::int AS "mappedWorkCenterCount",
        COUNT(wcp."workCenterId") FILTER (WHERE wc."active" = true)::int AS "activeMappedWorkCenterCount",
        COALESCE(jsonb_agg(jsonb_build_object('id', wc."id", 'name', wc."name", 'active', wc."active") ORDER BY wc."name") FILTER (WHERE wc."id" IS NOT NULL), '[]'::jsonb) AS "workCenters"
      FROM "process" p
      LEFT JOIN "workCenterProcess" wcp ON wcp."companyId" = p."companyId" AND wcp."processId" = p."id"
      LEFT JOIN "workCenter" wc ON wc."companyId" = wcp."companyId" AND wc."id" = wcp."workCenterId"
      WHERE p."companyId" = $1 AND p."id" = ANY($2::text[])
      GROUP BY p."id", p."name", p."active"
      ORDER BY p."name"
    `, [companyId, routeProcessIds])).rows;

    const activeMethodCoverage = (await client.query(`
      SELECT
        COUNT(mo."id")::int AS "activeOperationCount",
        COUNT(mo."id") FILTER (WHERE mo."workCenterId" IS NOT NULL)::int AS "activeOperationWithWorkCenterCount",
        COUNT(DISTINCT mo."processId")::int AS "activeProcessCount",
        COUNT(DISTINCT mo."processId") FILTER (WHERE mo."workCenterId" IS NOT NULL)::int AS "activeProcessWithWorkCenterCount"
      FROM "makeMethod" mm
      INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
      WHERE mm."companyId" = $1 AND mm."status" = 'Active'::"makeMethodStatus"
    `, [companyId])).rows[0];

    const aiActiveRouteCoverage = (await client.query(`
      SELECT
        i."readableId",
        d."acceptedMakeMethodId",
        COUNT(mo."id")::int AS "operationCount",
        COUNT(mo."id") FILTER (WHERE mo."workCenterId" IS NOT NULL)::int AS "operationWithWorkCenterCount",
        jsonb_agg(jsonb_build_object('order', mo."order", 'processId', mo."processId", 'processName', p."name", 'workCenterId', mo."workCenterId", 'workCenterName', wc."name") ORDER BY mo."order") AS operations
      FROM "aiRoutingDraft" d
      INNER JOIN "item" i ON i."companyId" = d."companyId" AND i."id" = d."itemId"
      INNER JOIN "makeMethod" mm ON mm."companyId" = d."companyId" AND mm."itemId" = d."itemId" AND mm."id" = d."acceptedMakeMethodId" AND mm."status" = 'Active'::"makeMethodStatus"
      INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
      LEFT JOIN "process" p ON p."companyId" = mo."companyId" AND p."id" = mo."processId"
      LEFT JOIN "workCenter" wc ON wc."companyId" = mo."companyId" AND wc."id" = mo."workCenterId"
      WHERE d."companyId" = $1 AND d."acceptedMakeMethodId" IS NOT NULL
      GROUP BY i."readableId", d."acceptedMakeMethodId"
      ORDER BY i."readableId"
    `, [companyId])).rows;

    const processUsage = (await client.query(`
      SELECT
        p."id" AS "processId",
        p."name" AS "processName",
        COUNT(mo."id")::int AS "operationCount",
        COUNT(mo."id") FILTER (WHERE mo."workCenterId" IS NOT NULL)::int AS "operationWithWorkCenterCount",
        COUNT(DISTINCT mo."workCenterId") FILTER (WHERE mo."workCenterId" IS NOT NULL)::int AS "distinctAssignedWorkCenterCount",
        COUNT(DISTINCT wcp."workCenterId") FILTER (WHERE wc."active" = true)::int AS "activeMappedWorkCenterCount"
      FROM "process" p
      LEFT JOIN "methodOperation" mo ON mo."companyId" = p."companyId" AND mo."processId" = p."id"
      LEFT JOIN "workCenterProcess" wcp ON wcp."companyId" = p."companyId" AND wcp."processId" = p."id"
      LEFT JOIN "workCenter" wc ON wc."companyId" = wcp."companyId" AND wc."id" = wcp."workCenterId"
      WHERE p."companyId" = $1
      GROUP BY p."id", p."name"
      HAVING COUNT(mo."id") > 0 OR COUNT(wcp."workCenterId") > 0
      ORDER BY COUNT(mo."id") DESC, p."name"
      LIMIT 50
    `, [companyId])).rows;

    const output = {
      companyId,
      auditedAt: new Date().toISOString(),
      summary,
      processCapabilities,
      activeMethodCoverage,
      aiActiveRouteCoverage,
      processUsage,
      conclusion: {
        existingCapabilitySource: 'workCenterProcess maps process to workCenter and can be the first gate for workCenter recommendation.',
        currentAiRoutesHaveWorkCenters: aiActiveRouteCoverage.every((row) => Number(row.operationWithWorkCenterCount) > 0),
        routeProcessIdsHaveActiveMappedWorkCenters: processCapabilities.every((row) => Number(row.activeMappedWorkCenterCount) > 0),
        recommendation: 'Do not enable AI workCenter assignment until workCenterProcess coverage is validated for the route process set and material/range constraints are defined or explicitly waived.'
      }
    };
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(output, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}