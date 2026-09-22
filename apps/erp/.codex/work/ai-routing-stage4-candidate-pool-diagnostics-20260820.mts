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
const currentSecondBatch = [
  "1927930501", "1927930502", "1927930503", "1927930601", "1927930602", "1927930603",
  "192793050101", "192793050200", "192793050201", "192793060101", "192793060200", "192793060201"
];
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-candidate-pool-diagnostics-20260820.json");
try {
  const client = await pool.connect();
  try {
    const counts = (await client.query(`
      WITH items AS (
        SELECT "id", "readableId", "readableIdWithRevision", "name"
        FROM "item"
        WHERE "companyId" = $1
      ), valid_pdf AS (
        SELECT DISTINCT "sourceDocumentId" AS "itemId"
        FROM "document"
        WHERE "companyId" = $1
          AND "active" = true
          AND "sourceDocument" = 'Part'
          AND "type" = 'PDF'
          AND lower(COALESCE("extension", '')) = 'pdf'
      ), loose_pdf AS (
        SELECT DISTINCT "sourceDocumentId" AS "itemId"
        FROM "document"
        WHERE "companyId" = $1
          AND "active" = true
          AND "sourceDocument" = 'Part'
          AND ("type" = 'PDF' OR lower(COALESCE("extension", '')) = 'pdf' OR lower(COALESCE("path", '')) LIKE '%.pdf')
      ), active_route AS (
        SELECT DISTINCT mm."itemId"
        FROM "makeMethod" mm
        INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
        WHERE mm."companyId" = $1
          AND mm."status" = 'Active'::"makeMethodStatus"
      ), sample_roles AS (
        SELECT "itemId", ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS roles
        FROM "aiRoutingSample"
        WHERE "companyId" = $1
        GROUP BY "itemId"
      ), second_batch AS (
        SELECT "id" AS "itemId"
        FROM "item"
        WHERE "companyId" = $1
          AND (COALESCE("readableId", '') = ANY($2::text[]) OR COALESCE("readableIdWithRevision", '') = ANY($2::text[]))
      )
      SELECT
        (SELECT COUNT(*) FROM items)::int AS "itemCount",
        (SELECT COUNT(*) FROM valid_pdf)::int AS "validPdfItemCount",
        (SELECT COUNT(*) FROM loose_pdf)::int AS "loosePdfItemCount",
        (SELECT COUNT(*) FROM active_route)::int AS "activeRouteItemCount",
        (SELECT COUNT(*) FROM valid_pdf INNER JOIN active_route USING ("itemId"))::int AS "validPdfAndActiveRouteCount",
        (SELECT COUNT(*) FROM loose_pdf INNER JOIN active_route USING ("itemId"))::int AS "loosePdfAndActiveRouteCount",
        (SELECT COUNT(*) FROM valid_pdf INNER JOIN active_route USING ("itemId") INNER JOIN second_batch USING ("itemId"))::int AS "validPdfActiveRouteSecondBatchCount",
        (SELECT COUNT(*) FROM valid_pdf INNER JOIN active_route USING ("itemId") INNER JOIN sample_roles USING ("itemId") WHERE roles && ARRAY['Training','Evaluation'])::int AS "validPdfActiveRouteExistingDatasetCount",
        (SELECT COUNT(*) FROM valid_pdf INNER JOIN active_route USING ("itemId") LEFT JOIN sample_roles USING ("itemId") LEFT JOIN second_batch USING ("itemId") WHERE second_batch."itemId" IS NULL AND NOT COALESCE(roles && ARRAY['Training','Evaluation'], false))::int AS "strictCleanCandidateCount"
    `, [companyId, currentSecondBatch])).rows[0];

    const documentBreakdown = (await client.query(`
      SELECT
        COALESCE("sourceDocument"::text, '(null)') AS "sourceDocument",
        COALESCE("type"::text, '(null)') AS "type",
        lower(COALESCE("extension", '(null)')) AS "extension",
        COALESCE("active", false) AS "active",
        COUNT(*)::int AS count,
        COUNT(DISTINCT "sourceDocumentId")::int AS "itemCount"
      FROM "document"
      WHERE "companyId" = $1
      GROUP BY "sourceDocument", "type", lower(COALESCE("extension", '(null)')), "active"
      ORDER BY count DESC, "sourceDocument", "type", extension
      LIMIT 50
    `, [companyId])).rows;

    const validPdfTruthRows = (await client.query(`
      WITH valid_pdf AS (
        SELECT "sourceDocumentId" AS "itemId", COUNT(*)::int AS "pdfCount"
        FROM "document"
        WHERE "companyId" = $1
          AND "active" = true
          AND "sourceDocument" = 'Part'
          AND "type" = 'PDF'
          AND lower(COALESCE("extension", '')) = 'pdf'
        GROUP BY "sourceDocumentId"
      ), active_route AS (
        SELECT mm."itemId", STRING_AGG(COALESCE(p."name", mo."processId"), ' -> ' ORDER BY mo."order") AS route, COUNT(mo."id")::int AS ops
        FROM "makeMethod" mm
        INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
        LEFT JOIN "process" p ON p."companyId" = mo."companyId" AND p."id" = mo."processId"
        WHERE mm."companyId" = $1 AND mm."status" = 'Active'::"makeMethodStatus"
        GROUP BY mm."itemId"
      ), roles AS (
        SELECT "itemId", ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS roles
        FROM "aiRoutingSample"
        WHERE "companyId" = $1
        GROUP BY "itemId"
      ), drafts AS (
        SELECT "itemId", COUNT(*)::int AS "draftCount"
        FROM "aiRoutingDraft"
        WHERE "companyId" = $1
        GROUP BY "itemId"
      )
      SELECT
        item."readableId",
        item."readableIdWithRevision",
        item."name",
        valid_pdf."pdfCount",
        active_route.ops,
        active_route.route,
        COALESCE(roles.roles, ARRAY[]::text[]) AS roles,
        COALESCE(drafts."draftCount", 0)::int AS "draftCount",
        (COALESCE(item."readableId", '') = ANY($2::text[]) OR COALESCE(item."readableIdWithRevision", '') = ANY($2::text[])) AS "isCurrentSecondBatch"
      FROM "item" item
      INNER JOIN valid_pdf ON valid_pdf."itemId" = item."id"
      INNER JOIN active_route ON active_route."itemId" = item."id"
      LEFT JOIN roles ON roles."itemId" = item."id"
      LEFT JOIN drafts ON drafts."itemId" = item."id"
      WHERE item."companyId" = $1
      ORDER BY "isCurrentSecondBatch" DESC, roles, item."readableId"
    `, [companyId, currentSecondBatch])).rows;

    const activeRouteNoPdfExamples = (await client.query(`
      WITH valid_pdf AS (
        SELECT DISTINCT "sourceDocumentId" AS "itemId"
        FROM "document"
        WHERE "companyId" = $1
          AND "active" = true
          AND "sourceDocument" = 'Part'
          AND "type" = 'PDF'
          AND lower(COALESCE("extension", '')) = 'pdf'
      ), active_route AS (
        SELECT mm."itemId", STRING_AGG(COALESCE(p."name", mo."processId"), ' -> ' ORDER BY mo."order") AS route, COUNT(mo."id")::int AS ops
        FROM "makeMethod" mm
        INNER JOIN "methodOperation" mo ON mo."companyId" = mm."companyId" AND mo."makeMethodId" = mm."id"
        LEFT JOIN "process" p ON p."companyId" = mo."companyId" AND p."id" = mo."processId"
        WHERE mm."companyId" = $1 AND mm."status" = 'Active'::"makeMethodStatus"
        GROUP BY mm."itemId"
      )
      SELECT item."readableId", item."readableIdWithRevision", item."name", active_route.ops, active_route.route
      FROM "item" item
      INNER JOIN active_route ON active_route."itemId" = item."id"
      LEFT JOIN valid_pdf ON valid_pdf."itemId" = item."id"
      WHERE item."companyId" = $1 AND valid_pdf."itemId" IS NULL
      ORDER BY item."readableId"
      LIMIT 40
    `, [companyId])).rows;

    const output = {
      companyId,
      diagnosedAt: new Date().toISOString(),
      counts,
      documentBreakdown,
      validPdfTruthRows,
      activeRouteNoPdfExamples,
      conclusion: {
        strictCleanCandidateCount: Number(counts.strictCleanCandidateCount),
        canPropose26StrictCandidates: Number(counts.strictCleanCandidateCount) >= 26,
        primaryLimit: Number(counts.validPdfActiveRouteExistingDatasetCount) >= Number(counts.validPdfAndActiveRouteCount) - 1
          ? "Most valid PDF-backed truth-route parts are already in AI Routing Training/Evaluation samples."
          : "The local database does not contain enough valid PDF-backed truth-route parts outside the current dataset."
      }
    };
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}