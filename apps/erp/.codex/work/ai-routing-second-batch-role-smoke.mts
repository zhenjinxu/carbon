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
const targetReadableId = process.argv[2] ?? "1927930207";
const evaluationReadableIds = new Set([
  "1927930503",
  "192793050201",
  "1927930603",
  "192793060201"
]);

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

const { data: targetItem, error: targetItemError } = await carbon
  .from("item")
  .select("id, readableId, readableIdWithRevision, name, description")
  .eq("companyId", companyId)
  .eq("readableId", targetReadableId)
  .single();
if (targetItemError) throw targetItemError;

const { data: extractionRows, error: extractionError } = await carbon
  .from("aiDrawingExtraction")
  .select("id,itemId,documentId,status,completedAt,extraction")
  .eq("companyId", companyId)
  .eq("itemId", targetItem.id)
  .eq("status", "Succeeded")
  .order("completedAt", { ascending: false })
  .limit(1);
if (extractionError) throw extractionError;
const extractionRow = extractionRows?.[0];
if (!extractionRow) {
  throw new Error(`No succeeded drawing extraction for ${targetReadableId}`);
}

const target = aiRoutingTargetEvidenceFromDrawing({
  id: extractionRow.id,
  itemId: targetItem.id,
  item: {
    readableId: targetItem.readableIdWithRevision ?? targetItem.readableId,
    name: targetItem.name,
    description: targetItem.description
  },
  drawingExtraction: extractionRow.extraction
});

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
const draft = generateAiRoutingDraft({ target, samples });
const evaluationLeaks = draft.references.filter((reference) =>
  reference.readableId ? evaluationReadableIds.has(reference.readableId) : false
);
const workCenterAssignments = draft.suggestedOperations.filter(
  (operation) => operation.workCenterId || operation.workCenterName
);
const processIds = Array.from(
  new Set(
    draft.suggestedOperations
      .map((operation) => operation.processId)
      .filter((processId): processId is string => Boolean(processId))
  )
);
const missingProcessIdCount = draft.suggestedOperations.filter(
  (operation) => !operation.processId
).length;
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

console.log(
  JSON.stringify(
    {
      targetReadableId,
      targetExtractionId: extractionRow.id,
      targetFeatureTags: target.featureTags,
      targetDrawingEvidenceCount: target.drawingEvidence?.length ?? 0,
      trainingSampleCount: samples.length,
      suggestedOperationCount: draft.suggestedOperations.length,
      suggestedOperations: draft.suggestedOperations.map((operation) => ({
        order: operation.order,
        processId: operation.processId,
        processName: operation.processName,
        workCenterId: operation.workCenterId,
        sourceSampleId: operation.sourceSampleId,
        sourceOperationOrder: operation.sourceOperationOrder
      })),
      references: draft.references.map((reference) => ({
        sampleId: reference.sampleId,
        readableId: reference.readableId,
        score: reference.score,
        matched: reference.matched,
        matchedDrawingEvidenceCount:
          reference.matchedDrawingEvidence?.length ?? 0
      })),
      warnings: draft.warnings,
      evaluationLeakCount: evaluationLeaks.length,
      workCenterAssignmentCount: workCenterAssignments.length,
      missingProcessIdCount,
      invalidProcessIds
    },
    null,
    2
  )
);

if (missingProcessIdCount > 0 || invalidProcessIds.length > 0) {
  throw new Error("AI routing draft process validation failed");
}
