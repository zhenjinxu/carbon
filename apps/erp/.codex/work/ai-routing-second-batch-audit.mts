import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
const partIds = [
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
];
const proposedTraining = new Set([
  "1927930501",
  "1927930502",
  "192793050101",
  "192793050200",
  "1927930601",
  "1927930602",
  "192793060101",
  "192793060200"
]);
const proposedEvaluation = new Set([
  "1927930503",
  "192793050201",
  "1927930603",
  "192793060201"
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function routeSignature(operations: Array<Record<string, unknown>>) {
  return operations
    .map((operation) => {
      const process = asRecord(operation.process);
      return [
        operation.order ?? "?",
        nonEmptyString(operation.description) ??
          nonEmptyString(process.name) ??
          nonEmptyString(operation.processId) ??
          "Unnamed"
      ].join(":");
    })
    .join(" -> ");
}

const { data: itemRows, error: itemError } = await carbon
  .from("item")
  .select("id, readableId, readableIdWithRevision, name, description")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;

const itemsByReadable = new Map(
  (itemRows ?? []).map((item) => [item.readableId, item])
);
const itemIds = (itemRows ?? []).map((item) => item.id);

const { data: documentRows, error: documentError } = itemIds.length
  ? await carbon
      .from("document")
      .select(
        "id,name,path,extension,type,size,active,sourceDocument,sourceDocumentId,createdAt,updatedAt"
      )
      .eq("companyId", companyId)
      .eq("sourceDocument", "Part")
      .in("sourceDocumentId", itemIds)
      .order("updatedAt", { ascending: false })
  : { data: [], error: null };
if (documentError) throw documentError;

const documentsByItem = new Map<string, unknown[]>();
for (const document of documentRows ?? []) {
  const itemDocuments = documentsByItem.get(document.sourceDocumentId) ?? [];
  itemDocuments.push(document);
  documentsByItem.set(document.sourceDocumentId, itemDocuments);
}

const { data: extractionRows, error: extractionError } = itemIds.length
  ? await carbon
      .from("aiDrawingExtraction")
      .select(
        "id,itemId,documentId,status,contentHash,extractorSchemaVersion,modelProvider,modelName,pageCount,completedAt,createdAt,errorCode,errorMessage,extraction"
      )
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("createdAt", { ascending: false })
  : { data: [], error: null };
if (extractionError) throw extractionError;

const latestExtractionByItem = new Map<string, Record<string, unknown>>();
const succeededExtractionByItem = new Map<string, Record<string, unknown>>();
for (const extraction of extractionRows ?? []) {
  if (!latestExtractionByItem.has(extraction.itemId)) {
    latestExtractionByItem.set(extraction.itemId, extraction as Record<string, unknown>);
  }
  if (
    extraction.status === "Succeeded" &&
    !succeededExtractionByItem.has(extraction.itemId)
  ) {
    succeededExtractionByItem.set(extraction.itemId, extraction as Record<string, unknown>);
  }
}

const { data: methodRows, error: methodError } = itemIds.length
  ? await carbon
      .from("makeMethod")
      .select("id,itemId,status,version,updatedAt")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("version", { ascending: false })
  : { data: [], error: null };
if (methodError) throw methodError;

const methodsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const method of methodRows ?? []) {
  const rows = methodsByItem.get(method.itemId) ?? [];
  rows.push(method as Record<string, unknown>);
  methodsByItem.set(method.itemId, rows);
}
const methodIds = (methodRows ?? []).map((method) => String(method.id));

const { data: operationRows, error: operationError } = methodIds.length
  ? await carbon
      .from("methodOperation")
      .select("id,makeMethodId,order,processId,description,operationType,operationOrder,process(id,name)")
      .in("makeMethodId", methodIds)
      .order("order", { ascending: true })
  : { data: [], error: null };
if (operationError) throw operationError;

const operationsByMethod = new Map<string, Array<Record<string, unknown>>>();
for (const operation of operationRows ?? []) {
  const rows = operationsByMethod.get(operation.makeMethodId) ?? [];
  rows.push(operation as Record<string, unknown>);
  operationsByMethod.set(operation.makeMethodId, rows);
}

function methodOperationCount(method: Record<string, unknown>) {
  return operationsByMethod.get(String(method.id))?.length ?? 0;
}

function methodRouteSignature(method: Record<string, unknown>) {
  return routeSignature(operationsByMethod.get(String(method.id)) ?? []);
}

const selectedMethodByItem = new Map<string, Record<string, unknown>>();
const routeMethodByItem = new Map<string, Record<string, unknown>>();
for (const [itemId, methods] of methodsByItem.entries()) {
  const activeMethod = methods.find((method) => method.status === "Active");
  const activeMethodWithOperations = methods.find(
    (method) => method.status === "Active" && methodOperationCount(method) > 0
  );
  const anyMethodWithOperations = methods.find(
    (method) => methodOperationCount(method) > 0
  );
  const selected = activeMethod ?? methods[0];
  if (selected) {
    selectedMethodByItem.set(itemId, selected);
  }
  const routeMethod = activeMethodWithOperations ?? anyMethodWithOperations;
  if (routeMethod) {
    routeMethodByItem.set(itemId, routeMethod);
  }
}

const { data: sampleRows, error: sampleError } = itemIds.length
  ? await carbon
      .from("aiRoutingSample")
      .select("id,itemId,makeMethodId,status,datasetRole,sampleVersion,lockedAt,updatedAt,drawingSnapshot,operationSnapshot")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .neq("status", "Retired")
  : { data: [], error: null };
if (sampleError) throw sampleError;

const samplesByItem = new Map<string, Array<Record<string, unknown>>>();
for (const sample of sampleRows ?? []) {
  const rows = samplesByItem.get(sample.itemId) ?? [];
  rows.push(sample as Record<string, unknown>);
  samplesByItem.set(sample.itemId, rows);
}

const perPart = partIds.map((readableId) => {
  const item = itemsByReadable.get(readableId) ?? null;
  const itemId = item?.id ?? null;
  const documents = itemId ? documentsByItem.get(itemId) ?? [] : [];
  const activePdfDocuments = documents.filter((document) => {
    const row = asRecord(document);
    const extension = String(row.extension ?? "").toLowerCase();
    return (
      row.active === true &&
      (row.type === "PDF" || extension === "pdf") &&
      row.sourceDocument === "Part" &&
      row.sourceDocumentId === itemId
    );
  });
  const latestExtraction = itemId ? latestExtractionByItem.get(itemId) : null;
  const succeededExtraction = itemId
    ? succeededExtractionByItem.get(itemId)
    : null;
  const methods = itemId ? methodsByItem.get(itemId) ?? [] : [];
  const method = itemId ? selectedMethodByItem.get(itemId) : null;
  const operations = method ? operationsByMethod.get(String(method.id)) ?? [] : [];
  const routeMethod = itemId ? routeMethodByItem.get(itemId) : null;
  const routeOperations = routeMethod
    ? operationsByMethod.get(String(routeMethod.id)) ?? []
    : [];
  const samples = itemId ? samplesByItem.get(itemId) ?? [] : [];
  const extractionPayload = asRecord(succeededExtraction?.extraction);
  const dimensions = asArray(extractionPayload.dimensions).length;
  const holes = asArray(extractionPayload.holes).length;
  const threads = asArray(extractionPayload.threads).length;
  const bends = asArray(extractionPayload.bends).length;
  const notes = asArray(extractionPayload.notes).length;

  return {
    readableId,
    proposedRole: proposedTraining.has(readableId)
      ? "Training"
      : proposedEvaluation.has(readableId)
        ? "Evaluation"
        : "Unassigned",
    itemFound: Boolean(item),
    itemId,
    itemName: item?.name ?? null,
    activePdfCount: activePdfDocuments.length,
    activePdfDocumentIds: activePdfDocuments.map((document) => asRecord(document).id),
    latestExtractionStatus: latestExtraction?.status ?? null,
    succeededExtractionId: succeededExtraction?.id ?? null,
    succeededExtractionDocumentId: succeededExtraction?.documentId ?? null,
    extractionModel: succeededExtraction
      ? `${succeededExtraction.modelProvider ?? "unknown"}/${succeededExtraction.modelName ?? "unknown"}`
      : null,
    extractionFeatureCounts: { dimensions, holes, threads, bends, notes },
    selectedMakeMethodId: method?.id ?? null,
    selectedMakeMethodStatus: method?.status ?? null,
    selectedMakeMethodVersion: method?.version ?? null,
    operationCount: operations.length,
    routeSignature: routeSignature(operations),
    routeMakeMethodId: routeMethod?.id ?? null,
    routeMakeMethodStatus: routeMethod?.status ?? null,
    routeMakeMethodVersion: routeMethod?.version ?? null,
    routeOperationCount: routeOperations.length,
    routeMethodSignature: routeSignature(routeOperations),
    makeMethods: methods.map((method) => ({
      id: method.id,
      status: method.status,
      version: method.version,
      updatedAt: method.updatedAt,
      operationCount: methodOperationCount(method),
      routeSignature: methodRouteSignature(method)
    })),
    sampleCount: samples.length,
    sampleRoles: samples.map((sample) => ({
      id: sample.id,
      makeMethodId: sample.makeMethodId,
      status: sample.status,
      datasetRole: sample.datasetRole,
      sampleVersion: sample.sampleVersion,
      drawingSnapshotCount: asArray(sample.drawingSnapshot).length,
      operationSnapshotCount: asArray(sample.operationSnapshot).length,
      locked: Boolean(sample.lockedAt)
    })),
    blockers: [
      !item ? "item_missing" : null,
      activePdfDocuments.length === 0 ? "active_pdf_missing" : null,
      !succeededExtraction ? "succeeded_extraction_missing" : null,
      !method ? "make_method_missing" : null,
      method && method.status !== "Active" ? "active_make_method_missing" : null,
      method && operations.length === 0 ? "active_method_operations_missing" : null,
      routeOperations.length === 0 ? "operations_missing" : null
    ].filter(Boolean)
  };
});

const roleCounts = perPart.reduce(
  (counts, part) => {
    counts[part.proposedRole] = (counts[part.proposedRole] ?? 0) + 1;
    return counts;
  },
  {} as Record<string, number>
);
const blockers = perPart.filter((part) => part.blockers.length > 0);
const existingSamples = perPart.filter((part) => part.sampleCount > 0).length;

const summary = {
  companyId,
  partCount: partIds.length,
  roleCounts,
  existingSamples,
  readyForRoleWrite: blockers.length === 0 && roleCounts.Training === 8 && roleCounts.Evaluation === 4,
  blockers,
  perPart
};

console.log(JSON.stringify(summary, null, 2));

if (blockers.length > 0) {
  process.exitCode = 2;
}
