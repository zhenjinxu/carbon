import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  rankSimilarRoutingSamples,
  routingKnowledgeTags,
  type AiRoutingOperation,
  type AiRoutingSample
} from "../../app/modules/items/ai-routing.ts";

type JsonRecord = Record<string, unknown>;

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
  topReferences?: Array<{
    sampleId: string;
    readableId?: string | null;
    score?: number;
    matchedDrawingEvidenceCount?: number;
  }>;
  comparison: { byPosition: SmokeOperationRow[] };
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

type OperationRoute = {
  names: string[];
  families: string[];
  signature: string;
  nonIssueSignature: string;
};

type TrainingRoute = {
  sample: AiRoutingSample;
  readableId: string | null;
  makeMethodId: string | null;
  route: OperationRoute;
};

const targetReadableIds = [
  "1927930206",
  "192769010102",
  "192472540409",
  "192759010202"
];

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

function readJsonIfExists<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function objectValue(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function operationFromSnapshot(value: unknown): AiRoutingOperation {
  const row = objectValue(value);
  return {
    id: stringValue(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId),
    processName: stringValue(row.processName),
    workCenterId: stringValue(row.workCenterId),
    workCenterName: stringValue(row.workCenterName),
    operationType: stringValue(row.operationType),
    operationOrder: stringValue(row.operationOrder),
    description: stringValue(row.description),
    setupTime: Number(row.setupTime ?? 0),
    setupUnit: stringValue(row.setupUnit),
    laborTime: Number(row.laborTime ?? 0),
    laborUnit: stringValue(row.laborUnit),
    machineTime: Number(row.machineTime ?? 0),
    machineUnit: stringValue(row.machineUnit),
    customFields: row.customFields
  };
}

function sampleFromRow(row: JsonRecord): AiRoutingSample {
  const itemSnapshot = objectValue(row.itemSnapshot);
  const operationSnapshot = Array.isArray(row.operationSnapshot) ? row.operationSnapshot : [];
  return {
    id: String(row.id),
    itemId: String(row.itemId),
    readableId: stringValue(itemSnapshot.readableIdWithRevision) ?? stringValue(itemSnapshot.readableId),
    name: stringValue(itemSnapshot.name),
    makeMethodId: stringValue(row.makeMethodId),
    documentIds: stringArray(row.drawingDocumentIds),
    operations: operationSnapshot.map(operationFromSnapshot),
    materialTags: stringArray(row.materialTags),
    featureTags: stringArray(row.featureTags),
    processTags: stringArray(row.processTags),
    resourceTags: stringArray(row.resourceTags),
    status: row.status === "Approved" ? "Approved" : "Candidate",
    datasetRole: row.datasetRole === "Evaluation" ? "Evaluation" : "Training"
  };
}

function normalizeProcessText(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^U8\s+[A-Z0-9]+\s+/i, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"));
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
  if (/攻丝|tapping|tap/.test(text)) return "tap";
  if (/氧化|阳极|anodiz|oxid/.test(text)) return "oxidation";
  if (/焊|weld/.test(text)) return "weld";
  if (/打磨|抛光|grind|polish/.test(text)) return "finish";
  return "other";
}

function sortedOperations(operations: AiRoutingOperation[]) {
  return operations.slice().sort((a, b) => a.order - b.order);
}

function operationNames(operations: AiRoutingOperation[]) {
  return sortedOperations(operations).map((operation) => operation.processName ?? operation.description ?? operation.processId ?? "Unnamed");
}

function signature(families: string[]) {
  return families.join(" -> ");
}

function nonIssue(families: string[]) {
  return families.filter((family) => family !== "issue");
}

function routeFromOperations(operations: AiRoutingOperation[]): OperationRoute {
  const names = operationNames(operations);
  const families = names.map(processFamily);
  return {
    names,
    families,
    signature: signature(families),
    nonIssueSignature: signature(nonIssue(families))
  };
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

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function evidenceKindCounts(target: { drawingEvidence?: Array<{ kind: string }> }) {
  return countBy((target.drawingEvidence ?? []).map((fact) => fact.kind));
}

function sampleMatchedEvidence(target: { drawingEvidence?: Array<{ kind: string; label?: string | null; text?: string | null; confidence?: number | null }> }, limit = 12) {
  return (target.drawingEvidence ?? [])
    .slice(0, limit)
    .map((fact) => ({ kind: fact.kind, label: fact.label ?? null, text: fact.text ?? null, confidence: fact.confidence ?? null }));
}

function featureSummary(extraction: JsonRecord) {
  const features = objectValue(extraction.features);
  const summarize = (key: string) => {
    const values = Array.isArray(features[key]) ? (features[key] as unknown[]) : [];
    return {
      count: values.length,
      labels: values.slice(0, 8).map((entry) => stringValue(objectValue(entry).label)).filter(Boolean)
    };
  };
  return {
    holes: summarize("holes"),
    threads: summarize("threads"),
    slots: summarize("slots"),
    pockets: summarize("pockets"),
    bends: summarize("bends"),
    welds: summarize("welds"),
    surfaces: summarize("surfaces")
  };
}

function extractionSummary(row: JsonRecord | null, target: ReturnType<typeof aiRoutingTargetEvidenceFromDrawing> | null) {
  if (!row) return null;
  const extraction = objectValue(row.extraction);
  return {
    id: row.id,
    documentId: row.documentId,
    status: row.status,
    promptVersion: row.promptVersion,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    contentHash: row.contentHash,
    pageCount: row.pageCount,
    completedAt: row.completedAt,
    extractionWarnings: row.warnings,
    titleBlock: objectValue(extraction.titleBlock),
    part: objectValue(extraction.part),
    features: featureSummary(extraction),
    targetMaterialTags: target?.materialTags ?? [],
    targetFeatureTags: target?.featureTags ?? [],
    targetProcessHints: target?.processHints ?? [],
    targetDrawingEvidenceKindCounts: target ? evidenceKindCounts(target) : {},
    targetDrawingEvidenceSample: target ? sampleMatchedEvidence(target) : []
  };
}

function compactRoute(route: OperationRoute) {
  return {
    names: route.names,
    families: route.families,
    signature: route.signature,
    nonIssueSignature: route.nonIssueSignature
  };
}

function trainingRouteSummary(route: TrainingRoute) {
  return {
    readableId: route.readableId,
    sampleId: route.sample.id,
    makeMethodId: route.makeMethodId,
    materialTags: route.sample.materialTags,
    featureTags: route.sample.featureTags,
    processTags: route.sample.processTags,
    route: compactRoute(route.route)
  };
}

function classifyDataGovernance(input: {
  readableId: string;
  actualRoute: OperationRoute;
  generatedRoute: OperationRoute;
  extraction: JsonRecord | null;
  target: ReturnType<typeof aiRoutingTargetEvidenceFromDrawing> | null;
  coveringTrainingMatches: TrainingRoute[];
  exactTrainingMatches: TrainingRoute[];
}) {
  const actualNonIssue = nonIssue(input.actualRoute.families);
  const generatedNonIssue = nonIssue(input.generatedRoute.families);
  const familyDiff = diffFamilies(actualNonIssue, generatedNonIssue);
  const hintFamilies = (input.target?.processHints ?? []).map(processFamily);
  const unsupportedMissingFamilies = familyDiff.missing.filter((family) => !hintFamilies.includes(family));
  const extractionObject = objectValue(input.extraction?.extraction);
  const part = objectValue(extractionObject.part);
  const partClass = stringValue(part.class);
  const stockForm = stringValue(part.stockForm);
  const hasCoherentTraining = input.coveringTrainingMatches.length > 0;
  const hasExactTraining = input.exactTrainingMatches.length > 0;
  const laserHintWithoutLaserTruth = (input.target?.processHints ?? []).includes("激光切割") && !actualNonIssue.includes("laser");
  const oxidationTruthWithoutCoherentTraining = actualNonIssue.includes("oxidation") && !hasCoherentTraining;
  const turnedOrBarButSheetLaserTarget = (partClass === "turned" || stockForm === "bar") && (input.target?.featureTags ?? []).includes("板件");
  const categories: string[] = [];
  const reasons: string[] = [];
  const recommendedActions: string[] = [];

  if (!hasCoherentTraining) {
    categories.push("coherent_training_coverage_gap");
    reasons.push("No approved Training route covers all non-issue actual operation families for this target.");
    recommendedActions.push("Do not broaden generation logic; first add or identify a coherent Training route only after source-route review.");
  }
  if (laserHintWithoutLaserTruth || turnedOrBarButSheetLaserTarget || unsupportedMissingFamilies.length > 0) {
    categories.push("extraction_or_source_data_review");
    if (laserHintWithoutLaserTruth) reasons.push("Current target evidence has a laser-cutting hint, but the locked actual route has no laser family.");
    if (turnedOrBarButSheetLaserTarget) reasons.push("Extraction part class or stock form indicates turned/bar while route target tags still include sheet evidence.");
    if (unsupportedMissingFamilies.length > 0) reasons.push(`Missing actual families are not fully supported by current process hints: ${unsupportedMissingFamilies.join(", ")}.`);
    recommendedActions.push("Review the source PDF and extraction evidence before using this row for generation or Training expansion.");
  }
  if (hasExactTraining || hasCoherentTraining) {
    categories.push("training_exists_but_not_authorization");
    reasons.push("Some Training coverage exists, but generation still requires explicit target evidence for each added or replaced family.");
  }
  if (categories.length === 0) {
    categories.push("no_safe_action_from_audit_only");
    reasons.push("The audit does not provide enough evidence for code, data, or Training changes without manual source review.");
  }

  return {
    categories: Array.from(new Set(categories)),
    reasons: Array.from(new Set(reasons)),
    recommendedActions: Array.from(new Set(recommendedActions)),
    safeForRouteGenerationChange: false,
    safeForMaterialization: false,
    requiresHumanSourceReview: true,
    materializationGate: "closed"
  };
}

function matchesReference(route: TrainingRoute, referenceId: string, companyId: string) {
  const last = referenceId.split(":").at(-1) ?? referenceId;
  return (
    route.sample.id === referenceId ||
    route.sample.id === last ||
    route.makeMethodId === referenceId ||
    route.makeMethodId === last ||
    (route.makeMethodId ? `${companyId}:${route.makeMethodId}` === referenceId : false)
  );
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
const residualDiagnosticPath = resolve(root, "apps/erp/.codex/work/ai-routing-residual-training-coverage-diagnostic-20260824.json");
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-data-governance-residual-audit-20260824.json");
const smoke = readJsonIfExists<SmokeSummary>(smokePath);
if (!smoke) throw new Error(`Missing smoke artifact: ${smokePath}`);
const residualDiagnostic = readJsonIfExists<JsonRecord>(residualDiagnosticPath);
const smokeByReadable = new Map(smoke.results.map((result) => [result.readableId, result]));

const client = await pool.connect();
try {
  const companyId = smoke.companyId;
  const itemRows = (await client.query(
    `
      SELECT "id", "readableId", "readableIdWithRevision", "name", "description", "modelUploadId", "updatedAt", "createdAt"
      FROM "item"
      WHERE "companyId" = $1
        AND "readableId" = ANY($2::text[])
      ORDER BY "readableId"
    `,
    [companyId, targetReadableIds]
  )).rows as JsonRecord[];
  const itemsByReadable = new Map(itemRows.map((row) => [String(row.readableId), row]));
  const itemIds = itemRows.map((row) => String(row.id));

  const trainingRows = (await client.query(
    `
      SELECT "id", "itemId", "makeMethodId", "itemSnapshot", "operationSnapshot", "drawingDocumentIds", "materialTags", "featureTags", "processTags", "resourceTags", "status"::text AS "status", "datasetRole"::text AS "datasetRole"
      FROM "aiRoutingSample"
      WHERE "companyId" = $1
        AND "status" = 'Approved'::"aiRoutingSampleStatus"
        AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
      ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `,
    [companyId]
  )).rows as JsonRecord[];
  const trainingSamples = trainingRows.map(sampleFromRow);
  const trainingRoutes: TrainingRoute[] = trainingRows.map((row, index) => {
    const sample = trainingSamples[index];
    return {
      sample,
      readableId: sample.readableId,
      makeMethodId: stringValue(row.makeMethodId),
      route: routeFromOperations(sample.operations)
    };
  });

  const evaluationRows = (await client.query(
    `
      SELECT "id", "itemId", "makeMethodId", "itemSnapshot", "operationSnapshot", "drawingDocumentIds", "materialTags", "featureTags", "processTags", "lockedAt", "createdAt", "updatedAt"
      FROM "aiRoutingSample"
      WHERE "companyId" = $1
        AND "itemId" = ANY($2::text[])
        AND "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole"
        AND "status" = 'Approved'::"aiRoutingSampleStatus"
      ORDER BY "itemId", "lockedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `,
    [companyId, itemIds]
  )).rows as JsonRecord[];
  const evaluationByItem = new Map<string, JsonRecord>();
  for (const row of evaluationRows) {
    const itemId = String(row.itemId);
    if (!evaluationByItem.has(itemId)) evaluationByItem.set(itemId, row);
  }

  const documentRows = (await client.query(
    `
      SELECT "id", "name", "path", "extension", "type"::text AS "type", "sourceDocument"::text AS "sourceDocument", "sourceDocumentId", "active", "size", "createdAt", "updatedAt"
      FROM "document"
      WHERE "companyId" = $1
        AND "sourceDocument" = 'Part'
        AND "sourceDocumentId" = ANY($2::text[])
      ORDER BY "sourceDocumentId", "active" DESC, "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `,
    [companyId, itemIds]
  )).rows as JsonRecord[];
  const documentsByItem = new Map<string, JsonRecord[]>();
  for (const row of documentRows) {
    const itemId = String(row.sourceDocumentId);
    const rows = documentsByItem.get(itemId) ?? [];
    rows.push(row);
    documentsByItem.set(itemId, rows);
  }

  const extractionRows = (await client.query(
    `
      SELECT "id", "itemId", "documentId", "status"::text AS "status", "contentHash", "rendererVersion", "extractorSchemaVersion", "promptVersion", "modelProvider", "modelName", "pageCount", "extraction", "warnings", "errorCategory", "errorCode", "errorMessage", "startedAt", "completedAt", "createdAt", "updatedAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = $1
        AND "itemId" = ANY($2::text[])
      ORDER BY "itemId", ("status" = 'Succeeded'::"aiDrawingExtractionStatus") DESC, "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `,
    [companyId, itemIds]
  )).rows as JsonRecord[];
  const extractionsByItem = new Map<string, JsonRecord[]>();
  for (const row of extractionRows) {
    const itemId = String(row.itemId);
    const rows = extractionsByItem.get(itemId) ?? [];
    rows.push(row);
    extractionsByItem.set(itemId, rows);
  }

  const targets = targetReadableIds.map((readableId) => {
    const item = itemsByReadable.get(readableId);
    if (!item) throw new Error(`Missing item row for ${readableId}`);
    const itemId = String(item.id);
    const latestSucceededExtraction = (extractionsByItem.get(itemId) ?? []).find((row) => row.status === "Succeeded") ?? null;
    const target = latestSucceededExtraction
      ? aiRoutingTargetEvidenceFromDrawing({
          id: String(latestSucceededExtraction.id),
          itemId,
          item: {
            readableId: stringValue(item.readableIdWithRevision) ?? stringValue(item.readableId),
            name: stringValue(item.name),
            description: stringValue(item.description),
          },
          drawingExtraction: latestSucceededExtraction.extraction as never
        })
      : null;
    const evaluation = evaluationByItem.get(itemId) ?? null;
    const actualOperations = Array.isArray(evaluation?.operationSnapshot) ? evaluation.operationSnapshot.map(operationFromSnapshot) : [];
    const actualRoute = routeFromOperations(actualOperations);
    const generatedDraft = target ? generateAiRoutingDraft({ target, samples: trainingSamples }) : null;
    const generatedRoute = generatedDraft ? routeFromOperations(generatedDraft.suggestedOperations) : { names: [], families: [], signature: "", nonIssueSignature: "" };
    const ranked = target ? rankSimilarRoutingSamples({ target, samples: trainingSamples, limit: 20 }) : [];
    const actualNonIssue = nonIssue(actualRoute.families);
    const generatedNonIssue = nonIssue(generatedRoute.families);
    const exactTrainingMatches = trainingRoutes.filter((route) => route.route.signature === actualRoute.signature);
    const nonIssueExactTrainingMatches = trainingRoutes.filter((route) => route.route.nonIssueSignature === actualRoute.nonIssueSignature);
    const coveringTrainingMatches = trainingRoutes.filter((route) => covers(nonIssue(route.route.families), actualNonIssue));
    const familyDiff = diffFamilies(actualNonIssue, generatedNonIssue);
    const smokeResult = smokeByReadable.get(readableId) ?? null;
    const smokeSuggestedRows = smokeResult?.comparison.byPosition.filter((row) => row.predictedProcessId || row.predictedProcessName) ?? [];
    const smokeActualRows = smokeResult?.comparison.byPosition.filter((row) => row.expectedProcessId || row.expectedProcessName) ?? [];
    const smokeSuggestedRoute = {
      names: smokeSuggestedRows.map((row) => row.predictedProcessName ?? row.predictedProcessId ?? "Unnamed"),
      families: smokeSuggestedRows.map((row) => processFamily(row.predictedProcessName ?? row.predictedProcessId)),
      signature: signature(smokeSuggestedRows.map((row) => processFamily(row.predictedProcessName ?? row.predictedProcessId))),
      nonIssueSignature: signature(nonIssue(smokeSuggestedRows.map((row) => processFamily(row.predictedProcessName ?? row.predictedProcessId))))
    };
    const smokeActualRoute = {
      names: smokeActualRows.map((row) => row.expectedProcessName ?? row.expectedProcessId ?? "Unnamed"),
      families: smokeActualRows.map((row) => processFamily(row.expectedProcessName ?? row.expectedProcessId)),
      signature: signature(smokeActualRows.map((row) => processFamily(row.expectedProcessName ?? row.expectedProcessId))),
      nonIssueSignature: signature(nonIssue(smokeActualRows.map((row) => processFamily(row.expectedProcessName ?? row.expectedProcessId))))
    };
    const classification = classifyDataGovernance({
      readableId,
      actualRoute,
      generatedRoute,
      extraction: latestSucceededExtraction,
      target,
      coveringTrainingMatches,
      exactTrainingMatches
    });
    const extractionStatusCounts = countBy((extractionsByItem.get(itemId) ?? []).map((row) => String(row.status)));
    const promptVersions = Array.from(new Set((extractionsByItem.get(itemId) ?? []).map((row) => stringValue(row.promptVersion) ?? "none")));
    const activePdfDocuments = (documentsByItem.get(itemId) ?? []).filter((document) => document.active !== false && document.type === "PDF" && String(document.extension ?? "").toLowerCase() === "pdf");
    const topReferenceRoutes = (smokeResult?.topReferences ?? []).map((reference) => {
      const route = trainingRoutes.find((candidate) => matchesReference(candidate, reference.sampleId, companyId));
      return {
        sampleId: reference.sampleId,
        readableId: reference.readableId ?? route?.readableId ?? null,
        score: reference.score ?? null,
        matchedDrawingEvidenceCount: reference.matchedDrawingEvidenceCount ?? null,
        route: route ? compactRoute(route.route) : null
      };
    });
    const rankedTrainingReferences = ranked.slice(0, 10).map((candidate) => ({
      readableId: candidate.readableId,
      sampleId: candidate.sample.id,
      makeMethodId: candidate.sample.makeMethodId,
      score: candidate.score,
      matched: candidate.matched,
      matchedDrawingEvidenceCount: candidate.matchedDrawingEvidence.length,
      route: compactRoute(routeFromOperations(candidate.sample.operations)),
      operationProcessTags: sortedOperations(candidate.sample.operations).map((operation) => ({
        name: operation.processName ?? operation.description ?? operation.processId ?? "Unnamed",
        processTags: routingKnowledgeTags({ operations: [operation] }).processTags
      }))
    }));

    return {
      readableId,
      item: {
        id: itemId,
        readableIdWithRevision: item.readableIdWithRevision,
        name: item.name,
        description: item.description,
        modelUploadId: item.modelUploadId,
        updatedAt: item.updatedAt
      },
      sourceAvailability: {
        evaluationSampleId: evaluation?.id ?? null,
        evaluationLockedAt: evaluation?.lockedAt ?? null,
        activePartPdfCount: activePdfDocuments.length,
        partPdfDocuments: activePdfDocuments.map((document) => ({
          id: document.id,
          name: document.name,
          path: document.path,
          size: numberValue(document.size),
          updatedAt: document.updatedAt
        })),
        extractionCount: (extractionsByItem.get(itemId) ?? []).length,
        extractionStatusCounts,
        promptVersions,
        latestSucceededExtractionId: latestSucceededExtraction?.id ?? null,
        latestSucceededPromptVersion: latestSucceededExtraction?.promptVersion ?? null
      },
      extraction: extractionSummary(latestSucceededExtraction, target),
      routes: {
        lockedEvaluationActual: compactRoute(actualRoute),
        currentGenerated: compactRoute(generatedRoute),
        latestSmokeActual: compactRoute(smokeActualRoute),
        latestSmokeSuggested: compactRoute(smokeSuggestedRoute),
        familyDiff,
        warnings: generatedDraft?.warnings ?? smokeResult?.warnings ?? []
      },
      trainingCoverage: {
        exactTrainingMatchCount: exactTrainingMatches.length,
        nonIssueExactTrainingMatchCount: nonIssueExactTrainingMatches.length,
        coveringTrainingMatchCount: coveringTrainingMatches.length,
        exactTrainingMatches: exactTrainingMatches.slice(0, 5).map(trainingRouteSummary),
        nonIssueExactTrainingMatches: nonIssueExactTrainingMatches.slice(0, 5).map(trainingRouteSummary),
        coveringTrainingMatches: coveringTrainingMatches.slice(0, 5).map(trainingRouteSummary),
        familyPresenceCounts: Object.fromEntries(
          Array.from(new Set(actualNonIssue)).map((family) => [
            family,
            trainingRoutes.filter((route) => nonIssue(route.route.families).includes(family)).length
          ])
        )
      },
      retrieval: {
        smokeTopReferences: topReferenceRoutes,
        currentRankedTrainingReferences: rankedTrainingReferences
      },
      decision: classification
    };
  });

  const decisionCategoryCounts = targets.reduce<Record<string, number>>((acc, target) => {
    for (const category of target.decision.categories) {
      acc[category] = (acc[category] ?? 0) + 1;
    }
    return acc;
  }, {});
  const output = {
    auditType: "AI Routing data-governance residual evidence audit",
    inspectedAt: new Date().toISOString(),
    companyId,
    targetReadableIds,
    baseline: {
      holdoutCount: smoke.holdoutCount,
      trainingSampleCount: smoke.trainingSampleCount,
      safety: {
        totalEvaluationLeaks: smoke.totalEvaluationLeaks,
        totalWorkCenterAssignments: smoke.totalWorkCenterAssignments,
        totalUnsupportedWorkCenterAssignments: smoke.totalUnsupportedWorkCenterAssignments,
        totalMissingProcessIds: smoke.totalMissingProcessIds,
        invalidProcessIds: smoke.invalidProcessIds
      },
      residualDiagnosticDecisionSupport: objectValue(residualDiagnostic?.decisionSupport)
    },
    summary: {
      auditedTargetCount: targets.length,
      decisionCategoryCounts,
      routeGenerationChangeRecommended: false,
      sampleRoleWriteRecommended: false,
      materializationGate: "closed",
      nextGate: "manual source/PDF review plus coherent Training coverage planning before any route-generation change"
    },
    targets
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    inspectedAt: output.inspectedAt,
    auditedTargetCount: output.summary.auditedTargetCount,
    decisionCategoryCounts: output.summary.decisionCategoryCounts,
    materializationGate: output.summary.materializationGate,
    outputPath
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}