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
      const pkg = JSON.parse(
        readFileSync(resolve(current, "package.json"), "utf8")
      );
      if (pkg?.name === "carbon") return current;
    } catch {
      // keep walking
    }

    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

type Row = {
  itemId: string;
  readableId: string | null;
  readableIdWithRevision: string | null;
  name: string | null;
  pdfDocumentCount: number;
  pdfDocumentIds: string[] | null;
  sampleRoles: string[] | null;
  sampleStatuses: string[] | null;
  sampleCount: number;
  draftCount: number;
  acceptedDraftCount: number;
  activeAiDraftCount: number;
  latestExtractionId: string | null;
  latestExtractionPromptVersion: string | null;
  latestExtractionCompletedAt: string | null;
  latestExtraction: unknown;
  partActiveOperationCount: number;
  partActiveRouteSignature: string | null;
  jobRouteCandidateCount: number;
  jobRouteDistinctSignatureCount: number;
  jobRouteOperationCount: number;
  jobRouteSignatures: string[] | null;
  selectedJobRouteSignature: string | null;
  selectedJobOperationCount: number;
};

type Candidate = Row & {
  normalizedReadableId: string;
  truthSource: "PartActiveRoute" | "JobRoute" | "None" | "Ambiguous";
  selectedTruthOperationCount: number;
  selectedTruthRouteSignature: string | null;
  blockers: string[];
  labels: string[];
  coverageScore: number;
  needsV2Extraction: boolean;
};

const fakeReadableIds = new Set(["asm-top-001", "ASM-TOP-001"]);
const existingHoldoutCount = 26;
const minimumHoldoutCount = 30;

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/u8\s+[a-z0-9_-]+\s+/gi, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"));
}

function extractionCount(extraction: unknown, path: string[]) {
  let current = extraction as any;
  for (const key of path) current = current?.[key];
  return Array.isArray(current) ? current.length : 0;
}

function titleBlockValue(extraction: unknown, key: string) {
  const value = (extraction as any)?.titleBlock?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function classify(row: Row) {
  const text = normalizedText([
    row.readableId,
    row.readableIdWithRevision,
    row.name,
    row.partActiveRouteSignature,
    row.selectedJobRouteSignature,
    ...(row.jobRouteSignatures ?? [])
  ].join(" "));
  const extraction = row.latestExtraction;
  const labels = new Set<string>();
  const holes = extractionCount(extraction, ["features", "holes"]);
  const threads = extractionCount(extraction, ["features", "threads"]);
  const slots = extractionCount(extraction, ["features", "slots"]);
  const bends = extractionCount(extraction, ["features", "bends"]);
  const surfaces = extractionCount(extraction, ["features", "surfaces"]);
  const material = titleBlockValue(extraction, "material");
  const finish = titleBlockValue(extraction, "finish");

  if (/激光|折弯|laser|bend/.test(text) || bends > 0) {
    labels.add("laser_bending");
  }
  if (holes >= 3 || slots > 0 || /孔|槽|沉孔|腰孔|hole|slot/.test(text)) {
    labels.add("hole_slot");
  }
  if (threads > 0 || /攻丝|钻|车床|车削|铣|加工中心|机加工|thread|tap|drill|lathe|turn|mill/.test(text)) {
    labels.add("machining_drilling_turning");
  }
  if (/管|锯|saw|tube/.test(text)) labels.add("tube_saw");
  if (/焊|weld|装配|组装|铆/.test(text)) labels.add("welding_fabrication");
  if (/氧化|阳极|外协|电镀|喷涂|喷塑|表面处理|anodiz/.test(text) || /氧化|阳极|anodiz/.test(finish)) {
    labels.add("outsourcing_surface");
  }
  if (/打磨|拉丝|抛光|去毛刺|喷砂|grind|brush|polish/.test(text) || surfaces > 0) {
    labels.add("finish_deburr_polish");
  }
  if (!row.latestExtractionId || labels.size <= 1 || !material) {
    labels.add("weak_or_needs_extraction_review");
  }

  return Array.from(labels).sort();
}

function truthSource(row: Row): Candidate["truthSource"] {
  if (row.partActiveOperationCount > 0) return "PartActiveRoute";
  if (row.jobRouteDistinctSignatureCount > 1) return "Ambiguous";
  if (row.jobRouteCandidateCount > 0 && row.selectedJobOperationCount > 0) {
    return "JobRoute";
  }
  return "None";
}

function candidateBlockers(row: Row, source: Candidate["truthSource"]) {
  const roles = arrayValue<string>(row.sampleRoles);
  const readable = row.readableId ?? row.readableIdWithRevision ?? "";
  const blockers: string[] = [];

  if (fakeReadableIds.has(readable)) blockers.push("fake item excluded");
  if (roles.includes("Training")) blockers.push("existing Training sample would leak");
  if (roles.includes("Evaluation")) blockers.push("already Evaluation holdout");
  if (row.activeAiDraftCount > 0) blockers.push("already active AI-materialized route");
  if (source === "None") blockers.push("truth route missing");
  if (source === "Ambiguous") blockers.push("multiple job-route signatures require review");
  if (row.pdfDocumentCount <= 0) blockers.push("active PDF missing");

  return blockers;
}

function coverageScore(candidate: Candidate) {
  let score = candidate.selectedTruthOperationCount * 5;
  if (candidate.truthSource === "PartActiveRoute") score += 8;
  if (candidate.truthSource === "JobRoute") score += 4;
  if (candidate.latestExtractionId) score += 8;
  if (candidate.latestExtractionPromptVersion === "ai-routing-drawing.prompt.v2") {
    score += 6;
  }
  for (const label of candidate.labels) {
    if (label === "machining_drilling_turning") score += 15;
    if (label === "tube_saw") score += 14;
    if (label === "outsourcing_surface") score += 13;
    if (label === "welding_fabrication") score += 12;
    if (label === "hole_slot") score += 8;
    if (label === "finish_deburr_polish") score += 8;
    if (label === "weak_or_needs_extraction_review") score += 3;
  }
  return score;
}

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

const requireFromDatabase = createRequire(
  resolve(root, "packages/database/package.json")
);
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const outputJsonPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-additional-holdout-broad-scan-20260821.json"
);
const outputMarkdownPath = resolve(
  root,
  "llm/tasks/ai-routing-additional-holdout-broad-scan-20260821.md"
);

try {
  const result = await pool.query<Row>(
    `
      WITH active_pdfs AS (
        SELECT
          d."sourceDocumentId" AS "itemId",
          COUNT(*)::int AS "pdfDocumentCount",
          ARRAY_AGG(d."id" ORDER BY d."createdAt" DESC, d."id") AS "pdfDocumentIds"
        FROM "document" d
        WHERE d."companyId" = $1
          AND d."sourceDocument" = 'Part'
          AND d."type" = 'PDF'
          AND COALESCE(d."active", true) = true
        GROUP BY d."sourceDocumentId"
      ), sample_roles AS (
        SELECT
          s."itemId",
          ARRAY_AGG(DISTINCT s."datasetRole"::text ORDER BY s."datasetRole"::text) AS "sampleRoles",
          ARRAY_AGG(DISTINCT s."status"::text ORDER BY s."status"::text) AS "sampleStatuses",
          COUNT(*)::int AS "sampleCount"
        FROM "aiRoutingSample" s
        WHERE s."companyId" = $1
        GROUP BY s."itemId"
      ), draft_stats AS (
        SELECT
          d."itemId",
          COUNT(*)::int AS "draftCount",
          COUNT(*) FILTER (WHERE d."status" = 'Accepted'::"aiRoutingDraftStatus")::int AS "acceptedDraftCount",
          COUNT(*) FILTER (WHERE mm."status" = 'Active'::"makeMethodStatus")::int AS "activeAiDraftCount"
        FROM "aiRoutingDraft" d
        LEFT JOIN "makeMethod" mm
          ON mm."companyId" = d."companyId"
         AND mm."id" = d."acceptedMakeMethodId"
        WHERE d."companyId" = $1
        GROUP BY d."itemId"
      ), latest_extraction AS (
        SELECT DISTINCT ON (e."itemId")
          e."itemId",
          e."id" AS "latestExtractionId",
          e."promptVersion" AS "latestExtractionPromptVersion",
          e."completedAt"::text AS "latestExtractionCompletedAt",
          e."extraction" AS "latestExtraction"
        FROM "aiDrawingExtraction" e
        WHERE e."companyId" = $1
          AND e."status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND jsonb_typeof(e."extraction") = 'object'
        ORDER BY e."itemId", e."completedAt" DESC NULLS LAST, e."updatedAt" DESC NULLS LAST, e."createdAt" DESC
      ), part_active_route AS (
        SELECT
          mm."itemId",
          COUNT(mo."id")::int AS "partActiveOperationCount",
          STRING_AGG(COALESCE(p."name", mo."processId"), ' -> ' ORDER BY mo."order", mo."id") AS "partActiveRouteSignature"
        FROM "makeMethod" mm
        LEFT JOIN "methodOperation" mo
          ON mo."companyId" = mm."companyId"
         AND mo."makeMethodId" = mm."id"
        LEFT JOIN "process" p
          ON p."companyId" = mo."companyId"
         AND p."id" = mo."processId"
        WHERE mm."companyId" = $1
          AND mm."status" = 'Active'::"makeMethodStatus"
        GROUP BY mm."itemId"
      ), job_route_operations AS (
        SELECT
          jmm."itemId",
          jmm."id" AS "jobMakeMethodId",
          j."jobId" AS "jobReadableId",
          STRING_AGG(COALESCE(p."name", jo."processId"), ' -> ' ORDER BY jo."order", jo."id") AS "routeSignature",
          COUNT(jo."id")::int AS "operationCount"
        FROM "jobMakeMethod" jmm
        JOIN "job" j
          ON j."companyId" = jmm."companyId"
         AND j."id" = jmm."jobId"
        JOIN "jobOperation" jo
          ON jo."companyId" = jmm."companyId"
         AND jo."jobMakeMethodId" = jmm."id"
        LEFT JOIN "process" p
          ON p."companyId" = jo."companyId"
         AND p."id" = jo."processId"
        WHERE jmm."companyId" = $1
        GROUP BY jmm."itemId", jmm."id", j."jobId"
      ), job_route_summary AS (
        SELECT
          "itemId",
          COUNT(*)::int AS "jobRouteCandidateCount",
          COUNT(DISTINCT "routeSignature")::int AS "jobRouteDistinctSignatureCount",
          SUM("operationCount")::int AS "jobRouteOperationCount",
          ARRAY_AGG(DISTINCT "routeSignature" ORDER BY "routeSignature") AS "jobRouteSignatures"
        FROM job_route_operations
        GROUP BY "itemId"
      ), selected_job_route AS (
        SELECT DISTINCT ON ("itemId")
          "itemId",
          "routeSignature" AS "selectedJobRouteSignature",
          "operationCount" AS "selectedJobOperationCount"
        FROM job_route_operations
        ORDER BY "itemId", "operationCount" DESC, "jobReadableId" DESC, "jobMakeMethodId"
      )
      SELECT
        item."id" AS "itemId",
        item."readableId",
        item."readableIdWithRevision",
        item."name",
        pdf."pdfDocumentCount",
        pdf."pdfDocumentIds",
        COALESCE(sr."sampleRoles", ARRAY[]::text[]) AS "sampleRoles",
        COALESCE(sr."sampleStatuses", ARRAY[]::text[]) AS "sampleStatuses",
        COALESCE(sr."sampleCount", 0)::int AS "sampleCount",
        COALESCE(ds."draftCount", 0)::int AS "draftCount",
        COALESCE(ds."acceptedDraftCount", 0)::int AS "acceptedDraftCount",
        COALESCE(ds."activeAiDraftCount", 0)::int AS "activeAiDraftCount",
        le."latestExtractionId",
        le."latestExtractionPromptVersion",
        le."latestExtractionCompletedAt",
        le."latestExtraction",
        COALESCE(par."partActiveOperationCount", 0)::int AS "partActiveOperationCount",
        par."partActiveRouteSignature",
        COALESCE(jrs."jobRouteCandidateCount", 0)::int AS "jobRouteCandidateCount",
        COALESCE(jrs."jobRouteDistinctSignatureCount", 0)::int AS "jobRouteDistinctSignatureCount",
        COALESCE(jrs."jobRouteOperationCount", 0)::int AS "jobRouteOperationCount",
        COALESCE(jrs."jobRouteSignatures", ARRAY[]::text[]) AS "jobRouteSignatures",
        sjr."selectedJobRouteSignature",
        COALESCE(sjr."selectedJobOperationCount", 0)::int AS "selectedJobOperationCount"
      FROM active_pdfs pdf
      JOIN "item" item
        ON item."companyId" = $1
       AND item."id" = pdf."itemId"
      LEFT JOIN sample_roles sr ON sr."itemId" = item."id"
      LEFT JOIN draft_stats ds ON ds."itemId" = item."id"
      LEFT JOIN latest_extraction le ON le."itemId" = item."id"
      LEFT JOIN part_active_route par ON par."itemId" = item."id"
      LEFT JOIN job_route_summary jrs ON jrs."itemId" = item."id"
      LEFT JOIN selected_job_route sjr ON sjr."itemId" = item."id"
      WHERE item."companyId" = $1
      ORDER BY item."readableId" NULLS LAST, item."readableIdWithRevision" NULLS LAST, item."id"
    `,
    [companyId]
  );

  const candidates: Candidate[] = result.rows.map((row) => {
    const source = truthSource(row);
    const selectedTruthOperationCount =
      source === "PartActiveRoute"
        ? row.partActiveOperationCount
        : source === "JobRoute"
          ? row.selectedJobOperationCount
          : 0;
    const selectedTruthRouteSignature =
      source === "PartActiveRoute"
        ? row.partActiveRouteSignature
        : source === "JobRoute"
          ? row.selectedJobRouteSignature
          : null;
    const base = {
      ...row,
      normalizedReadableId: row.readableId ?? row.readableIdWithRevision ?? row.itemId,
      truthSource: source,
      selectedTruthOperationCount,
      selectedTruthRouteSignature,
      blockers: [] as string[],
      labels: [] as string[],
      coverageScore: 0,
      needsV2Extraction:
        row.latestExtractionPromptVersion !== "ai-routing-drawing.prompt.v2"
    } satisfies Candidate;
    base.blockers = candidateBlockers(row, source);
    base.labels = classify(row);
    base.coverageScore = coverageScore(base);
    return base;
  });

  const eligible = candidates
    .filter((candidate) => candidate.blockers.length === 0)
    .sort(
      (a, b) =>
        b.coverageScore - a.coverageScore ||
        a.normalizedReadableId.localeCompare(b.normalizedReadableId)
    );
  const selectedAdditional = eligible.slice(0, Math.max(0, minimumHoldoutCount - existingHoldoutCount));

  const output = {
    companyId,
    scannedAt: new Date().toISOString(),
    existingHoldoutCount,
    minimumHoldoutCount,
    neededAdditionalHoldouts: Math.max(0, minimumHoldoutCount - existingHoldoutCount),
    summary: {
      activePdfPartCount: candidates.length,
      activePdfWithAnyTruthRouteCount: candidates.filter(
        (candidate) => candidate.truthSource === "PartActiveRoute" || candidate.truthSource === "JobRoute"
      ).length,
      cleanAdditionalCandidateCount: eligible.length,
      cleanAdditionalWithCurrentV2ExtractionCount: eligible.filter(
        (candidate) => !candidate.needsV2Extraction
      ).length,
      selectedAdditionalCount: selectedAdditional.length,
      reachesThirtyHoldoutsWithSelection:
        existingHoldoutCount + selectedAdditional.length >= minimumHoldoutCount,
      writesPerformed: false,
      databaseMutationsPerformed: false
    },
    selectedAdditionalHoldouts: selectedAdditional.map((candidate, index) => ({
      rank: index + 1,
      readableId: candidate.normalizedReadableId,
      itemId: candidate.itemId,
      name: candidate.name,
      truthSource: candidate.truthSource,
      operationCount: candidate.selectedTruthOperationCount,
      routeSignature: candidate.selectedTruthRouteSignature,
      pdfDocumentCount: candidate.pdfDocumentCount,
      latestExtractionId: candidate.latestExtractionId,
      latestExtractionPromptVersion: candidate.latestExtractionPromptVersion,
      needsV2Extraction: candidate.needsV2Extraction,
      labels: candidate.labels,
      coverageScore: candidate.coverageScore
    })),
    cleanAdditionalCandidates: eligible.slice(0, 80).map((candidate) => ({
      readableId: candidate.normalizedReadableId,
      itemId: candidate.itemId,
      name: candidate.name,
      truthSource: candidate.truthSource,
      operationCount: candidate.selectedTruthOperationCount,
      routeSignature: candidate.selectedTruthRouteSignature,
      latestExtractionId: candidate.latestExtractionId,
      latestExtractionPromptVersion: candidate.latestExtractionPromptVersion,
      needsV2Extraction: candidate.needsV2Extraction,
      labels: candidate.labels,
      coverageScore: candidate.coverageScore
    })),
    blockedCounts: Array.from(
      candidates.reduce((map, candidate) => {
        for (const blocker of candidate.blockers) {
          map.set(blocker, (map.get(blocker) ?? 0) + 1);
        }
        return map;
      }, new Map<string, number>())
    ).map(([blocker, count]) => ({ blocker, count })),
    blockedPreview: candidates
      .filter((candidate) => candidate.blockers.length > 0)
      .slice(0, 120)
      .map((candidate) => ({
        readableId: candidate.normalizedReadableId,
        name: candidate.name,
        truthSource: candidate.truthSource,
        routeSignature: candidate.selectedTruthRouteSignature,
        sampleRoles: arrayValue<string>(candidate.sampleRoles),
        activeAiDraftCount: candidate.activeAiDraftCount,
        blockers: candidate.blockers
      }))
  };

  const selectedRows = output.selectedAdditionalHoldouts
    .map(
      (candidate) =>
        `| ${candidate.rank} | ${candidate.readableId} | ${candidate.truthSource} | ${candidate.operationCount} | ${candidate.routeSignature ?? ""} | ${candidate.pdfDocumentCount} | ${candidate.latestExtractionId ?? "needs v2 extraction"} | ${candidate.labels.join(", ")} |`
    )
    .join("\n");
  const blockerRows = output.blockedCounts
    .map(({ blocker, count }) => `| ${blocker} | ${count} |`)
    .join("\n");
  const markdown = `# AI Routing Additional Holdout Broad Scan (2026-08-21)\n\nScope: read-only scan of current active Part PDFs with Part-route or Job-route truth. No dataset role, extraction, draft, makeMethod, methodOperation, or activation writes were performed.\n\n## Summary\n\n- Existing locked Evaluation holdouts: ${existingHoldoutCount}\n- Minimum production gate holdouts: ${minimumHoldoutCount}\n- Additional holdouts needed: ${output.neededAdditionalHoldouts}\n- Active PDF Part count: ${output.summary.activePdfPartCount}\n- Active PDF Parts with any truth route: ${output.summary.activePdfWithAnyTruthRouteCount}\n- Clean additional candidate count: ${output.summary.cleanAdditionalCandidateCount}\n- Clean candidates with current v2 extraction: ${output.summary.cleanAdditionalWithCurrentV2ExtractionCount}\n- Selected additional candidates: ${output.summary.selectedAdditionalCount}\n- Reaches 30 holdouts with selected candidates: ${output.summary.reachesThirtyHoldoutsWithSelection}\n\n## Selected Additional Holdouts\n\n| Rank | Part | Truth Source | Ops | Route Signature | PDFs | Latest Extraction | Labels |\n|---:|---|---|---:|---|---:|---|---|\n${selectedRows || "| - | - | - | - | - | - | - | - |"}\n\n## Blocker Counts\n\n| Blocker | Count |\n|---|---:|\n${blockerRows || "| - | 0 |"}\n\n## Guardrails\n\n1. Selected candidates are only candidates. They must be written as locked Evaluation, never Training, if used.\n2. Candidates needing v2 extraction require controlled v2 drawing extraction before scoring.\n3. Evaluation rows must remain excluded from retrieval.\n4. This scan does not authorize formal route materialization or activation.\n\nEvidence JSON: \`${outputJsonPath}\`.\n`;

  writeFileSync(outputJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(outputMarkdownPath, markdown, "utf8");
  console.log(JSON.stringify(output.summary, null, 2));
  console.log(`Evidence JSON: ${outputJsonPath}`);
  console.log(`Evidence Markdown: ${outputMarkdownPath}`);
} finally {
  await pool.end();
}