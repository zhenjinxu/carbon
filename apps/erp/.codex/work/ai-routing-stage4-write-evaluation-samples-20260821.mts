import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PostgresDriver, sql } from "kysely";

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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

const materialPatterns: Array<[string, RegExp]> = [
  ["304", /\b304\b|sus304|不锈钢304/i],
  ["316", /\b316\b|sus316|不锈钢316/i],
  ["铝", /铝|aluminium|aluminum/i],
  ["不锈钢", /不锈钢|stainless/i],
  ["碳钢", /碳钢|carbon steel/i]
];
const featurePatterns: Array<[string, RegExp]> = [
  ["板件", /板|板件|sheet|plate/i],
  ["孔", /孔|攻丝|钻|hole|thread|tap/i],
  ["焊接件", /焊|焊接|weld/i],
  ["折弯", /折弯|bend/i]
];
const processPatterns: Array<[string, RegExp]> = [
  ["激光切割", /激光|laser/i],
  ["折弯", /折弯|bend/i],
  ["攻丝", /攻丝|tap|thread/i],
  ["焊接", /焊|weld/i],
  ["打磨", /打磨|grind|polish/i],
  ["下料", /下料|cut.?off|blank/i],
  ["领料", /领料|material issue/i]
];

function matchingTags(text: string, patterns: Array<[string, RegExp]>) {
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);
}

function operationFromRow(row: Record<string, unknown>) {
  const process = asRecord(row.process);
  const workCenter = asRecord(row.workCenter);
  return {
    id: stringValue(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId) ?? stringValue(process.id),
    processName: stringValue(process.name),
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
    customFields: row.customFields ?? null
  };
}

function buildJobRouteSample(args: {
  companyId: string;
  item: Record<string, unknown>;
  jobMakeMethod: Record<string, unknown>;
  operations: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
}) {
  if (args.jobMakeMethod.itemId !== args.item.id) {
    return { data: null, error: "job_route_item_mismatch" };
  }
  const operations = args.operations
    .map(operationFromRow)
    .sort((a, b) => a.order - b.order);
  if (operations.length === 0) {
    return { data: null, error: "job_route_operations_missing" };
  }
  const itemText = [
    args.item.readableId,
    args.item.readableIdWithRevision,
    args.item.name,
    args.item.description,
    JSON.stringify(args.item.customFields ?? {})
  ].join(" ");
  const operationText = operations
    .map((operation) => [operation.processName, operation.description].join(" "))
    .join(" ");
  return {
    data: {
      id: `${args.companyId}:job-route:${args.jobMakeMethod.id}`,
      itemId: String(args.item.id),
      readableId:
        stringValue(args.item.readableIdWithRevision) ??
        stringValue(args.item.readableId),
      name: stringValue(args.item.name),
      makeMethodId: null,
      documentIds: args.documents
        .map((document) => stringValue(document.id))
        .filter((id): id is string => Boolean(id)),
      operations,
      status: "Approved",
      datasetRole: "Training",
      materialTags: unique(matchingTags(itemText, materialPatterns)),
      featureTags: unique([
        ...matchingTags(itemText, featurePatterns),
        ...matchingTags(operationText, featurePatterns)
      ]),
      processTags: unique(matchingTags(operationText, processPatterns)),
      resourceTags: unique(
        operations.flatMap((operation) => [operation.workCenterName, operation.workCenterId])
      )
    },
    error: null
  };
}

function routeSignature(operations: Array<Record<string, unknown>>) {
  return operations
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map(
      (operation) =>
        `${operation.order ?? "?"}:${operation.description ?? operation.processId ?? "Unnamed"}`
    )
    .join(" -> ");
}

function currentDrawingSnapshotCount(args: {
  itemId: string;
  documents: Array<Record<string, unknown>>;
  extractions: Array<Record<string, unknown>>;
}) {
  const activePdfs = args.documents.filter((document) => {
    return (
      document.active !== false &&
      document.sourceDocument === "Part" &&
      document.sourceDocumentId === args.itemId &&
      document.type === "PDF" &&
      String(document.extension ?? "").toLowerCase() === "pdf"
    );
  });
  if (activePdfs.length === 0) throw new Error("active_part_pdf_missing");

  let snapshotCount = 0;
  for (const document of activePdfs) {
    const extraction = args.extractions.find((row) => {
      const payload = asRecord(row.extraction);
      const documentPayload = asRecord(payload.document);
      return (
        row.documentId === document.id &&
        row.status === "Succeeded" &&
        row.contentHash === documentPayload.contentHash &&
        row.extractorSchemaVersion === payload.schemaVersion
      );
    });
    if (!extraction) throw new Error("succeeded_current_pdf_extraction_missing");
    snapshotCount += 1;
  }
  return snapshotCount;
}

const root = resolve(process.cwd(), "../..");
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), true);

const requireFromJobs = createRequire(resolve(root, "packages/jobs/package.json"));
const { getPostgresClient, getPostgresConnectionPool } = await import(
  pathToFileURL(resolve(root, "packages/database/src/client.ts")).href
);
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
  "1927326104",
  "1927881101",
  "1927881103",
  "1927930801",
  "1927930802",
  "1927930803",
  "1927930804",
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
  "19276939010203"
];
const proposedTraining = new Set<string>([]);
const proposedEvaluation = new Set(partIds);
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-evaluation-sample-write-20260821.json");

const { data: itemRows, error: itemError } = await carbon
  .from("item")
  .select("id,readableId,readableIdWithRevision,name,description,customFields:notes,createdBy")
  .eq("companyId", companyId)
  .in("readableId", partIds);
if (itemError) throw itemError;

const itemsByReadable = new Map(
  (itemRows ?? []).map((item) => [item.readableId, item as Record<string, unknown>])
);
const itemIds = (itemRows ?? []).map((item) => item.id);

const { data: documentRows, error: documentError } = itemIds.length
  ? await carbon
      .from("document")
      .select("id,name,path,extension,type,sourceDocument,sourceDocumentId,active")
      .eq("companyId", companyId)
      .eq("sourceDocument", "Part")
      .in("sourceDocumentId", itemIds)
  : { data: [], error: null };
if (documentError) throw documentError;

const { data: extractionRows, error: extractionError } = itemIds.length
  ? await carbon
      .from("aiDrawingExtraction")
      .select("id,itemId,documentId,status,contentHash,rendererVersion,extractorSchemaVersion,promptVersion,modelProvider,modelName,pageCount,completedAt,createdAt,errorCode,errorMessage,extraction")
      .eq("companyId", companyId)
      .in("itemId", itemIds)
      .order("createdAt", { ascending: false })
  : { data: [], error: null };
if (extractionError) throw extractionError;

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
const { data: jobMakeMethodRows, error: jobMakeMethodError } = jobIds.length
  ? await carbon
      .from("jobMakeMethod")
      .select("id,jobId,itemId,version")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
  : { data: [], error: null };
if (jobMakeMethodError) throw jobMakeMethodError;

const { data: jobOperationRows, error: jobOperationError } = jobIds.length
  ? await carbon
      .from("jobOperation")
      .select("id,jobId,jobMakeMethodId,order,operationOrder,operationType,processId,workCenterId,description,setupTime,setupUnit,laborTime,laborUnit,machineTime,machineUnit,customFields,process(id,name),workCenter(id,name)")
      .eq("companyId", companyId)
      .in("jobId", jobIds)
      .order("order", { ascending: true })
  : { data: [], error: null };
if (jobOperationError) throw jobOperationError;

const documentsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const document of documentRows ?? []) {
  const rows = documentsByItem.get(document.sourceDocumentId) ?? [];
  rows.push(document as Record<string, unknown>);
  documentsByItem.set(document.sourceDocumentId, rows);
}
const extractionsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const extraction of extractionRows ?? []) {
  const rows = extractionsByItem.get(extraction.itemId) ?? [];
  rows.push(extraction as Record<string, unknown>);
  extractionsByItem.set(extraction.itemId, rows);
}
const jobsByItem = new Map<string, Array<Record<string, unknown>>>();
for (const job of jobRows ?? []) {
  const rows = jobsByItem.get(job.itemId) ?? [];
  rows.push(job as Record<string, unknown>);
  jobsByItem.set(job.itemId, rows);
}
const methodsByJob = new Map<string, Array<Record<string, unknown>>>();
for (const method of jobMakeMethodRows ?? []) {
  const rows = methodsByJob.get(method.jobId) ?? [];
  rows.push(method as Record<string, unknown>);
  methodsByJob.set(method.jobId, rows);
}
const operationsByJobMethod = new Map<string, Array<Record<string, unknown>>>();
for (const operation of jobOperationRows ?? []) {
  const key = String(operation.jobMakeMethodId ?? "");
  const rows = operationsByJobMethod.get(key) ?? [];
  rows.push(operation as Record<string, unknown>);
  operationsByJobMethod.set(key, rows);
}

const perPart = partIds.map((readableId) => {
  const item = itemsByReadable.get(readableId) ?? null;
  const itemId = stringValue(item?.id);
  const role = proposedTraining.has(readableId)
    ? "Training"
    : proposedEvaluation.has(readableId)
      ? "Evaluation"
      : "Unassigned";
  const documents = itemId ? documentsByItem.get(itemId) ?? [] : [];
  const extractions = itemId ? extractionsByItem.get(itemId) ?? [] : [];
  const jobs = itemId ? jobsByItem.get(itemId) ?? [] : [];
  let drawingSnapshotCount = 0;
  let drawingError: string | null = null;
  try {
    drawingSnapshotCount = currentDrawingSnapshotCount({
      itemId: itemId ?? "missing",
      documents,
      extractions
    });
  } catch (error) {
    drawingError = error instanceof Error ? error.message : String(error);
  }

  const routeCandidates = jobs
    .flatMap((job) =>
      (methodsByJob.get(String(job.id)) ?? []).map((method) => {
        const operations = operationsByJobMethod.get(String(method.id)) ?? [];
        return { job, method, operations };
      })
    )
    .filter((candidate) => candidate.operations.length > 0);
  const distinctRouteSignatures = Array.from(
    new Set(routeCandidates.map((candidate) => routeSignature(candidate.operations)))
  );
  const selectedRoute = routeCandidates[0] ?? null;
  const sample =
    item && selectedRoute
      ? buildJobRouteSample({
          companyId,
          item,
          jobMakeMethod: selectedRoute.method,
          operations: selectedRoute.operations,
          documents
        })
      : { data: null, error: "u8_job_route_sample_source_missing" };
  const blockers = [
    !item ? "item_missing" : null,
    drawingError,
    routeCandidates.length === 0 ? "u8_job_route_missing" : null,
    distinctRouteSignatures.length > 1 ? "multiple_u8_route_signatures" : null,
    sample.error
  ].filter(Boolean);

  return {
    readableId,
    role,
    itemId,
    latestExtractionStatus: extractions[0]?.status ?? null,
    latestExtractionId: extractions[0]?.id ?? null,
    drawingReady: drawingError === null,
    drawingSnapshotCount,
    routeCandidateCount: routeCandidates.length,
    distinctRouteSignatureCount: distinctRouteSignatures.length,
    selectedJobMakeMethodId: selectedRoute?.method.id ?? null,
    selectedRouteOperationCount: selectedRoute?.operations.length ?? 0,
    selectedRouteSignature: selectedRoute ? routeSignature(selectedRoute.operations) : null,
    sampleId: sample.data?.id ?? null,
    sampleOperationCount: sample.data?.operations.length ?? 0,
    wouldWriteTrainingSample: role === "Training" && blockers.length === 0,
    blockers
  };
});

const trainingReady = perPart.filter(
  (part) => part.role === "Training" && part.blockers.length === 0
).length;
const evaluationReady = perPart.filter(
  (part) => part.role === "Evaluation" && part.blockers.length === 0
).length;
const blockers = perPart.filter((part) => part.blockers.length > 0);

console.log(
  JSON.stringify(
    {
      companyId,
      partCount: partIds.length,
      trainingReady,
      evaluationReady,
      wouldWriteTrainingSamples: perPart.filter((part) => part.wouldWriteTrainingSample).length,
      readyForDatasetWrite: trainingReady === 0 && evaluationReady === 19,
      blockers,
      perPart
    },
    null,
    2
  )
);

if (trainingReady !== 0 || evaluationReady !== 19) {
  process.exitCode = 2;
}

if (trainingReady !== 0 || evaluationReady !== 19) {
  throw new Error("Stage 4 readiness gate failed; refusing Evaluation sample write");
}

const postgresPool = getPostgresConnectionPool(2);
const postgres = getPostgresClient(postgresPool, PostgresDriver);

let writeResults: Array<Record<string, unknown>> = [];
try {
  writeResults = await postgres.transaction().execute(async (trx) => {
    const results: Array<Record<string, unknown>> = [];
    for (const part of perPart) {
      if (part.blockers.length > 0) continue;
      const item = itemsByReadable.get(part.readableId);
      if (!item) continue;
      const itemId = String(item.id);
      const documents = documentsByItem.get(itemId) ?? [];
      const extractions = extractionsByItem.get(itemId) ?? [];
      const selectedRoute = (jobsByItem.get(itemId) ?? [])
        .flatMap((job) =>
          (methodsByJob.get(String(job.id)) ?? []).map((method) => ({
            job,
            method,
            operations: operationsByJobMethod.get(String(method.id)) ?? []
          }))
        )
        .find((candidate) => candidate.operations.length > 0);
      if (!selectedRoute) continue;

      const sampleResult = buildJobRouteSample({
        companyId,
        item,
        jobMakeMethod: selectedRoute.method,
        operations: selectedRoute.operations,
        documents
      });
      if (!sampleResult.data) {
        throw new Error(`Sample build failed for ${part.readableId}: ${sampleResult.error}`);
      }

      const activePdfs = documents.filter((document) => {
        return (
          document.active !== false &&
          document.sourceDocument === "Part" &&
          document.sourceDocumentId === itemId &&
          document.type === "PDF" &&
          String(document.extension ?? "").toLowerCase() === "pdf"
        );
      });
      const drawingSnapshot = activePdfs.map((document) => {
        const extraction = extractions.find((row) => {
          const payload = asRecord(row.extraction);
          const documentPayload = asRecord(payload.document);
          return (
            row.documentId === document.id &&
            row.status === "Succeeded" &&
            row.contentHash === documentPayload.contentHash &&
            row.extractorSchemaVersion === payload.schemaVersion
          );
        });
        if (!extraction) throw new Error(`Current extraction missing for ${part.readableId}`);
        return {
          id: document.id,
          name: document.name ?? null,
          path: document.path ?? null,
          extension: document.extension ?? null,
          type: document.type ?? null,
          sourceDocument: document.sourceDocument ?? null,
          sourceDocumentId: document.sourceDocumentId ?? null,
          aiDrawingExtraction: {
            id: extraction.id,
            documentId: extraction.documentId,
            contentHash: extraction.contentHash,
            rendererVersion: extraction.rendererVersion ?? null,
            extractorSchemaVersion: extraction.extractorSchemaVersion,
            promptVersion: extraction.promptVersion ?? null,
            modelProvider: extraction.modelProvider ?? null,
            modelName: extraction.modelName ?? null,
            pageCount: extraction.pageCount ?? null,
            completedAt: extraction.completedAt ?? null
          }
        };
      });

      const sample = {
        ...sampleResult.data,
        status: "Approved",
        datasetRole: part.role
      };
      const { createdBy: itemCreatedBy, ...itemSnapshot } = item;
      const userId = process.env.U8_CARBON_USER_ID || stringValue(itemCreatedBy);
      if (!userId) {
        throw new Error(`User id missing for AI routing dataset write: ${part.readableId}`);
      }

      const existing = await trx
        .selectFrom("aiRoutingSample")
        .select(["id", "datasetRole", "lockedAt", "lockedBy"])
        .where("companyId", "=", companyId)
        .where("id", "=", sample.id)
        .executeTakeFirst();
      if (existing?.lockedAt) {
        if (existing.datasetRole !== part.role) {
          throw new Error(`Locked sample role mismatch for ${part.readableId}`);
        }
        results.push({
          readableId: part.readableId,
          role: part.role,
          sampleId: sample.id,
          operationCount: selectedRoute.operations.length,
          drawingSnapshotCount: drawingSnapshot.length,
          action: "KeptLocked"
        });
        continue;
      }

      const now = new Date().toISOString();
      const lockedAt = part.role === "Evaluation" ? now : null;
      const lockedBy = part.role === "Evaluation" ? userId : null;
      const operationSnapshot = selectedRoute.operations
        .map(operationFromRow)
        .sort((a, b) => a.order - b.order);

      if (existing) {
        await sql`
          UPDATE "aiRoutingSample"
          SET
            "itemSnapshot" = ${JSON.stringify(itemSnapshot)}::jsonb,
            "drawingDocumentIds" = ${sample.documentIds}::text[],
            "drawingSnapshot" = ${JSON.stringify(drawingSnapshot)}::jsonb,
            "operationSnapshot" = ${JSON.stringify(operationSnapshot)}::jsonb,
            "materialTags" = ${sample.materialTags}::text[],
            "featureTags" = ${sample.featureTags}::text[],
            "processTags" = ${sample.processTags}::text[],
            "resourceTags" = ${sample.resourceTags}::text[],
            "ontologySnapshot" = NULL,
            "datasetRole" = ${part.role}::"aiRoutingDatasetRole",
            "status" = 'Approved'::"aiRoutingSampleStatus",
            "lockedAt" = COALESCE("aiRoutingSample"."lockedAt", ${lockedAt}::timestamptz),
            "lockedBy" = COALESCE("aiRoutingSample"."lockedBy", ${lockedBy}),
            "updatedBy" = ${userId},
            "updatedAt" = ${now}
          WHERE "companyId" = ${companyId}
            AND "id" = ${sample.id}
            AND (
              "lockedAt" IS NULL
              OR "datasetRole" = ${part.role}::"aiRoutingDatasetRole"
            )
        `.execute(trx);
      } else {
        await sql`
          INSERT INTO "aiRoutingSample" (
            "id",
            "companyId",
            "itemId",
            "makeMethodId",
            "source",
            "status",
            "datasetRole",
            "itemSnapshot",
            "drawingDocumentIds",
            "drawingSnapshot",
            "operationSnapshot",
            "materialTags",
            "featureTags",
            "processTags",
            "resourceTags",
            "ontologySnapshot",
            "createdBy",
            "updatedBy",
            "updatedAt",
            "lockedAt",
            "lockedBy"
          ) VALUES (
            ${sample.id},
            ${companyId},
            ${sample.itemId},
            ${null},
            ${"u8-job-route"},
            ${"Approved"}::"aiRoutingSampleStatus",
            ${part.role}::"aiRoutingDatasetRole",
            ${JSON.stringify(itemSnapshot)}::jsonb,
            ${sample.documentIds}::text[],
            ${JSON.stringify(drawingSnapshot)}::jsonb,
            ${JSON.stringify(operationSnapshot)}::jsonb,
            ${sample.materialTags}::text[],
            ${sample.featureTags}::text[],
            ${sample.processTags}::text[],
            ${sample.resourceTags}::text[],
            ${null}::jsonb,
            ${userId},
            ${userId},
            ${now},
            ${lockedAt}::timestamptz,
            ${lockedBy}
          )
        `.execute(trx);
      }

      results.push({
        readableId: part.readableId,
        role: part.role,
        sampleId: sample.id,
        operationCount: operationSnapshot.length,
        drawingSnapshotCount: drawingSnapshot.length,
        action: existing ? "Updated" : "Inserted"
      });
    }
    return results;
  });
} finally {
  await postgres.destroy();
}

console.log(JSON.stringify({ companyId, wrote: writeResults.length, writeResults }, null, 2));
writeFileSync(outputPath, `${JSON.stringify({ companyId, wrote: writeResults.length, writeResults }, null, 2)}\n`, "utf8");
if (writeResults.length !== 19) process.exitCode = 2;



