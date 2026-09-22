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

type DbRow = {
  itemId: string;
  readableId: string | null;
  readableIdWithRevision: string | null;
  itemName: string | null;
  notes: string | null;
  pdfDocumentCount: number | string;
  pdfDocuments: unknown;
  activeMethodCount: number | string;
  activeMethodIds: string[] | null;
  operationCount: number | string;
  routeSignature: string | null;
  operations: unknown;
  sampleRoles: string[] | null;
  sampleStatuses: string[] | null;
  sampleCount: number | string | null;
  draftCount: number | string | null;
  acceptedDraftCount: number | string | null;
  activeAiDraftCount: number | string | null;
  latestExtractionId: string | null;
  latestExtractionStatus: string | null;
  latestExtractionPromptVersion: string | null;
  latestExtractionCompletedAt: string | null;
  latestExtractionWarnings: unknown;
  latestExtraction: unknown;
};

type Operation = {
  order: number | null;
  processId: string | null;
  processName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
};

type PdfDocument = {
  id: string | null;
  name: string | null;
  path: string | null;
  size: number | null;
};

type Candidate = {
  rank: number | null;
  bucket: string | null;
  readableId: string;
  readableIdWithRevision: string | null;
  itemId: string;
  itemName: string | null;
  reason: string;
  pdfDocumentCount: number;
  pdfDocuments: PdfDocument[];
  activeMethodIds: string[];
  operationCount: number;
  routeSignature: string | null;
  operations: Operation[];
  sampleRoles: string[];
  sampleStatuses: string[];
  sampleCount: number;
  draftCount: number;
  acceptedDraftCount: number;
  activeAiDraftCount: number;
  latestExtractionId: string | null;
  latestExtractionStatus: string | null;
  latestExtractionPromptVersion: string | null;
  latestExtractionCompletedAt: string | null;
  extractionSummary: {
    material: string | null;
    finish: string | null;
    holes: number;
    threads: number;
    slots: number;
    bends: number;
    surfaces: number;
    warnings: number;
  };
  labels: string[];
  selectionScore: number;
  guardrails: string[];
};

const currentSecondBatch = new Set([
  "1927930501",
  "1927930502",
  "1927930503",
  "1927930601",
  "1927930602",
  "1927930603",
  "192793050101",
  "192793050200",
  "192793050201",
  "192793060101",
  "192793060200",
  "192793060201"
]);

const buckets = [
  {
    key: "laser_bending_baseline",
    label: "Laser + bending sheet-metal baseline",
    needed: 4,
    reason: "补齐当前 4 个同路线 pilot 的尺寸/材料/厚度重复性验证。"
  },
  {
    key: "hole_slot_countersink",
    label: "Hole-heavy / countersink / slot features",
    needed: 4,
    reason: "验证孔、沉孔、槽等 PDF 特征是否会驱动正确增减工序。"
  },
  {
    key: "tapping_drilling_machining",
    label: "Tapping / drilling / machining follow-up",
    needed: 4,
    reason: "区分激光成孔与攻丝、钻孔、机加工等后续工序。"
  },
  {
    key: "welding_fabrication",
    label: "Welding / fabrication",
    needed: 5,
    reason: "覆盖当前 pilot 完全未测试的焊接/组装/装配路线。"
  },
  {
    key: "deburr_grind_brush_polish",
    label: "Deburr / grinding / brushing / polishing",
    needed: 4,
    reason: "验证打磨、去毛刺、拉丝、抛光等表面/后处理不被误加或漏加。"
  },
  {
    key: "outsourcing_surface_treatment",
    label: "Outsourcing / surface treatment",
    needed: 3,
    reason: "验证外协、喷涂、电镀、氧化等下游处理是否受 PDF 注释驱动。"
  },
  {
    key: "weak_ambiguous_drawings",
    label: "Weak / ambiguous drawings",
    needed: 2,
    reason: "验证弱证据图纸返回 review-required，而不是强行复制 Training 路线。"
  }
] as const;

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function arrayValue<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/u8\s+[a-z0-9_-]+\s+/gi, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"));
}

function countPath(value: unknown, path: string[]) {
  let current = value as any;
  for (const key of path) {
    current = current?.[key];
  }
  return Array.isArray(current) ? current.length : 0;
}

function titleBlockValue(value: unknown, key: string) {
  const current = (value as any)?.titleBlock?.[key];
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function extractionWarnings(row: DbRow) {
  return arrayValue(row.latestExtractionWarnings).length;
}

function extractionSummary(row: DbRow) {
  const extraction = row.latestExtraction;
  return {
    material: titleBlockValue(extraction, "material"),
    finish: titleBlockValue(extraction, "finish"),
    holes: countPath(extraction, ["features", "holes"]),
    threads: countPath(extraction, ["features", "threads"]),
    slots: countPath(extraction, ["features", "slots"]),
    bends: countPath(extraction, ["features", "bends"]),
    surfaces: countPath(extraction, ["features", "surfaces"]),
    warnings: extractionWarnings(row)
  };
}

function hasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function classify(row: DbRow) {
  const route = normalizeText(row.routeSignature);
  const name = normalizeText(`${row.readableId ?? ""} ${row.readableIdWithRevision ?? ""} ${row.itemName ?? ""} ${row.notes ?? ""}`);
  const text = `${route} ${name}`;
  const summary = extractionSummary(row);
  const labels = new Set<string>();

  if (hasAny(text, [/激光/, /折弯/]) || (hasAny(text, [/激光/]) && summary.bends > 0)) {
    labels.add("laser_bending_baseline");
  }
  if (
    summary.holes >= 3 ||
    summary.slots > 0 ||
    hasAny(text, [/沉孔/, /腰孔/, /长圆孔/, /槽/, /开孔/, /冲孔/])
  ) {
    labels.add("hole_slot_countersink");
  }
  if (
    summary.threads > 0 ||
    hasAny(text, [/攻丝/, /钻孔/, /钻/, /机加工/, /加工中心/, /数控加工/, /cnc/, /铣/, /车/, /镗/, /铰/])
  ) {
    labels.add("tapping_drilling_machining");
  }
  if (hasAny(text, [/焊/, /焊接/, /组焊/, /碰焊/, /氩弧/, /点焊/, /装配/, /铆/])) {
    labels.add("welding_fabrication");
  }
  if (hasAny(text, [/打磨/, /去毛刺/, /毛刺/, /拉丝/, /抛光/, /砂光/, /喷砂/, /磨/]) || summary.surfaces > 0) {
    labels.add("deburr_grind_brush_polish");
  }
  if (hasAny(text, [/外协/, /表面处理/, /喷涂/, /喷塑/, /喷漆/, /烤漆/, /电镀/, /镀锌/, /氧化/, /发黑/, /热处理/, /钝化/])) {
    labels.add("outsourcing_surface_treatment");
  }
  if (
    !row.latestExtractionId ||
    summary.warnings > 0 ||
    (summary.holes + summary.threads + summary.slots + summary.bends + summary.surfaces <= 1 && numberValue(row.operationCount) >= 3)
  ) {
    labels.add("weak_ambiguous_drawings");
  }

  return Array.from(labels);
}

function routeComplexityScore(candidate: Candidate) {
  const route = normalizeText(candidate.routeSignature);
  let score = candidate.operationCount * 4;
  if (candidate.latestExtractionId) score += 10;
  if (candidate.extractionSummary.material) score += 4;
  if (candidate.extractionSummary.finish) score += 4;
  if (candidate.extractionSummary.holes > 0) score += Math.min(10, candidate.extractionSummary.holes * 2);
  if (candidate.extractionSummary.threads > 0) score += 8;
  if (candidate.extractionSummary.slots > 0) score += 6;
  if (candidate.extractionSummary.bends > 0) score += 4;
  if (candidate.extractionSummary.warnings > 0) score -= 3;
  if (/焊|攻丝|钻|机加工|打磨|拉丝|抛光|外协|表面处理|喷涂|电镀|氧化/.test(route)) score += 15;
  return score;
}

function reasonForBucket(bucketKey: string, candidate: Candidate) {
  const route = candidate.routeSignature ?? "(no route signature)";
  const summary = candidate.extractionSummary;
  switch (bucketKey) {
    case "laser_bending_baseline":
      return `PDF-backed Active route contains laser/bending baseline (${route}); use as repeatability variant.`;
    case "hole_slot_countersink":
      return `PDF/route indicates hole/slot coverage (holes=${summary.holes}, slots=${summary.slots}; ${route}).`;
    case "tapping_drilling_machining":
      return `Truth route or extraction indicates tapping/drilling/machining follow-up (threads=${summary.threads}; ${route}).`;
    case "welding_fabrication":
      return `Truth route includes welding/fabrication/assembly coverage (${route}).`;
    case "deburr_grind_brush_polish":
      return `Truth route or PDF finish evidence covers deburr/grinding/brushing/polishing (surfaces=${summary.surfaces}, finish=${summary.finish ?? "n/a"}; ${route}).`;
    case "outsourcing_surface_treatment":
      return `Truth route or finish notes cover outsourcing/surface treatment (${summary.finish ?? "n/a"}; ${route}).`;
    case "weak_ambiguous_drawings":
      return `Candidate is useful for weak/ambiguous evidence gate (latestExtraction=${candidate.latestExtractionId ?? "none"}, warnings=${summary.warnings}, featureCount=${summary.holes + summary.threads + summary.slots + summary.bends + summary.surfaces}).`;
    default:
      return route;
  }
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = findRoot(scriptDir);
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
const outputJsonPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-stage4-evaluation-holdout-candidates-20260820.json"
);
const outputMarkdownPath = resolve(
  root,
  "llm/tasks/ai-routing-stage4-evaluation-holdout-candidates-20260820.md"
);

try {
  const result = await pool.query<DbRow>(
    `
      WITH pdf_docs AS (
        SELECT
          d."sourceDocumentId" AS "itemId",
          COUNT(*)::int AS "pdfDocumentCount",
          jsonb_agg(
            jsonb_build_object(
              'id', d."id",
              'name', d."name",
              'path', d."path",
              'size', d."size"
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
        INNER JOIN "methodOperation" mo
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
          e."status"::text AS "latestExtractionStatus",
          e."promptVersion" AS "latestExtractionPromptVersion",
          e."completedAt"::text AS "latestExtractionCompletedAt",
          e."warnings" AS "latestExtractionWarnings",
          e."extraction" AS "latestExtraction"
        FROM "aiDrawingExtraction" e
        WHERE e."companyId" = $1
          AND e."status" = 'Succeeded'::"aiDrawingExtractionStatus"
          AND jsonb_typeof(e."extraction") = 'object'
        ORDER BY e."itemId", e."completedAt" DESC NULLS LAST, e."updatedAt" DESC NULLS LAST, e."createdAt" DESC
      )
      SELECT
        item."id" AS "itemId",
        item."readableId" AS "readableId",
        item."readableIdWithRevision" AS "readableIdWithRevision",
        item."name" AS "itemName",
        item."notes" AS "notes",
        pdf_docs."pdfDocumentCount",
        pdf_docs."pdfDocuments",
        active_route."activeMethodCount",
        active_route."activeMethodIds",
        active_route."operationCount",
        active_route."routeSignature",
        active_route."operations",
        sample_roles."sampleRoles",
        sample_roles."sampleStatuses",
        sample_roles."sampleCount",
        draft_stats."draftCount",
        draft_stats."acceptedDraftCount",
        draft_stats."activeAiDraftCount",
        latest_extraction."latestExtractionId",
        latest_extraction."latestExtractionStatus",
        latest_extraction."latestExtractionPromptVersion",
        latest_extraction."latestExtractionCompletedAt",
        latest_extraction."latestExtractionWarnings",
        latest_extraction."latestExtraction"
      FROM "item" item
      INNER JOIN pdf_docs ON pdf_docs."itemId" = item."id"
      INNER JOIN active_route ON active_route."itemId" = item."id"
      LEFT JOIN sample_roles ON sample_roles."itemId" = item."id"
      LEFT JOIN draft_stats ON draft_stats."itemId" = item."id"
      LEFT JOIN latest_extraction ON latest_extraction."itemId" = item."id"
      WHERE item."companyId" = $1
        AND COALESCE(item."readableId", '') <> ALL($2::text[])
        AND COALESCE(item."readableIdWithRevision", '') <> ALL($2::text[])
      ORDER BY item."readableId" NULLS LAST, item."readableIdWithRevision" NULLS LAST
    `,
    [companyId, Array.from(currentSecondBatch)]
  );

  const rawCandidates: Candidate[] = result.rows.map((row) => {
    const sampleRoles = arrayValue<string>(row.sampleRoles);
    const sampleStatuses = arrayValue<string>(row.sampleStatuses);
    const activeMethodIds = arrayValue<string>(row.activeMethodIds);
    const operations = arrayValue<Operation>(row.operations);
    const pdfDocuments = arrayValue<PdfDocument>(row.pdfDocuments);
    const summary = extractionSummary(row);
    const labels = classify(row);
    const candidate: Candidate = {
      rank: null,
      bucket: null,
      readableId: row.readableId ?? row.readableIdWithRevision ?? row.itemId,
      readableIdWithRevision: row.readableIdWithRevision,
      itemId: row.itemId,
      itemName: row.itemName,
      reason: "",
      pdfDocumentCount: numberValue(row.pdfDocumentCount),
      pdfDocuments,
      activeMethodIds,
      operationCount: numberValue(row.operationCount),
      routeSignature: row.routeSignature,
      operations,
      sampleRoles,
      sampleStatuses,
      sampleCount: numberValue(row.sampleCount),
      draftCount: numberValue(row.draftCount),
      acceptedDraftCount: numberValue(row.acceptedDraftCount),
      activeAiDraftCount: numberValue(row.activeAiDraftCount),
      latestExtractionId: row.latestExtractionId,
      latestExtractionStatus: row.latestExtractionStatus,
      latestExtractionPromptVersion: row.latestExtractionPromptVersion,
      latestExtractionCompletedAt: row.latestExtractionCompletedAt,
      extractionSummary: summary,
      labels,
      selectionScore: 0,
      guardrails: []
    };
    candidate.selectionScore = routeComplexityScore(candidate);
    if (candidate.sampleRoles.includes("Training")) candidate.guardrails.push("exclude: existing Training sample");
    if (candidate.sampleRoles.includes("Evaluation")) candidate.guardrails.push("note: already Evaluation; can be folded into expanded holdout run without role write");
    if (candidate.activeMethodIds.length !== 1) candidate.guardrails.push("review: multiple active methods");
    if (candidate.operationCount === 0) candidate.guardrails.push("exclude: no active truth operations");
    if (candidate.activeAiDraftCount > 0) candidate.guardrails.push("exclude: already AI-materialized active route");
    if (candidate.draftCount > 0) candidate.guardrails.push("review: existing AI draft");
    if (candidate.pdfDocumentCount === 0) candidate.guardrails.push("exclude: no active Part PDF");
    return candidate;
  });

  const eligible = rawCandidates
    .filter((candidate) => !candidate.guardrails.some((guardrail) => guardrail.startsWith("exclude:")))
    .sort((a, b) => b.selectionScore - a.selectionScore || a.readableId.localeCompare(b.readableId));

  const selected: Candidate[] = [];
  const selectedIds = new Set<string>();
  const bucketSummaries = buckets.map((bucket) => {
    const bucketPool = eligible.filter(
      (candidate) => candidate.labels.includes(bucket.key) && !selectedIds.has(candidate.itemId)
    );
    const picked = bucketPool.slice(0, bucket.needed);
    for (const candidate of picked) {
      selectedIds.add(candidate.itemId);
      candidate.bucket = bucket.label;
      candidate.reason = reasonForBucket(bucket.key, candidate);
      selected.push(candidate);
    }
    return {
      key: bucket.key,
      label: bucket.label,
      needed: bucket.needed,
      availableEligible: bucketPool.length,
      selected: picked.length,
      shortfall: Math.max(0, bucket.needed - picked.length)
    };
  });

  if (selected.length < 26) {
    const fill = eligible.filter((candidate) => !selectedIds.has(candidate.itemId)).slice(0, 26 - selected.length);
    for (const candidate of fill) {
      selectedIds.add(candidate.itemId);
      candidate.bucket = "Best remaining PDF-backed truth-route candidate";
      candidate.reason = `Fills remaining 30-holdout count with PDF-backed Active truth route (${candidate.routeSignature ?? "no route signature"}).`;
      selected.push(candidate);
    }
  }

  selected.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  const summary = {
    companyId,
    scannedAt: new Date().toISOString(),
    rawPdfBackedTruthRouteCandidates: rawCandidates.length,
    eligibleCandidateCount: eligible.length,
    selectedCount: selected.length,
    currentSecondBatchExcludedCount: currentSecondBatch.size,
    existingTrainingExcludedCount: rawCandidates.filter((candidate) =>
      candidate.guardrails.some((guardrail) => guardrail.includes("existing Training"))
    ).length,
    alreadyEvaluationCandidateCount: rawCandidates.filter((candidate) =>
      candidate.guardrails.some((guardrail) => guardrail.includes("already Evaluation")) &&
      !candidate.guardrails.some((guardrail) => guardrail.startsWith("exclude:"))
    ).length,
    existingAiMaterializedExcludedCount: rawCandidates.filter((candidate) =>
      candidate.guardrails.some((guardrail) => guardrail.includes("AI-materialized"))
    ).length,
    candidatesWithSucceededExtraction: eligible.filter((candidate) => candidate.latestExtractionId).length,
    candidatesWithoutSucceededExtraction: eligible.filter((candidate) => !candidate.latestExtractionId).length,
    bucketSummaries,
    selectedReadableIds: selected.map((candidate) => candidate.readableId),
    writesPerformed: false,
    databaseMutationsPerformed: false
  };

  const output = {
    summary,
    selected,
    eligiblePoolPreview: eligible.slice(0, 80).map((candidate) => ({
      readableId: candidate.readableId,
      itemName: candidate.itemName,
      labels: candidate.labels,
      operationCount: candidate.operationCount,
      routeSignature: candidate.routeSignature,
      pdfDocumentCount: candidate.pdfDocumentCount,
      latestExtractionId: candidate.latestExtractionId,
      extractionSummary: candidate.extractionSummary,
      selectionScore: candidate.selectionScore,
      guardrails: candidate.guardrails
    })),
    excludedPreview: rawCandidates
      .filter((candidate) => candidate.guardrails.some((guardrail) => guardrail.startsWith("exclude:")))
      .slice(0, 80)
      .map((candidate) => ({
        readableId: candidate.readableId,
        itemName: candidate.itemName,
        routeSignature: candidate.routeSignature,
        guardrails: candidate.guardrails,
        sampleRoles: candidate.sampleRoles,
        activeAiDraftCount: candidate.activeAiDraftCount
      }))
  };

  const bucketRows = buckets
    .map((bucket) => {
      const picked = selected.filter((candidate) => candidate.bucket === bucket.label);
      const ids = picked.map((candidate) => candidate.readableId).join(", ") || "短缺";
      const bucketSummary = bucketSummaries.find((summary) => summary.key === bucket.key);
      return `| ${bucket.label} | ${bucket.needed} | ${picked.length} | ${bucketSummary?.availableEligible ?? 0} | ${ids} |`;
    })
    .join("\n");

  const selectedRows = selected
    .map((candidate) => {
      const extraction = candidate.latestExtractionId
        ? `${candidate.latestExtractionId} (${candidate.latestExtractionPromptVersion ?? "unknown"})`
        : "待抽取";
      return `| ${candidate.rank} | ${candidate.readableId} | ${candidate.bucket} | ${candidate.operationCount} | ${candidate.routeSignature ?? ""} | ${candidate.pdfDocumentCount} | ${extraction} | ${candidate.reason.replace(/\|/g, "/")} |`;
    })
    .join("\n");

  const markdown = `# AI Routing Stage 4 Evaluation Holdout Candidates (2026-08-20)\n\nScope: read-only discovery of existing PDF-backed Parts with Active truth routes. No PDFs were imported, no dataset roles changed, no extraction jobs queued, and no routing rows written.\n\n## Summary\n\n- Raw PDF-backed truth-route candidates: ${summary.rawPdfBackedTruthRouteCandidates}\n- Eligible candidates after excluding current second-batch, Training samples, and active AI-materialized routes: ${summary.eligibleCandidateCount}\n- Selected candidates: ${summary.selectedCount}\n- Eligible candidates with existing succeeded extraction: ${summary.candidatesWithSucceededExtraction}\n- Eligible candidates without succeeded extraction: ${summary.candidatesWithoutSucceededExtraction}\n\n## Bucket Coverage\n\n| Bucket | Needed | Selected | Eligible Available | Candidate IDs |\n|---|---:|---:|---:|---|\n${bucketRows}\n\n## Proposed 26 Candidates\n\n| Rank | Part | Bucket | Ops | Active Truth Route | PDFs | Latest Extraction | Reason |\n|---:|---|---|---:|---|---:|---|---|\n${selectedRows}\n\n## Guardrails Before Use\n\n1. Write selected rows as \`Evaluation\` only, never \`Training\`, if the user approves the final list.\n2. Exclude these Evaluation rows from retrieval/generation input.\n3. Run v2 drawing extraction for candidates without a succeeded extraction before PDF-only draft scoring.\n4. Persist an evaluation run before any accepted-draft materialization.\n5. Keep work-center assignment disabled until active \`workCenterProcess\` capability evidence exists for the route process set.\n\nEvidence JSON: \`${outputJsonPath}\`.\n`;

  writeFileSync(outputJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  writeFileSync(outputMarkdownPath, markdown, "utf8");
  console.log(
    JSON.stringify(
      {
        summary,
        selected: selected.map((candidate) => ({
          rank: candidate.rank,
          readableId: candidate.readableId,
          bucket: candidate.bucket,
          operationCount: candidate.operationCount,
          routeSignature: candidate.routeSignature,
          latestExtractionId: candidate.latestExtractionId
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