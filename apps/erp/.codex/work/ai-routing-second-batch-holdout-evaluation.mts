import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  type AiRoutingOperation,
  type AiRoutingSample
} from "../../app/modules/items/ai-routing.ts";

function loadEnvFile(path: string, override = false) {
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!override && process.env[key] !== undefined) continue;
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function operationFromSnapshot(value: unknown): AiRoutingOperation {
  const row = objectValue(value);
  const process = objectValue(row.process);
  const workCenter = objectValue(row.workCenter);
  return {
    id: stringValue(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId) ?? stringValue(process.id),
    processName: stringValue(row.processName) ?? stringValue(process.name),
    workCenterId: stringValue(row.workCenterId) ?? stringValue(workCenter.id),
    workCenterName:
      stringValue(row.workCenterName) ?? stringValue(workCenter.name),
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

function operationFromJobRow(row: Record<string, unknown>): AiRoutingOperation {
  const process = objectValue(row.process);
  const workCenter = objectValue(row.workCenter);
  return {
    id: stringValue(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId) ?? stringValue(process.id),
    processName: stringValue(process.name) ?? stringValue(row.description),
    workCenterId: stringValue(row.workCenterId) ?? stringValue(workCenter.id),
    workCenterName: stringValue(workCenter.name),
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

function sampleFromRow(row: Record<string, unknown>): AiRoutingSample {
  const itemSnapshot = objectValue(row.itemSnapshot);
  const operationSnapshot = Array.isArray(row.operationSnapshot)
    ? row.operationSnapshot
    : [];
  return {
    id: String(row.id),
    itemId: String(row.itemId),
    readableId:
      stringValue(itemSnapshot.readableIdWithRevision) ??
      stringValue(itemSnapshot.readableId),
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

function routeSignature(operations: AiRoutingOperation[]) {
  return operations
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((operation) =>
      [
        operation.order,
        operation.processName ?? operation.description ?? operation.processId ?? "Unnamed"
      ].join(":")
    )
    .join(" -> ");
}

function compareRoutes(actual: AiRoutingOperation[], suggested: AiRoutingOperation[]) {
  const sortedActual = actual.slice().sort((a, b) => a.order - b.order);
  const sortedSuggested = suggested.slice().sort((a, b) => a.order - b.order);
  const max = Math.max(sortedActual.length, sortedSuggested.length);
  const byPosition = Array.from({ length: max }, (_, index) => {
    const expected = sortedActual[index] ?? null;
    const predicted = sortedSuggested[index] ?? null;
    return {
      position: index + 1,
      expectedProcessId: expected?.processId ?? null,
      expectedProcessName: expected?.processName ?? null,
      predictedProcessId: predicted?.processId ?? null,
      predictedProcessName: predicted?.processName ?? null,
      match: Boolean(
        expected?.processId && predicted?.processId && expected.processId === predicted.processId
      )
    };
  });
  const actualIds = sortedActual.map((operation) => operation.processId).filter(Boolean);
  const suggestedIds = sortedSuggested.map((operation) => operation.processId).filter(Boolean);
  return {
    actualOperationCount: sortedActual.length,
    suggestedOperationCount: sortedSuggested.length,
    operationCountDelta: sortedSuggested.length - sortedActual.length,
    exactPositionMatchCount: byPosition.filter((row) => row.match).length,
    exactSequenceMatch:
      sortedActual.length === sortedSuggested.length && byPosition.every((row) => row.match),
    missingActualProcessIds: actualIds.filter((id) => !suggestedIds.includes(id)),
    extraSuggestedProcessIds: suggestedIds.filter((id) => !actualIds.includes(id)),
    byPosition
  };
}

const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);

const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromJobs.resolve("@supabase/supabase-js")).href
);

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const companyId = "d8s9bh4f8gm357312pbg";
const evaluationReadableIds = [
  "1927930503",
  "192793050201",
  "1927930603",
  "192793060201"
];
const evaluationSet = new Set(evaluationReadableIds);

const { data: sampleRows, error: sampleError } = await carbon
  .from("aiRoutingSample")
  .select(
    "id,itemId,makeMethodId,itemSnapshot,operationSnapshot,drawingDocumentIds,materialTags,featureTags,processTags,resourceTags,status,datasetRole"
  )
  .eq("companyId", companyId)
  .eq("status", "Approved")
  .eq("datasetRole", "Training")
  .order("updatedAt", { ascending: false });
if (sampleError) throw sampleError;
const samples = (sampleRows ?? []).map((row) =>
  sampleFromRow(row as Record<string, unknown>)
);

const { data: itemRows, error: itemError } = await carbon
  .from("item")
  .select("id,readableId,readableIdWithRevision,name,description")
  .eq("companyId", companyId)
  .in("readableId", evaluationReadableIds);
if (itemError) throw itemError;
const itemsByReadable = new Map((itemRows ?? []).map((item) => [item.readableId, item]));
const itemIds = (itemRows ?? []).map((item) => item.id);

const { data: extractionRows, error: extractionError } = itemIds.length
  ? await carbon
      .from("aiDrawingExtraction")
      .select("id,itemId,documentId,status,completedAt,createdAt,extraction")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .eq("status", "Succeeded")
      .order("completedAt", { ascending: false })
  : { data: [], error: null };
if (extractionError) throw extractionError;
const latestExtractionByItem = new Map<string, Record<string, unknown>>();
for (const extraction of extractionRows ?? []) {
  if (!latestExtractionByItem.has(extraction.itemId)) {
    latestExtractionByItem.set(extraction.itemId, extraction as Record<string, unknown>);
  }
}

const { data: jobRows, error: jobError } = itemIds.length
  ? await carbon
      .from("job")
      .select("id,jobId,itemId,source,status,createdAt")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("createdAt", { ascending: false })
  : { data: [], error: null };
if (jobError) throw jobError;
const jobIds = (jobRows ?? []).map((job) => job.id);

const { data: methodRows, error: methodError } = jobIds.length
  ? await carbon
      .from("jobMakeMethod")
      .select("id,jobId,itemId,version")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
  : { data: [], error: null };
if (methodError) throw methodError;

const { data: operationRows, error: operationError } = jobIds.length
  ? await carbon
      .from("jobOperation")
      .select("id,jobId,jobMakeMethodId,order,operationOrder,operationType,processId,workCenterId,description,setupTime,setupUnit,laborTime,laborUnit,machineTime,machineUnit,customFields,process(id,name),workCenter(id,name)")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
      .order("order", { ascending: true })
  : { data: [], error: null };
if (operationError) throw operationError;

const jobsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const job of jobRows ?? []) {
  const rows = jobsByItem.get(job.itemId) ?? [];
  rows.push(job as Record<string, unknown>);
  jobsByItem.set(job.itemId, rows);
}
const methodsByJob = new Map<string, Array<Record<string, unknown>>>();
for (const method of methodRows ?? []) {
  const rows = methodsByJob.get(method.jobId) ?? [];
  rows.push(method as Record<string, unknown>);
  methodsByJob.set(method.jobId, rows);
}
const operationsByMethod = new Map<string, Array<Record<string, unknown>>>();
for (const operation of operationRows ?? []) {
  const key = String(operation.jobMakeMethodId ?? "");
  const rows = operationsByMethod.get(key) ?? [];
  rows.push(operation as Record<string, unknown>);
  operationsByMethod.set(key, rows);
}

const results = [];
for (const readableId of evaluationReadableIds) {
  const item = itemsByReadable.get(readableId);
  if (!item) throw new Error(`Missing item ${readableId}`);
  const extraction = latestExtractionByItem.get(item.id);
  if (!extraction) throw new Error(`Missing succeeded extraction ${readableId}`);

  const target = aiRoutingTargetEvidenceFromDrawing({
    id: String(extraction.id),
    itemId: item.id,
    item: {
      readableId: item.readableIdWithRevision ?? item.readableId,
      name: item.name,
      description: item.description
    },
    drawingExtraction: extraction.extraction
  });
  const draft = generateAiRoutingDraft({ target, samples });
  const routeCandidates = (jobsByItem.get(item.id) ?? [])
    .flatMap((job) =>
      (methodsByJob.get(String(job.id)) ?? []).map((method) => {
        const operations = (operationsByMethod.get(String(method.id)) ?? []).map((operation) =>
          operationFromJobRow(operation)
        );
        return { job, method, operations };
      })
    )
    .filter((candidate) => candidate.operations.length > 0);
  const selectedRoute = routeCandidates[0];
  if (!selectedRoute) throw new Error(`Missing U8 job route ${readableId}`);

  const processIds = Array.from(
    new Set(
      draft.suggestedOperations
        .map((operation) => operation.processId)
        .filter((processId): processId is string => Boolean(processId))
    )
  );
  const { data: processes, error: processError } = processIds.length
    ? await carbon.from("process").select("id,companyId").in("id", processIds)
    : { data: [], error: null };
  if (processError) throw processError;
  const processCompanyById = new Map(
    (processes ?? []).map((process) => [process.id, process.companyId])
  );
  const invalidProcessIds = processIds.filter(
    (processId) => processCompanyById.get(processId) !== companyId
  );
  const evaluationLeaks = draft.references.filter((reference) =>
    reference.readableId ? evaluationSet.has(reference.readableId) : false
  );
  const workCenterAssignments = draft.suggestedOperations.filter(
    (operation) => operation.workCenterId || operation.workCenterName
  );
  const missingProcessIdCount = draft.suggestedOperations.filter(
    (operation) => !operation.processId
  ).length;

  results.push({
    readableId,
    targetExtractionId: extraction.id,
    targetDrawingEvidenceCount: target.drawingEvidence?.length ?? 0,
    targetFeatureTags: target.featureTags,
    trainingSampleCount: samples.length,
    routeCandidateCount: routeCandidates.length,
    actualRouteSignature: routeSignature(selectedRoute.operations),
    suggestedRouteSignature: routeSignature(draft.suggestedOperations),
    comparison: compareRoutes(selectedRoute.operations, draft.suggestedOperations),
    warningCount: draft.warnings.length,
    warnings: draft.warnings,
    referenceCount: draft.references.length,
    topReferences: draft.references.slice(0, 5).map((reference) => ({
      sampleId: reference.sampleId,
      readableId: reference.readableId,
      score: reference.score,
      matchedDrawingEvidenceCount: reference.matchedDrawingEvidence?.length ?? 0
    })),
    evaluationLeakCount: evaluationLeaks.length,
    workCenterAssignmentCount: workCenterAssignments.length,
    missingProcessIdCount,
    invalidProcessIds
  });
}

const summary = {
  companyId,
  evaluatedAt: new Date().toISOString(),
  holdoutCount: evaluationReadableIds.length,
  trainingSampleCount: samples.length,
  exactSequenceMatches: results.filter((result) => result.comparison.exactSequenceMatch).length,
  totalEvaluationLeaks: results.reduce((sum, result) => sum + result.evaluationLeakCount, 0),
  totalWorkCenterAssignments: results.reduce((sum, result) => sum + result.workCenterAssignmentCount, 0),
  totalMissingProcessIds: results.reduce((sum, result) => sum + result.missingProcessIdCount, 0),
  invalidProcessIds: Array.from(new Set(results.flatMap((result) => result.invalidProcessIds))),
  results
};

const outputPath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-second-batch-holdout-evaluation-20260819.json"
);
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));

if (
  summary.totalEvaluationLeaks > 0 ||
  summary.totalWorkCenterAssignments > 0 ||
  summary.totalMissingProcessIds > 0 ||
  summary.invalidProcessIds.length > 0
) {
  process.exitCode = 2;
}