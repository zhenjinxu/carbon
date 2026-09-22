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

function normalizeProcessName(value: string | null | undefined) {
  return (value ?? "")
    .replace(/^U8\s+\S+\s+/, "")
    .replace(/[（）]/g, (char) => (char === "（" ? "(" : ")"))
    .trim();
}

function normalizedRouteSignature(operations: AiRoutingOperation[]) {
  return operations
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((operation) =>
      normalizeProcessName(operation.processName ?? operation.description)
    );
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
const readableId = "192793050201";

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

const { data: item, error: itemError } = await carbon
  .from("item")
  .select("id,readableId,readableIdWithRevision,name,description")
  .eq("companyId", companyId)
  .eq("readableId", readableId)
  .single();
if (itemError) throw itemError;

const { data: extractionRows, error: extractionError } = await carbon
  .from("aiDrawingExtraction")
  .select("id,itemId,documentId,status,completedAt,createdAt,extraction")
  .eq("companyId", companyId)
  .eq("itemId", item.id)
  .eq("status", "Succeeded")
  .order("completedAt", { ascending: false })
  .limit(1);
if (extractionError) throw extractionError;
const extraction = extractionRows?.[0];
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

const { data: jobRows, error: jobError } = await carbon
  .from("job")
  .select("id,itemId,createdAt")
  .eq("companyId", companyId)
  .eq("itemId", item.id)
  .order("createdAt", { ascending: false });
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

const methodIds = (methodRows ?? []).map((method) => method.id);
const { data: operationRows, error: operationError } = methodIds.length
  ? await carbon
      .from("jobOperation")
      .select("id,jobId,jobMakeMethodId,order,operationOrder,operationType,processId,workCenterId,description,setupTime,setupUnit,laborTime,laborUnit,machineTime,machineUnit,customFields,process(id,name),workCenter(id,name)")
      .eq("companyId", companyId)
      .in("jobMakeMethodId", methodIds)
      .order("order", { ascending: true })
  : { data: [], error: null };
if (operationError) throw operationError;

const operationsByMethod = new Map<string, Array<Record<string, unknown>>>();
for (const operation of operationRows ?? []) {
  const key = String(operation.jobMakeMethodId ?? "");
  const rows = operationsByMethod.get(key) ?? [];
  rows.push(operation as Record<string, unknown>);
  operationsByMethod.set(key, rows);
}
const selectedRoute = (methodRows ?? [])
  .map((method) => ({
    method,
    operations: (operationsByMethod.get(String(method.id)) ?? []).map(
      operationFromJobRow
    )
  }))
  .find((candidate) => candidate.operations.length > 0);
if (!selectedRoute) throw new Error(`Missing U8 job route ${readableId}`);

const defaultDraft = generateAiRoutingDraft({ target, samples });
const relaxedDraft = generateAiRoutingDraft({
  target,
  samples,
  minimumScore: 30
});

const actualNormalized = normalizedRouteSignature(selectedRoute.operations);
const relaxedNormalized = normalizedRouteSignature(relaxedDraft.suggestedOperations);
const summary = {
  readableId,
  trainingSampleCount: samples.length,
  targetExtractionId: extraction.id,
  defaultMinimumScore: 35,
  defaultSuggestedOperationCount: defaultDraft.suggestedOperations.length,
  defaultWarnings: defaultDraft.warnings,
  relaxedMinimumScore: 30,
  relaxedSuggestedOperationCount: relaxedDraft.suggestedOperations.length,
  relaxedWarnings: relaxedDraft.warnings,
  relaxedTopReferences: relaxedDraft.references.slice(0, 5).map((reference) => ({
    sampleId: reference.sampleId,
    readableId: reference.readableId,
    score: reference.score,
    matchedDrawingEvidenceCount: reference.matchedDrawingEvidence?.length ?? 0
  })),
  actualNormalized,
  relaxedNormalized,
  normalizedExactSequenceMatch:
    actualNormalized.length === relaxedNormalized.length &&
    actualNormalized.every((name, index) => name === relaxedNormalized[index])
};

const outputPath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-second-batch-threshold-sensitivity-20260819.json"
);
writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
