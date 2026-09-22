import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") return current;
    } catch {}
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

const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const newEvaluationIds = [
  "1927326104",
  "1927881101",
  "1927881103",
  "1927930801",
  "1927930802",
  "1927930803",
  "1927930804",
  "192744140302",
  "192769010102",
  "192769010103",
  "192788110401",
  "192788110402",
  "192788110601",
  "192788110602",
  "192793010401",
  "192793010402",
  "192793080101",
  "192793080201",
  "19276939010203",
  "192472540409",
  "192759010202",
  "192472540414",
  "192739030308",
];
const refreshedEvaluationIds = ["1927930202", "192793020201", "1927930206"];
const pilotEvaluationIds = ["1927930503", "192793050201", "1927930603", "192793060201"];
const blockedTrainingIds = ["1919671001", "1919671002", "191967100102", "192713640301", "19266541010201"];
const extractionTargetIds = [...newEvaluationIds, ...refreshedEvaluationIds];

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN READ ONLY");

  const roleCounts = (await client.query(
    `
      SELECT "datasetRole"::text AS role, COUNT(*)::int AS count
      FROM "aiRoutingSample"
      WHERE "companyId" = $1
      GROUP BY "datasetRole"::text
      ORDER BY role
    `,
    [companyId],
  )).rows;

  const evaluationSampleRows = (await client.query(
    `
      SELECT
        i."readableId",
        s."id" AS "sampleId",
        s."datasetRole"::text AS "datasetRole",
        s."source",
        s."lockedAt" IS NOT NULL AS "locked",
        COALESCE(jsonb_array_length(s."operationSnapshot"), 0)::int AS "operationCount",
        COALESCE(jsonb_array_length(s."drawingSnapshot"), 0)::int AS "drawingSnapshotCount"
      FROM "item" i
      LEFT JOIN "aiRoutingSample" s
        ON s."companyId" = i."companyId"
       AND s."itemId" = i."id"
       AND s."datasetRole" = 'Evaluation'::"aiRoutingDatasetRole"
      WHERE i."companyId" = $1 AND i."readableId" = ANY($2::text[])
      ORDER BY i."readableId", s."id"
    `,
    [companyId, newEvaluationIds],
  )).rows;

  const blockedRows = (await client.query(
    `
      SELECT
        i."readableId",
        COUNT(*) FILTER (WHERE s."datasetRole" = 'Training'::"aiRoutingDatasetRole")::int AS "trainingSamples",
        COUNT(*) FILTER (WHERE s."datasetRole" = 'Evaluation'::"aiRoutingDatasetRole")::int AS "evaluationSamples"
      FROM "item" i
      LEFT JOIN "aiRoutingSample" s ON s."companyId" = i."companyId" AND s."itemId" = i."id"
      WHERE i."companyId" = $1 AND i."readableId" = ANY($2::text[])
      GROUP BY i."readableId"
      ORDER BY i."readableId"
    `,
    [companyId, blockedTrainingIds],
  )).rows;

  const extractionRows = (await client.query(
    `
      WITH latest AS (
        SELECT DISTINCT ON (i."readableId")
          i."readableId",
          e."id" AS "extractionId",
          e."status"::text AS "status",
          e."promptVersion",
          e."modelProvider",
          e."modelName",
          e."completedAt"
        FROM "item" i
        JOIN "aiDrawingExtraction" e ON e."companyId" = i."companyId" AND e."itemId" = i."id"
        WHERE i."companyId" = $1
          AND i."readableId" = ANY($2::text[])
          AND e."status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND e."promptVersion" = 'ai-routing-drawing.prompt.v2'
        ORDER BY i."readableId", e."completedAt" DESC NULLS LAST, e."updatedAt" DESC NULLS LAST, e."createdAt" DESC
      )
      SELECT * FROM latest ORDER BY "readableId"
    `,
    [companyId, extractionTargetIds],
  )).rows;

  const failedExtractionRows = (await client.query(
    `
      SELECT i."readableId", COUNT(*)::int AS "failedCount"
      FROM "item" i
      JOIN "aiDrawingExtraction" e ON e."companyId" = i."companyId" AND e."itemId" = i."id"
      WHERE i."companyId" = $1
        AND i."readableId" = ANY($2::text[])
        AND e."status" = 'Failed'::"aiDrawingExtractionStatus"
      GROUP BY i."readableId"
      ORDER BY i."readableId"
    `,
    [companyId, extractionTargetIds],
  )).rows;

  const allEvaluationIds = [...pilotEvaluationIds, ...refreshedEvaluationIds, ...newEvaluationIds];
  const allEvaluationRows = (await client.query(
    `
      SELECT COUNT(DISTINCT i."readableId")::int AS "lockedEvaluationPartCount"
      FROM "item" i
      JOIN "aiRoutingSample" s ON s."companyId" = i."companyId" AND s."itemId" = i."id"
      WHERE i."companyId" = $1
        AND i."readableId" = ANY($2::text[])
        AND s."datasetRole" = 'Evaluation'::"aiRoutingDatasetRole"
        AND s."lockedAt" IS NOT NULL
    `,
    [companyId, allEvaluationIds],
  )).rows[0];

  await client.query("COMMIT");

  const output = {
    companyId,
    roleCounts,
    newEvaluationSampleCount: evaluationSampleRows.filter((row: any) => row.datasetRole === "Evaluation").length,
    newEvaluationSamplesLocked: evaluationSampleRows.every((row: any) => row.datasetRole === "Evaluation" && row.locked === true),
    newEvaluationSamples: evaluationSampleRows,
    blockedTrainingRows: blockedRows,
    blockedTrainingEvaluationSampleCount: blockedRows.reduce((sum: number, row: any) => sum + Number(row.evaluationSamples ?? 0), 0),
    latestV2SucceededExtractionCount: extractionRows.length,
    latestV2SucceededExtractions: extractionRows,
    failedExtractionRows,
    lockedEvaluationPartCount: allEvaluationRows.lockedEvaluationPartCount,
    expectedLockedEvaluationPartCount: allEvaluationIds.length,
    fakePartExcluded: "asm-top-001",
    writesPerformed: false,
  };

  writeFileSync(
    resolve(
      root,
      process.env.AI_ROUTING_STAGE4_VERIFICATION_OUTPUT_PATH ??
        "apps/erp/.codex/work/ai-routing-stage4-verification-20260821.json"
    ),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify({
    roleCounts: output.roleCounts,
    newEvaluationSampleCount: output.newEvaluationSampleCount,
    newEvaluationSamplesLocked: output.newEvaluationSamplesLocked,
    blockedTrainingEvaluationSampleCount: output.blockedTrainingEvaluationSampleCount,
    latestV2SucceededExtractionCount: output.latestV2SucceededExtractionCount,
    lockedEvaluationPartCount: output.lockedEvaluationPartCount,
    expectedLockedEvaluationPartCount: output.expectedLockedEvaluationPartCount,
    failedExtractionRows: output.failedExtractionRows,
    writesPerformed: output.writesPerformed,
  }, null, 2));

  if (!output.newEvaluationSamplesLocked) process.exitCode = 2;
  if (output.blockedTrainingEvaluationSampleCount !== 0) process.exitCode = 3;
  if (output.latestV2SucceededExtractionCount !== extractionTargetIds.length) process.exitCode = 4;
  if (output.lockedEvaluationPartCount !== output.expectedLockedEvaluationPartCount) process.exitCode = 5;
} finally {
  client.release();
  await pool.end();
}
