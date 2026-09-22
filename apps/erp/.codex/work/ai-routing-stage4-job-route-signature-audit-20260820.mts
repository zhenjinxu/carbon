import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(
  path: string,
  options: { override?: boolean; only?: Set<string> } = {}
) {
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}

    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

const requestedReadableIds = [
  "1919671001",
  "1919671002",
  "1927326104",
  "1927881101",
  "1927881103",
  "1927930801",
  "1927930802",
  "1927930803",
  "1927930804",
  "191967100102",
  "192713640301",
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
  "19266541010201",
  "19276939010203"
];

const fakeReadableIds = new Set(["asm-top-001", "ASM-TOP-001"]);
const root = findRoot(dirname(fileURLToPath(import.meta.url)));

loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is not configured");
}

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-stage4-job-route-signature-audit-20260820.json"
);

type Row = {
  requestedReadableId: string;
  inputOrder: number;
  itemId: string | null;
  readableId: string | null;
  readableIdWithRevision: string | null;
  name: string | null;
  pdfCount: number;
  sampleRoles: string[] | null;
  extractionStatuses: string[] | null;
  partActiveMethodIds: string[] | null;
  partActiveOperationCount: number;
  jobRouteCandidateCount: number;
  jobOperationCount: number;
  distinctRouteSignatureCount: number;
  routeSignatures: string[] | null;
  selectedJobMakeMethodId: string | null;
  selectedJobId: string | null;
  selectedOperationCount: number;
  selectedRouteSignature: string | null;
};

function uniqueText(values: string[] | null | undefined) {
  return Array.from(new Set((values ?? []).filter(Boolean))).sort();
}

function statusFor(row: Row) {
  const blockers: string[] = [];
  const roles = uniqueText(row.sampleRoles);
  const extractionStatuses = uniqueText(row.extractionStatuses);
  const hasSucceededExtraction = extractionStatuses.includes("Succeeded");
  const hasV2Extraction = false;

  if (fakeReadableIds.has(row.requestedReadableId)) blockers.push("fake item excluded");
  if (!row.itemId) blockers.push("item missing");
  if (row.pdfCount <= 0) blockers.push("active Part PDF missing");
  if (roles.includes("Training")) blockers.push("existing Training sample would leak");
  if (row.jobRouteCandidateCount <= 0) blockers.push("job-route truth missing");
  if (row.distinctRouteSignatureCount > 1) blockers.push("multiple job-route signatures require review");

  const needsExtraction = row.pdfCount > 0 && !hasSucceededExtraction;
  const recommendedStatus =
    blockers.length === 0
      ? needsExtraction || !hasV2Extraction
        ? "EligibleAfterControlledV2Extraction"
        : "ReadyEvaluationCandidate"
      : "Blocked";

  return {
    blockers,
    notes: [
      row.partActiveOperationCount === 0 && row.jobRouteCandidateCount > 0
        ? "Part active makeMethod is an empty shell; job route can be used as truth source."
        : null,
      needsExtraction ? "Needs controlled v2 drawing extraction before sample write/scoring." : null,
      roles.includes("Training") ? "Keep as Training; do not reclassify into Evaluation." : null
    ].filter(Boolean),
    recommendedStatus
  };
}

try {
  const client = await pool.connect();
  try {
    const rows = (
      await client.query<Row>(
        `
        WITH requested AS (
          SELECT unnest($2::text[]) AS "requestedReadableId", generate_subscripts($2::text[], 1) AS "inputOrder"
        ), matched_item AS (
          SELECT DISTINCT ON (requested."requestedReadableId")
            requested."requestedReadableId",
            requested."inputOrder",
            item."id" AS "itemId",
            item."readableId",
            item."readableIdWithRevision",
            item."name"
          FROM requested
          LEFT JOIN "item" item
            ON item."companyId" = $1
           AND (item."readableId" = requested."requestedReadableId" OR item."readableIdWithRevision" = requested."requestedReadableId")
          ORDER BY requested."requestedReadableId", item."updatedAt" DESC NULLS LAST, item."createdAt" DESC NULLS LAST
        ), active_pdfs AS (
          SELECT "sourceDocumentId" AS "itemId", COUNT(*)::int AS "pdfCount"
          FROM "document"
          WHERE "companyId" = $1
            AND "sourceDocument" = 'Part'
            AND "type" = 'PDF'
            AND COALESCE("active", true) = true
          GROUP BY "sourceDocumentId"
        ), sample_roles AS (
          SELECT "itemId", ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS "sampleRoles"
          FROM "aiRoutingSample"
          WHERE "companyId" = $1
          GROUP BY "itemId"
        ), extractions AS (
          SELECT "itemId", ARRAY_AGG(DISTINCT "status"::text ORDER BY "status"::text) AS "extractionStatuses"
          FROM "aiDrawingExtraction"
          WHERE "companyId" = $1
          GROUP BY "itemId"
        ), active_part_methods AS (
          SELECT
            mm."itemId",
            ARRAY_AGG(DISTINCT mm."id" ORDER BY mm."id") AS "partActiveMethodIds",
            COUNT(mo."id")::int AS "partActiveOperationCount"
          FROM "makeMethod" mm
          LEFT JOIN "methodOperation" mo
            ON mo."companyId" = mm."companyId"
           AND mo."makeMethodId" = mm."id"
          WHERE mm."companyId" = $1
            AND mm."status" = 'Active'
          GROUP BY mm."itemId"
        ), job_route_operations AS (
          SELECT
            jmm."itemId",
            jmm."id" AS "jobMakeMethodId",
            j."jobId" AS "jobReadableId",
            STRING_AGG(COALESCE(process."name", jo."processId"), ' -> ' ORDER BY jo."order", jo."id") AS "routeSignature",
            COUNT(jo."id")::int AS "operationCount"
          FROM "jobMakeMethod" jmm
          JOIN "job" j
            ON j."companyId" = jmm."companyId"
           AND j."id" = jmm."jobId"
          JOIN "jobOperation" jo
            ON jo."companyId" = jmm."companyId"
           AND jo."jobMakeMethodId" = jmm."id"
          LEFT JOIN "process" process
            ON process."companyId" = jo."companyId"
           AND process."id" = jo."processId"
          WHERE jmm."companyId" = $1
          GROUP BY jmm."itemId", jmm."id", j."jobId"
        ), job_route_summary AS (
          SELECT
            "itemId",
            COUNT(*)::int AS "jobRouteCandidateCount",
            SUM("operationCount")::int AS "jobOperationCount",
            COUNT(DISTINCT "routeSignature")::int AS "distinctRouteSignatureCount",
            ARRAY_AGG(DISTINCT "routeSignature" ORDER BY "routeSignature") AS "routeSignatures"
          FROM job_route_operations
          GROUP BY "itemId"
        ), selected_job_route AS (
          SELECT DISTINCT ON ("itemId")
            "itemId",
            "jobMakeMethodId" AS "selectedJobMakeMethodId",
            "jobReadableId" AS "selectedJobId",
            "operationCount" AS "selectedOperationCount",
            "routeSignature" AS "selectedRouteSignature"
          FROM job_route_operations
          ORDER BY "itemId", "jobReadableId" DESC, "jobMakeMethodId"
        )
        SELECT
          mi."requestedReadableId",
          mi."inputOrder",
          mi."itemId",
          mi."readableId",
          mi."readableIdWithRevision",
          mi."name",
          COALESCE(ap."pdfCount", 0)::int AS "pdfCount",
          COALESCE(sr."sampleRoles", ARRAY[]::text[]) AS "sampleRoles",
          COALESCE(ex."extractionStatuses", ARRAY[]::text[]) AS "extractionStatuses",
          COALESCE(apm."partActiveMethodIds", ARRAY[]::text[]) AS "partActiveMethodIds",
          COALESCE(apm."partActiveOperationCount", 0)::int AS "partActiveOperationCount",
          COALESCE(jrs."jobRouteCandidateCount", 0)::int AS "jobRouteCandidateCount",
          COALESCE(jrs."jobOperationCount", 0)::int AS "jobOperationCount",
          COALESCE(jrs."distinctRouteSignatureCount", 0)::int AS "distinctRouteSignatureCount",
          COALESCE(jrs."routeSignatures", ARRAY[]::text[]) AS "routeSignatures",
          sjr."selectedJobMakeMethodId",
          sjr."selectedJobId",
          COALESCE(sjr."selectedOperationCount", 0)::int AS "selectedOperationCount",
          sjr."selectedRouteSignature"
        FROM matched_item mi
        LEFT JOIN active_pdfs ap ON ap."itemId" = mi."itemId"
        LEFT JOIN sample_roles sr ON sr."itemId" = mi."itemId"
        LEFT JOIN extractions ex ON ex."itemId" = mi."itemId"
        LEFT JOIN active_part_methods apm ON apm."itemId" = mi."itemId"
        LEFT JOIN job_route_summary jrs ON jrs."itemId" = mi."itemId"
        LEFT JOIN selected_job_route sjr ON sjr."itemId" = mi."itemId"
        ORDER BY mi."inputOrder"
        `,
        [companyId, requestedReadableIds]
      )
    ).rows;

    const candidates = rows.map((row) => ({ ...row, ...statusFor(row) }));
    const eligibleAfterExtraction = candidates.filter(
      (row) => row.recommendedStatus === "EligibleAfterControlledV2Extraction"
    );
    const trainingLeakBlocked = candidates.filter((row) =>
      row.blockers.includes("existing Training sample would leak")
    );
    const multipleRouteSignatureBlocked = candidates.filter((row) =>
      row.blockers.includes("multiple job-route signatures require review")
    );
    const missingJobTruthBlocked = candidates.filter((row) =>
      row.blockers.includes("job-route truth missing")
    );

    const output = {
      companyId,
      checkedAt: new Date().toISOString(),
      requestedCount: requestedReadableIds.length,
      excludedFakeIds: Array.from(fakeReadableIds),
      summary: {
        activePdfCount: candidates.filter((row) => row.pdfCount > 0).length,
        trainingLeakBlockedCount: trainingLeakBlocked.length,
        eligibleAfterControlledV2ExtractionCount: eligibleAfterExtraction.length,
        multipleRouteSignatureBlockedCount: multipleRouteSignatureBlocked.length,
        missingJobTruthBlockedCount: missingJobTruthBlocked.length,
        allJobRouteBackedZeroPartOpsCount: candidates.filter(
          (row) => row.partActiveOperationCount === 0 && row.jobRouteCandidateCount > 0
        ).length,
        writesPerformed: false,
        databaseMutationsPerformed: false
      },
      eligibleAfterControlledV2Extraction: eligibleAfterExtraction.map((row) => ({
        readableId: row.readableId,
        name: row.name,
        itemId: row.itemId,
        pdfCount: row.pdfCount,
        partActiveOperationCount: row.partActiveOperationCount,
        jobRouteCandidateCount: row.jobRouteCandidateCount,
        jobOperationCount: row.jobOperationCount,
        distinctRouteSignatureCount: row.distinctRouteSignatureCount,
        selectedJobMakeMethodId: row.selectedJobMakeMethodId,
        selectedJobId: row.selectedJobId,
        selectedOperationCount: row.selectedOperationCount,
        selectedRouteSignature: row.selectedRouteSignature
      })),
      trainingLeakBlocked: trainingLeakBlocked.map((row) => ({
        readableId: row.readableId,
        name: row.name,
        itemId: row.itemId,
        sampleRoles: uniqueText(row.sampleRoles),
        partActiveOperationCount: row.partActiveOperationCount,
        selectedRouteSignature: row.selectedRouteSignature
      })),
      multipleRouteSignatureBlocked: multipleRouteSignatureBlocked.map((row) => ({
        readableId: row.readableId,
        name: row.name,
        routeSignatures: uniqueText(row.routeSignatures)
      })),
      missingJobTruthBlocked: missingJobTruthBlocked.map((row) => ({
        readableId: row.readableId,
        name: row.name,
        pdfCount: row.pdfCount,
        partActiveOperationCount: row.partActiveOperationCount
      })),
      perPart: candidates
    };

    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output.summary, null, 2));
    console.log(`Evidence JSON: ${outputPath}`);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
