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
    if (!key || rawValue === undefined) continue;
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
    } catch {
      // keep walking
    }
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
]

const existingPilotHoldouts = new Set([
  "1927930503",
  "192793050201",
  "1927930603",
  "192793060201"
]);
const currentTrainingSecondBatch = new Set([
  "1927930501",
  "1927930502",
  "1927930601",
  "1927930602",
  "192793050101",
  "192793050200",
  "192793060101",
  "192793060200"
]);
const forbiddenReadableIds = new Set(["asm-top-001", "ASM-TOP-001"]);

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/u8\s+[a-z0-9_-]+\s+/gi, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"));
}
function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}
function classify(routeSignature: string | null, itemName: string | null) {
  const text = normalizeText(`${routeSignature ?? ""} ${itemName ?? ""}`);
  const labels: string[] = [];
  if (hasAny(text, [/激光.*折弯|折弯.*激光/])) labels.push("laser_bending_baseline");
  if (hasAny(text, [/沉孔|腰孔|长圆孔|槽|开孔|冲孔|钻床|钻孔|孔|线切割/])) {
    labels.push("hole_slot_countersink");
  }
  if (hasAny(text, [/攻丝|钻床|机加工|加工中心|车床|铣|线切割|cnc/i])) {
    labels.push("tapping_drilling_machining");
  }
  if (hasAny(text, [/焊|拼装|组焊|装配|铆/])) labels.push("welding_fabrication");
  if (hasAny(text, [/打磨|去毛刺|拉丝|抛光|喷砂|磨/])) {
    labels.push("deburr_grind_brush_polish");
  }
  if (hasAny(text, [/外协|喷涂|喷漆|电镀|氧化|发黑|热处理|表面处理|喷砂/])) {
    labels.push("outsourcing_surface_treatment");
  }
  return Array.from(new Set(labels));
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputJsonPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-stage4-user-pdf-list-audit-20260820.json"
);
const outputMarkdownPath = resolve(
  root,
  "llm/tasks/ai-routing-stage4-user-pdf-list-audit-20260820.md"
);

try {
  const result = await pool.query(
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
          item."name" AS "itemName"
        FROM requested
        LEFT JOIN "item" item
          ON item."companyId" = $1
         AND (
           item."readableId" = requested."requestedReadableId"
           OR item."readableIdWithRevision" = requested."requestedReadableId"
         )
        ORDER BY requested."requestedReadableId", item."updatedAt" DESC NULLS LAST, item."createdAt" DESC NULLS LAST
      ), pdf_docs AS (
        SELECT
          d."sourceDocumentId" AS "itemId",
          COUNT(*)::int AS "pdfDocumentCount",
          jsonb_agg(
            jsonb_build_object(
              'id', d."id",
              'name', d."name",
              'path', d."path",
              'size', d."size",
              'createdAt', d."createdAt"
            )
            ORDER BY d."createdAt" DESC, d."id"
          ) AS "pdfDocuments"
        FROM "document" d
        WHERE d."companyId" = $1
          AND d."active" = true
          AND d."sourceDocument" = 'Part'
          AND d."type" = 'PDF'
          AND lower(COALESCE(d."extension", '')) = 'pdf'
        GROUP BY d."sourceDocumentId"
      ), active_route AS (
        SELECT
          mm."itemId",
          COUNT(DISTINCT mm."id")::int AS "activeMethodCount",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT mm."id"), NULL) AS "activeMethodIds",
          COUNT(mo."id")::int AS "operationCount",
          STRING_AGG(COALESCE(p."name", mo."processId"), ' -> ' ORDER BY mo."order") AS "routeSignature",
          jsonb_agg(
            jsonb_build_object(
              'order', mo."order",
              'processId', mo."processId",
              'processName', p."name",
              'workCenterId', mo."workCenterId",
              'workCenterName', wc."name"
            )
            ORDER BY mo."order"
          ) FILTER (WHERE mo."id" IS NOT NULL) AS "operations"
        FROM "makeMethod" mm
        LEFT JOIN "methodOperation" mo
          ON mo."companyId" = mm."companyId"
         AND mo."makeMethodId" = mm."id"
        LEFT JOIN "process" p
          ON p."companyId" = mo."companyId"
         AND p."id" = mo."processId"
        LEFT JOIN "workCenter" wc
          ON wc."companyId" = mo."companyId"
         AND wc."id" = mo."workCenterId"
        WHERE mm."companyId" = $1
          AND mm."status" = 'Active'::"makeMethodStatus"
        GROUP BY mm."itemId"
      ), method_stats AS (
        SELECT
          "itemId",
          COUNT(*)::int AS "methodCount",
          ARRAY_AGG(DISTINCT "status"::text ORDER BY "status"::text) AS "methodStatuses"
        FROM "makeMethod"
        WHERE "companyId" = $1
        GROUP BY "itemId"
      ), sample_roles AS (
        SELECT
          "itemId",
          ARRAY_AGG(DISTINCT "datasetRole"::text ORDER BY "datasetRole"::text) AS "sampleRoles",
          ARRAY_AGG(DISTINCT "status"::text ORDER BY "status"::text) AS "sampleStatuses",
          COUNT(*)::int AS "sampleCount"
        FROM "aiRoutingSample"
        WHERE "companyId" = $1
        GROUP BY "itemId"
      ), draft_stats AS (
        SELECT
          d."itemId",
          COUNT(*)::int AS "draftCount",
          COUNT(*) FILTER (WHERE d."status" = 'Accepted'::"aiRoutingDraftStatus")::int AS "acceptedDraftCount",
          COUNT(*) FILTER (WHERE mm."status" = 'Active'::"makeMethodStatus")::int AS "activeAiDraftCount",
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT d."acceptedMakeMethodId"), NULL) AS "acceptedMakeMethodIds"
        FROM "aiRoutingDraft" d
        LEFT JOIN "makeMethod" mm
          ON mm."companyId" = d."companyId"
         AND mm."id" = d."acceptedMakeMethodId"
        WHERE d."companyId" = $1
        GROUP BY d."itemId"
      ), extraction_stats AS (
        SELECT
          e."itemId",
          COUNT(*)::int AS "extractionCount",
          ARRAY_AGG(DISTINCT e."status"::text ORDER BY e."status"::text) AS "extractionStatuses"
        FROM "aiDrawingExtraction" e
        WHERE e."companyId" = $1
        GROUP BY e."itemId"
      ), latest_extraction AS (
        SELECT DISTINCT ON (e."itemId")
          e."itemId",
          e."id" AS "latestExtractionId",
          e."status"::text AS "latestExtractionStatus",
          e."promptVersion" AS "latestExtractionPromptVersion",
          e."completedAt"::text AS "latestExtractionCompletedAt",
          jsonb_array_length(e."warnings")::int AS "latestExtractionWarningCount",
          e."extraction"->'titleBlock'->>'material' AS "latestExtractionMaterial",
          e."extraction"->'titleBlock'->>'finish' AS "latestExtractionFinish"
        FROM "aiDrawingExtraction" e
        WHERE e."companyId" = $1
          AND e."status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND jsonb_typeof(e."extraction") = 'object'
        ORDER BY e."itemId", e."completedAt" DESC NULLS LAST, e."updatedAt" DESC NULLS LAST, e."createdAt" DESC
      )
      SELECT
        matched_item.*,
        COALESCE(pdf_docs."pdfDocumentCount", 0)::int AS "pdfDocumentCount",
        COALESCE(pdf_docs."pdfDocuments", '[]'::jsonb) AS "pdfDocuments",
        COALESCE(active_route."activeMethodCount", 0)::int AS "activeMethodCount",
        COALESCE(active_route."activeMethodIds", ARRAY[]::text[]) AS "activeMethodIds",
        COALESCE(active_route."operationCount", 0)::int AS "operationCount",
        active_route."routeSignature",
        COALESCE(active_route."operations", '[]'::jsonb) AS "operations",
        COALESCE(method_stats."methodCount", 0)::int AS "methodCount",
        COALESCE(method_stats."methodStatuses", ARRAY[]::text[]) AS "methodStatuses",
        COALESCE(sample_roles."sampleRoles", ARRAY[]::text[]) AS "sampleRoles",
        COALESCE(sample_roles."sampleStatuses", ARRAY[]::text[]) AS "sampleStatuses",
        COALESCE(sample_roles."sampleCount", 0)::int AS "sampleCount",
        COALESCE(draft_stats."draftCount", 0)::int AS "draftCount",
        COALESCE(draft_stats."acceptedDraftCount", 0)::int AS "acceptedDraftCount",
        COALESCE(draft_stats."activeAiDraftCount", 0)::int AS "activeAiDraftCount",
        COALESCE(draft_stats."acceptedMakeMethodIds", ARRAY[]::text[]) AS "acceptedMakeMethodIds",
        COALESCE(extraction_stats."extractionCount", 0)::int AS "extractionCount",
        COALESCE(extraction_stats."extractionStatuses", ARRAY[]::text[]) AS "extractionStatuses",
        latest_extraction."latestExtractionId",
        latest_extraction."latestExtractionStatus",
        latest_extraction."latestExtractionPromptVersion",
        latest_extraction."latestExtractionCompletedAt",
        latest_extraction."latestExtractionWarningCount",
        latest_extraction."latestExtractionMaterial",
        latest_extraction."latestExtractionFinish"
      FROM matched_item
      LEFT JOIN pdf_docs ON pdf_docs."itemId" = matched_item."itemId"
      LEFT JOIN active_route ON active_route."itemId" = matched_item."itemId"
      LEFT JOIN method_stats ON method_stats."itemId" = matched_item."itemId"
      LEFT JOIN sample_roles ON sample_roles."itemId" = matched_item."itemId"
      LEFT JOIN draft_stats ON draft_stats."itemId" = matched_item."itemId"
      LEFT JOIN extraction_stats ON extraction_stats."itemId" = matched_item."itemId"
      LEFT JOIN latest_extraction ON latest_extraction."itemId" = matched_item."itemId"
      ORDER BY matched_item."inputOrder"
    `,
    [companyId, requestedReadableIds]
  );

  const rows = result.rows.map((row: any) => {
    const readableId = row.readableId ?? row.readableIdWithRevision ?? row.requestedReadableId;
    const sampleRoles = asArray<string>(row.sampleRoles);
    const labels = classify(row.routeSignature, row.itemName);
    const blockers: string[] = [];
    const notes: string[] = [];
    if (!row.itemId) blockers.push("item not found");
    if (forbiddenReadableIds.has(readableId)) blockers.push("forbidden fake item");
    if (currentTrainingSecondBatch.has(readableId)) blockers.push("current Training second-batch item");
    if (existingPilotHoldouts.has(readableId)) blockers.push("already in current 4-holdout pilot");
    if (toNumber(row.pdfDocumentCount) === 0) blockers.push("no active Part PDF");
    if (toNumber(row.activeMethodCount) !== 1) blockers.push("active method count is not exactly 1");
    if (toNumber(row.operationCount) === 0) blockers.push("no active truth operations");
    if (sampleRoles.includes("Training")) blockers.push("existing Training sample would leak");
    if (toNumber(row.activeAiDraftCount) > 0) blockers.push("already has active AI-materialized draft");
    if (sampleRoles.includes("Evaluation")) notes.push("already Evaluation; no dataset-role write needed");
    if (toNumber(row.draftCount) > 0) notes.push("existing AI draft present; review before rerun/materialization");
    if (!row.latestExtractionId) notes.push("needs v2 drawing extraction before PDF-only draft scoring");
    else if (row.latestExtractionPromptVersion !== "ai-routing-drawing.prompt.v2") {
      notes.push(`latest extraction is ${row.latestExtractionPromptVersion}; v2 refresh recommended`);
    }

    return {
      requestedReadableId: row.requestedReadableId,
      readableId,
      readableIdWithRevision: row.readableIdWithRevision,
      itemId: row.itemId,
      itemName: row.itemName,
      status: blockers.length === 0 ? "ReadyForEvaluationCandidate" : "Blocked",
      blockers,
      notes,
      labels,
      pdfDocumentCount: toNumber(row.pdfDocumentCount),
      activeMethodIds: asArray<string>(row.activeMethodIds),
      operationCount: toNumber(row.operationCount),
      routeSignature: row.routeSignature,
      operations: asArray(row.operations),
      methodCount: toNumber(row.methodCount),
      methodStatuses: asArray<string>(row.methodStatuses),
      sampleRoles,
      sampleStatuses: asArray<string>(row.sampleStatuses),
      sampleCount: toNumber(row.sampleCount),
      draftCount: toNumber(row.draftCount),
      acceptedDraftCount: toNumber(row.acceptedDraftCount),
      activeAiDraftCount: toNumber(row.activeAiDraftCount),
      acceptedMakeMethodIds: asArray<string>(row.acceptedMakeMethodIds),
      extractionCount: toNumber(row.extractionCount),
      extractionStatuses: asArray<string>(row.extractionStatuses),
      latestExtractionId: row.latestExtractionId,
      latestExtractionStatus: row.latestExtractionStatus,
      latestExtractionPromptVersion: row.latestExtractionPromptVersion,
      latestExtractionCompletedAt: row.latestExtractionCompletedAt,
      latestExtractionWarningCount: row.latestExtractionWarningCount,
      latestExtractionMaterial: row.latestExtractionMaterial,
      latestExtractionFinish: row.latestExtractionFinish
    };
  });

  const ready = rows.filter((row) => row.status === "ReadyForEvaluationCandidate");
  const blocked = rows.filter((row) => row.status !== "ReadyForEvaluationCandidate");
  const bucketCounts = rows.reduce<Record<string, number>>((acc, row) => {
    for (const label of row.labels) acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});
  const summary = {
    companyId,
    auditedAt: new Date().toISOString(),
    requestedCount: requestedReadableIds.length,
    foundItemCount: rows.filter((row) => row.itemId).length,
    readyCandidateCount: ready.length,
    blockedCount: blocked.length,
    activePdfCount: rows.filter((row) => row.pdfDocumentCount > 0).length,
    activeTruthRouteCount: rows.filter((row) => row.operationCount > 0 && row.activeMethodIds.length === 1).length,
    existingTrainingCount: rows.filter((row) => row.sampleRoles.includes("Training")).length,
    existingEvaluationCount: rows.filter((row) => row.sampleRoles.includes("Evaluation")).length,
    existingDraftCount: rows.filter((row) => row.draftCount > 0).length,
    withSucceededExtractionCount: rows.filter((row) => row.latestExtractionId).length,
    needsExtractionCount: rows.filter((row) => row.status === "ReadyForEvaluationCandidate" && !row.latestExtractionId).length,
    needsV2RefreshCount: rows.filter(
      (row) => row.status === "ReadyForEvaluationCandidate" && row.latestExtractionPromptVersion && row.latestExtractionPromptVersion !== "ai-routing-drawing.prompt.v2"
    ).length,
    bucketCounts,
    writesPerformed: false,
    databaseMutationsPerformed: false
  };

  const readyRows = ready
    .map((row, index) => `| ${index + 1} | ${row.readableId} | ${row.itemName ?? ""} | ${row.labels.join(", ") || "uncategorized"} | ${row.operationCount} | ${row.routeSignature ?? ""} | ${row.pdfDocumentCount} | ${row.latestExtractionId ? `${row.latestExtractionId} (${row.latestExtractionPromptVersion ?? "unknown"})` : "needs extraction"} | ${row.sampleRoles.join(", ") || "none"} | ${row.notes.join("; ")} |`)
    .join("\n");
  const blockedRows = blocked
    .map((row, index) => `| ${index + 1} | ${row.requestedReadableId} | ${row.itemName ?? ""} | ${row.blockers.join("; ")} | ${row.pdfDocumentCount} | ${row.operationCount} | ${row.sampleRoles.join(", ") || "none"} |`)
    .join("\n");
  const markdown = `# AI Routing Stage 4 User PDF List Audit (2026-08-20)\n\nScope: read-only audit for the 24 user-provided real PDF parts. No PDFs were imported, no dataset roles changed, no extraction jobs queued, no drafts/routes deleted, and no formal routing rows written. \`asm-top-001\` is explicitly excluded.\n\n## Summary\n\n- Requested parts: ${summary.requestedCount}\n- Items found: ${summary.foundItemCount}\n- Ready Evaluation candidates: ${summary.readyCandidateCount}\n- Blocked: ${summary.blockedCount}\n- Active Part PDF present: ${summary.activePdfCount}\n- Active truth route present: ${summary.activeTruthRouteCount}\n- Existing Training samples: ${summary.existingTrainingCount}\n- Existing Evaluation samples: ${summary.existingEvaluationCount}\n- Existing AI drafts: ${summary.existingDraftCount}\n- Ready candidates needing extraction: ${summary.needsExtractionCount}\n- Ready candidates needing v2 extraction refresh: ${summary.needsV2RefreshCount}\n\n## Ready Candidates\n\n| Rank | Part | Name | Labels | Ops | Active Truth Route | PDFs | Latest Extraction | Existing Role | Notes |\n|---:|---|---|---|---:|---|---:|---|---|---|\n${readyRows || "| - | - | - | - | - | - | - | - | - | - |"}\n\n## Blocked / Needs Correction\n\n| Rank | Requested Part | Name | Blockers | PDFs | Ops | Existing Role |\n|---:|---|---|---|---:|---:|---|\n${blockedRows || "| - | - | - | - | - | - | - |"}\n\n## Next Gate\n\n1. Do not delete imported truth routes unless a later audit proves they are duplicate/wrong and a safe archival path is selected. Current audit treats Active route as truth evidence.\n2. Write/keep candidates as Evaluation only, never Training. Existing Evaluation rows need no role write.\n3. Run v2 drawing extraction for candidates with no succeeded extraction or prompt v1 extraction before PDF-only draft scoring.\n4. Persist a versioned evaluation run before any materialization.\n5. Do not use \`asm-top-001\`.\n\nEvidence JSON: \`${outputJsonPath}\`.\n`;

  const output = { summary, ready, blocked, rows };
  writeFileSync(outputJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(outputMarkdownPath, markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        summary,
        ready: ready.map((row) => ({
          readableId: row.readableId,
          labels: row.labels,
          operationCount: row.operationCount,
          routeSignature: row.routeSignature,
          latestExtractionId: row.latestExtractionId,
          latestExtractionPromptVersion: row.latestExtractionPromptVersion,
          notes: row.notes
        })),
        blocked: blocked.map((row) => ({
          requestedReadableId: row.requestedReadableId,
          blockers: row.blockers
        })),
        outputJsonPath,
        outputMarkdownPath
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}