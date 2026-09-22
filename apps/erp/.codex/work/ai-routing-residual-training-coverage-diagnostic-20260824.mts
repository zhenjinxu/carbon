import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type SmokeOperationRow = {
  position: number;
  expectedProcessId?: string | null;
  expectedProcessName?: string | null;
  predictedProcessId?: string | null;
  predictedProcessName?: string | null;
};

type SmokeResult = {
  readableId: string;
  targetFeatureTags?: string[];
  warnings?: string[];
  topReferences?: Array<{ sampleId: string; readableId?: string | null; score?: number; matchedDrawingEvidenceCount?: number }>;
  comparison: {
    byPosition: SmokeOperationRow[];
  };
};

type SmokeSummary = {
  companyId: string;
  holdoutCount: number;
  trainingSampleCount: number;
  totalEvaluationLeaks: number;
  totalWorkCenterAssignments: number;
  totalUnsupportedWorkCenterAssignments: number;
  totalMissingProcessIds: number;
  invalidProcessIds: string[];
  results: SmokeResult[];
};

type QualityRow = {
  readableId: string;
  normalizedExactSequenceMatch: boolean;
  actualOperationCount: number;
  suggestedOperationCount: number;
  operationCountDelta: number;
  warningCount: number;
};

type QualitySummary = {
  normalizedMismatches: string[];
  normalizedRows: QualityRow[];
};

type OperationSnapshot = {
  order: number;
  processId: string | null;
  processName: string | null;
  description: string | null;
};

type TrainingRoute = {
  sampleId: string;
  readableId: string | null;
  materialTags: string[];
  featureTags: string[];
  processTags: string[];
  operations: OperationSnapshot[];
  families: string[];
  signature: string;
  nonIssueSignature: string;
};

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
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function operationFromSnapshot(value: unknown): OperationSnapshot {
  const row = objectValue(value);
  return {
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId),
    processName: stringValue(row.processName),
    description: stringValue(row.description)
  };
}

function normalizeProcessText(value: string | null | undefined) {
  return (value ?? "").replace(/^U8\s+[A-Z0-9]+\s+/i, "").replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"));
}

function processFamily(value: string | null | undefined) {
  const text = normalizeProcessText(value).toLowerCase();
  if (!text) return "unknown";
  if (/领料|issue|material/.test(text)) return "issue";
  if (/激光|laser/.test(text)) return "laser";
  if (/折弯|bend/.test(text)) return "bend";
  if (/片锯|锯床|锯|saw/.test(text)) return "saw";
  if (/车床|车削|lathe|turn/.test(text)) return "turn";
  if (/加工中心|立式加工|数控加工|cnc|vmc|machining center/.test(text)) return "machining-center";
  if (/铣|mill/.test(text)) return "mill";
  if (/钻|drill/.test(text)) return "drill";
  if (/攻丝| tapping|tap/.test(text)) return "tap";
  if (/氧化|oxid/.test(text)) return "oxidation";
  if (/焊|weld/.test(text)) return "weld";
  if (/打磨|抛光|grind|polish/.test(text)) return "finish";
  return "other";
}

function rowFamilies(rows: Array<{ processName?: string | null; expectedProcessName?: string | null; predictedProcessName?: string | null }>, key: "processName" | "expectedProcessName" | "predictedProcessName") {
  return rows.map((row) => processFamily(row[key]));
}

function signature(families: string[]) {
  return families.join(" -> ");
}

function nonIssue(families: string[]) {
  return families.filter((family) => family !== "issue");
}

function multiset(values: string[]) {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return map;
}

function covers(candidate: string[], needed: string[]) {
  const have = multiset(candidate);
  for (const [family, count] of multiset(needed)) {
    if ((have.get(family) ?? 0) < count) return false;
  }
  return true;
}

function diffFamilies(actual: string[], suggested: string[]) {
  const actualSet = multiset(actual);
  const suggestedSet = multiset(suggested);
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [family, count] of actualSet) {
    const delta = count - (suggestedSet.get(family) ?? 0);
    for (let index = 0; index < delta; index += 1) missing.push(family);
  }
  for (const [family, count] of suggestedSet) {
    const delta = count - (actualSet.get(family) ?? 0);
    for (let index = 0; index < delta; index += 1) extra.push(family);
  }
  return { missing, extra };
}

function matchesReference(route: TrainingRoute, referenceId: string, companyId: string) {
  const last = referenceId.split(":").at(-1) ?? referenceId;
  return (
    route.sampleId === referenceId ||
    route.sampleId === last ||
    route.makeMethodId === referenceId ||
    route.makeMethodId === last ||
    (route.makeMethodId ? `${companyId}:${route.makeMethodId}` === referenceId : false)
  );
}

function classify(input: {
  warningCount: number;
  actualFamilies: string[];
  suggestedFamilies: string[];
  exactTrainingMatches: TrainingRoute[];
  nonIssueExactTrainingMatches: TrainingRoute[];
  coveringTrainingMatches: TrainingRoute[];
  topReferenceExactFamilyCount: number;
  targetFeatureTags: string[];
}) {
  const actualNonIssue = nonIssue(input.actualFamilies);
  const suggestedNonIssue = nonIssue(input.suggestedFamilies);
  const familyDiff = diffFamilies(actualNonIssue, suggestedNonIssue);
  if (input.suggestedFamilies.length === 0 && input.coveringTrainingMatches.length === 0) {
    return {
      category: "training_coverage_gap",
      reason: "Current generator returned empty and no approved Training route covers all non-issue actual operation families."
    };
  }
  if (input.exactTrainingMatches.length > 0 && input.topReferenceExactFamilyCount === 0) {
    return {
      category: "retrieval_ranking_gap",
      reason: "Approved Training has an exact route-family signature, but the current top references do not surface it."
    };
  }
  if (input.nonIssueExactTrainingMatches.length > 0 && input.topReferenceExactFamilyCount === 0) {
    return {
      category: "retrieval_ranking_gap",
      reason: "Approved Training has the exact non-issue route-family signature, but it is not in the current top references."
    };
  }
  if (familyDiff.missing.length > 0 && input.coveringTrainingMatches.length > 0) {
    return {
      category: "composition_gap",
      reason: `Training covers the missing families (${familyDiff.missing.join(", ")}), but safe composition still needs explicit per-operation evidence.`
    };
  }
  if (familyDiff.extra.length > 0 || familyDiff.missing.length > 0) {
    return {
      category: "extraction_or_family_ambiguity",
      reason: `Predicted family set differs from actual. Missing: ${familyDiff.missing.join(", ") || "none"}; extra: ${familyDiff.extra.join(", ") || "none"}.`
    };
  }
  return {
    category: "sequence_or_semantic_gap",
    reason: "Operation family counts match, but order or process semantics still differ."
  };
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

const smokePath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-evaluation-20260823.json");
const qualityPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-quality-summary-after-turned-class-mapping-reverted-20260824.json");
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-residual-training-coverage-diagnostic-20260824.json");
const smoke = JSON.parse(readFileSync(smokePath, "utf8")) as SmokeSummary;
const quality = JSON.parse(readFileSync(qualityPath, "utf8")) as QualitySummary;
const qualityByReadable = new Map(quality.normalizedRows.map((row) => [row.readableId, row]));
const residualIds = quality.normalizedMismatches;

const client = await pool.connect();
try {
  const rows = (await client.query(`
    SELECT "id", "makeMethodId", "itemSnapshot", "operationSnapshot", "materialTags", "featureTags", "processTags"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
      AND "status" = 'Approved'::"aiRoutingSampleStatus"
      AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
    ORDER BY "updatedAt" DESC
  `, [smoke.companyId])).rows;

  const trainingRoutes: TrainingRoute[] = rows.map((row: Record<string, unknown>) => {
    const itemSnapshot = objectValue(row.itemSnapshot);
    const operations = Array.isArray(row.operationSnapshot) ? row.operationSnapshot.map(operationFromSnapshot).sort((a, b) => a.order - b.order) : [];
    const families = operations.map((operation) => processFamily(operation.processName ?? operation.description));
    return {
      sampleId: String(row.id),
      readableId: stringValue(itemSnapshot.readableIdWithRevision) ?? stringValue(itemSnapshot.readableId),
      materialTags: stringArray(row.materialTags),
      featureTags: stringArray(row.featureTags),
      processTags: stringArray(row.processTags),
      operations,
      families,
      signature: signature(families),
      nonIssueSignature: signature(nonIssue(families))
    };
  });

  const smokeByReadable = new Map(smoke.results.map((result) => [result.readableId, result]));
  const residuals = residualIds.map((readableId) => {
    const result = smokeByReadable.get(readableId);
    if (!result) throw new Error(`Missing smoke result for ${readableId}`);
    const expectedRows = result.comparison.byPosition.filter((row) => row.expectedProcessId || row.expectedProcessName);
    const predictedRows = result.comparison.byPosition.filter((row) => row.predictedProcessId || row.predictedProcessName);
    const actualFamilies = rowFamilies(expectedRows, "expectedProcessName");
    const suggestedFamilies = rowFamilies(predictedRows, "predictedProcessName");
    const actualSignature = signature(actualFamilies);
    const actualNonIssueSignature = signature(nonIssue(actualFamilies));
    const exactTrainingMatches = trainingRoutes.filter((route) => route.signature === actualSignature);
    const nonIssueExactTrainingMatches = trainingRoutes.filter((route) => route.nonIssueSignature === actualNonIssueSignature);
    const coveringTrainingMatches = trainingRoutes.filter((route) => covers(nonIssue(route.families), nonIssue(actualFamilies)));
    const topReferenceIds = new Set((result.topReferences ?? []).map((reference) => reference.sampleId.split(":").at(-1) ?? reference.sampleId));
    const topReferenceExactFamilyCount = trainingRoutes.filter((route) => topReferenceIds.has(route.sampleId) && route.signature === actualSignature).length;
    const topReferenceNonIssueExactFamilyCount = trainingRoutes.filter((route) => topReferenceIds.has(route.sampleId) && route.nonIssueSignature === actualNonIssueSignature).length;
    const classification = classify({
      warningCount: result.warnings?.length ?? 0,
      actualFamilies,
      suggestedFamilies,
      exactTrainingMatches,
      nonIssueExactTrainingMatches,
      coveringTrainingMatches,
      topReferenceExactFamilyCount: topReferenceExactFamilyCount + topReferenceNonIssueExactFamilyCount,
      targetFeatureTags: result.targetFeatureTags ?? []
    });
    return {
      readableId,
      quality: qualityByReadable.get(readableId),
      targetFeatureTags: result.targetFeatureTags ?? [],
      warnings: result.warnings ?? [],
      actualRoute: expectedRows.map((row) => row.expectedProcessName ?? row.expectedProcessId ?? "Unnamed"),
      suggestedRoute: predictedRows.map((row) => row.predictedProcessName ?? row.predictedProcessId ?? "Unnamed"),
      actualFamilies,
      suggestedFamilies,
      familyDiff: diffFamilies(nonIssue(actualFamilies), nonIssue(suggestedFamilies)),
      actualSignature,
      suggestedSignature: signature(suggestedFamilies),
      exactTrainingMatches: exactTrainingMatches.slice(0, 10).map((route) => ({ readableId: route.readableId, signature: route.signature, operations: route.operations.map((operation) => operation.processName) })),
      nonIssueExactTrainingMatches: nonIssueExactTrainingMatches.slice(0, 10).map((route) => ({ readableId: route.readableId, signature: route.signature, operations: route.operations.map((operation) => operation.processName) })),
      coveringTrainingMatches: coveringTrainingMatches.slice(0, 10).map((route) => ({ readableId: route.readableId, signature: route.signature, operations: route.operations.map((operation) => operation.processName) })),
      topReferences: (result.topReferences ?? []).map((reference) => {
        const route = trainingRoutes.find((candidate) => matchesReference(candidate, reference.sampleId, smoke.companyId));
        return {
          readableId: reference.readableId ?? route?.readableId ?? null,
          score: reference.score ?? null,
          matchedDrawingEvidenceCount: reference.matchedDrawingEvidenceCount ?? null,
          signature: route?.signature ?? null,
          families: route?.families ?? []
        };
      }),
      classification
    };
  });

  const categoryCounts = residuals.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification.category] = (acc[row.classification.category] ?? 0) + 1;
    return acc;
  }, {});
  const output = {
    inspectedAt: new Date().toISOString(),
    companyId: smoke.companyId,
    holdoutCount: smoke.holdoutCount,
    trainingSampleCount: trainingRoutes.length,
    residualCount: residuals.length,
    categoryCounts,
    safety: {
      totalEvaluationLeaks: smoke.totalEvaluationLeaks,
      totalWorkCenterAssignments: smoke.totalWorkCenterAssignments,
      totalUnsupportedWorkCenterAssignments: smoke.totalUnsupportedWorkCenterAssignments,
      totalMissingProcessIds: smoke.totalMissingProcessIds,
      invalidProcessIds: smoke.invalidProcessIds
    },
    decisionSupport: {
      codeChangeCandidates: residuals.filter((row) => ["retrieval_ranking_gap", "composition_gap", "sequence_or_semantic_gap"].includes(row.classification.category)).map((row) => row.readableId),
      dataGovernanceCandidates: residuals.filter((row) => ["training_coverage_gap", "extraction_or_family_ambiguity"].includes(row.classification.category)).map((row) => row.readableId),
      materializationGate: "closed"
    },
    residuals
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    inspectedAt: output.inspectedAt,
    residualCount: output.residualCount,
    categoryCounts: output.categoryCounts,
    decisionSupport: output.decisionSupport,
    outputPath
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}
