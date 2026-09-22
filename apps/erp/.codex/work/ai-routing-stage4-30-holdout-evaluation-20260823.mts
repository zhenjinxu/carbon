import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  type AiRoutingOperation,
  type AiRoutingSample
} from "../../app/modules/items/ai-routing.ts";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
function findRoot(start: string) {
  let current = start;
  for (;;) {
    try { if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") return current; } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringValue(value: unknown) { return typeof value === "string" && value.length > 0 ? value : null; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
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
function operationFromJobRow(row: Record<string, unknown>): AiRoutingOperation {
  return {
    id: stringValue(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: stringValue(row.processId),
    processName: stringValue(row.processName) ?? stringValue(row.description),
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
function sampleFromRow(row: Record<string, unknown>): AiRoutingSample {
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
function routeSignature(operations: AiRoutingOperation[]) {
  return operations.slice().sort((a, b) => a.order - b.order).map((operation) => [operation.order, operation.processName ?? operation.description ?? operation.processId ?? "Unnamed"].join(":")).join(" -> ");
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
      match: Boolean(expected?.processId && predicted?.processId && expected.processId === predicted.processId)
    };
  });
  const actualIds = sortedActual.map((operation) => operation.processId).filter(Boolean) as string[];
  const suggestedIds = sortedSuggested.map((operation) => operation.processId).filter(Boolean) as string[];
  return {
    actualOperationCount: sortedActual.length,
    suggestedOperationCount: sortedSuggested.length,
    operationCountDelta: sortedSuggested.length - sortedActual.length,
    exactPositionMatchCount: byPosition.filter((row) => row.match).length,
    exactSequenceMatch: sortedActual.length === sortedSuggested.length && byPosition.every((row) => row.match),
    missingActualProcessIds: actualIds.filter((id) => !suggestedIds.includes(id)),
    extraSuggestedProcessIds: suggestedIds.filter((id) => !actualIds.includes(id)),
    byPosition
  };
}
function workCenterProcessPairKey(args: { processId: string; workCenterId: string }) { return `${args.processId}\u0000${args.workCenterId}`; }
const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");
const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const evaluationReadableIds = [
  "1927930503", "192793050201", "1927930603", "192793060201", "1927930202", "192793020201", "1927930206", "1927326104", "1927881101", "1927881103", "1927930801", "1927930802", "1927930803", "1927930804", "192744140302", "192769010102", "192769010103", "192788110401", "192788110402", "192788110601", "192788110602", "192793010401", "192793010402", "192793080101", "192793080201", "19276939010203", "192472540409", "192759010202", "192472540414", "192739030308"
];
const evaluationSet = new Set(evaluationReadableIds);
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-30-holdout-evaluation-20260823.json");
const client = await pool.connect();
try {
  const supportedWorkCenterProcessPairs = new Set((await client.query(`SELECT "processId", "workCenterId" FROM "workCenterProcess" WHERE "companyId" = $1`, [companyId])).rows.map((row: any) => workCenterProcessPairKey({ processId: row.processId, workCenterId: row.workCenterId })));
  const sampleRows = (await client.query(`
    SELECT "id", "itemId", "makeMethodId", "itemSnapshot", "operationSnapshot", "drawingDocumentIds", "materialTags", "featureTags", "processTags", "resourceTags", "status"::text AS "status", "datasetRole"::text AS "datasetRole"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1 AND "status" = 'Approved'::"aiRoutingSampleStatus" AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
    ORDER BY "updatedAt" DESC
  `, [companyId])).rows;
  const samples = sampleRows.map((row: any) => sampleFromRow(row));
  const itemRows = (await client.query(`
    SELECT "id", "readableId", "readableIdWithRevision", "name", "description"
    FROM "item"
    WHERE "companyId" = $1 AND "readableId" = ANY($2::text[])
  `, [companyId, evaluationReadableIds])).rows;
  const itemsByReadable = new Map(itemRows.map((item: any) => [item.readableId, item]));
  const itemIds = itemRows.map((item: any) => item.id);
  if (itemRows.length !== evaluationReadableIds.length) throw new Error(`Expected ${evaluationReadableIds.length} items, found ${itemRows.length}`);
  const evaluationSampleRows = (await client.query(`
    SELECT "id", "itemId", "operationSnapshot"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
      AND "itemId" = ANY($2::text[])
      AND "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole"
      AND "status" = 'Approved'::"aiRoutingSampleStatus"
      AND "lockedAt" IS NOT NULL
    ORDER BY "itemId", "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `, [companyId, itemIds])).rows;
  const evaluationSampleByItem = new Map(evaluationSampleRows.map((row: any) => [row.itemId, row]));
  const extractionRows = (await client.query(`
    SELECT DISTINCT ON ("itemId") "id", "itemId", "documentId", "completedAt", "createdAt", "extraction"
    FROM "aiDrawingExtraction"
    WHERE "companyId" = $1 AND "itemId" = ANY($2::text[]) AND "status" = 'Succeeded'::"aiDrawingExtractionStatus" AND jsonb_typeof("extraction") = 'object'
    ORDER BY "itemId", "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `, [companyId, itemIds])).rows;
  const latestExtractionByItem = new Map(extractionRows.map((row: any) => [row.itemId, row]));
  const routeRows = (await client.query(`
    SELECT jmm."id" AS "jobMakeMethodId", jmm."itemId", jmm."jobId", j."jobId" AS "jobReadableId", j."createdAt" AS "jobCreatedAt", jo."id", jo."order", jo."operationOrder"::text AS "operationOrder", jo."operationType"::text AS "operationType", jo."processId", process."name" AS "processName", jo."workCenterId", workCenter."name" AS "workCenterName", jo."description", jo."setupTime", jo."setupUnit"::text AS "setupUnit", jo."laborTime", jo."laborUnit"::text AS "laborUnit", jo."machineTime", jo."machineUnit"::text AS "machineUnit", jo."customFields"
    FROM "jobMakeMethod" jmm
    JOIN "job" j ON j."companyId" = jmm."companyId" AND j."id" = jmm."jobId"
    JOIN "jobOperation" jo ON jo."companyId" = jmm."companyId" AND jo."jobMakeMethodId" = jmm."id"
    LEFT JOIN "process" process ON process."companyId" = jo."companyId" AND process."id" = jo."processId"
    LEFT JOIN "workCenter" workCenter ON workCenter."companyId" = jo."companyId" AND workCenter."id" = jo."workCenterId"
    WHERE jmm."companyId" = $1 AND jmm."itemId" = ANY($2::text[])
    ORDER BY jmm."itemId", j."createdAt" DESC, jmm."id", jo."order", jo."id"
  `, [companyId, itemIds])).rows;
  const routesByItem = new Map<string, Map<string, Array<Record<string, unknown>>>>();
  for (const row of routeRows) {
    const itemId = String(row.itemId);
    const methodId = String(row.jobMakeMethodId);
    let methods = routesByItem.get(itemId);
    if (!methods) { methods = new Map(); routesByItem.set(itemId, methods); }
    const operations = methods.get(methodId) ?? [];
    operations.push(row);
    methods.set(methodId, operations);
  }
  const validProcessIds = new Set((await client.query(`SELECT "id" FROM "process" WHERE "companyId" = $1`, [companyId])).rows.map((row: any) => row.id));
  const results = [];
  for (const readableId of evaluationReadableIds) {
    const item = itemsByReadable.get(readableId) as any;
    if (!item) throw new Error(`Missing item ${readableId}`);
    const extraction = latestExtractionByItem.get(item.id) as any;
    if (!extraction) throw new Error(`Missing succeeded extraction ${readableId}`);
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: String(extraction.id),
      itemId: item.id,
      item: { readableId: item.readableIdWithRevision ?? item.readableId, name: item.name, description: item.description },
      drawingExtraction: extraction.extraction
    });
    const draft = generateAiRoutingDraft({ target, samples });
    const evaluationSample = evaluationSampleByItem.get(item.id) as any;
    const selectedRoute = {
      operations: Array.isArray(evaluationSample?.operationSnapshot)
        ? evaluationSample.operationSnapshot.map(operationFromSnapshot)
        : []
    };
    if (selectedRoute.operations.length === 0) throw new Error(`Missing locked Evaluation route snapshot ${readableId}`);
    const processIds = Array.from(new Set(draft.suggestedOperations.map((operation) => operation.processId).filter((value): value is string => Boolean(value))));
    const invalidProcessIds = processIds.filter((processId) => !validProcessIds.has(processId));
    const evaluationLeaks = draft.references.filter((reference) => reference.readableId ? evaluationSet.has(reference.readableId) : false);
    const workCenterAssignments = draft.suggestedOperations.filter((operation) => operation.workCenterId || operation.workCenterName);
    const unsupportedWorkCenterAssignments = draft.suggestedOperations.filter((operation) => {
      if (!operation.workCenterId) return false;
      if (!operation.processId) return true;
      return !supportedWorkCenterProcessPairs.has(workCenterProcessPairKey({ processId: operation.processId, workCenterId: operation.workCenterId }));
    });
    const missingProcessIdCount = draft.suggestedOperations.filter((operation) => !operation.processId).length;
    results.push({
      readableId,
      targetExtractionId: extraction.id,
      targetDrawingEvidenceCount: target.drawingEvidence?.length ?? 0,
      targetFeatureTags: target.featureTags,
      trainingSampleCount: samples.length,
      routeCandidateCount: 1,
      actualRouteSignature: routeSignature(selectedRoute.operations),
      suggestedRouteSignature: routeSignature(draft.suggestedOperations),
      comparison: compareRoutes(selectedRoute.operations, draft.suggestedOperations),
      warningCount: draft.warnings.length,
      warnings: draft.warnings,
      referenceCount: draft.references.length,
      topReferences: draft.references.slice(0, 5).map((reference) => ({ sampleId: reference.sampleId, readableId: reference.readableId, score: reference.score, matchedDrawingEvidenceCount: reference.matchedDrawingEvidence?.length ?? 0 })),
      evaluationLeakCount: evaluationLeaks.length,
      workCenterAssignmentCount: workCenterAssignments.length,
      unsupportedWorkCenterAssignmentCount: unsupportedWorkCenterAssignments.length,
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
    totalUnsupportedWorkCenterAssignments: results.reduce((sum, result) => sum + result.unsupportedWorkCenterAssignmentCount, 0),
    totalMissingProcessIds: results.reduce((sum, result) => sum + result.missingProcessIdCount, 0),
    invalidProcessIds: Array.from(new Set(results.flatMap((result) => result.invalidProcessIds))),
    productionGate: { eligible: evaluationReadableIds.length >= 30, minimumHoldouts: 30, reason: evaluationReadableIds.length >= 30 ? null : `Requires at least 30 representative holdouts; evaluated ${evaluationReadableIds.length}.` },
    results
  };
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
  if (summary.totalEvaluationLeaks > 0 || summary.totalWorkCenterAssignments > 0 || summary.totalUnsupportedWorkCenterAssignments > 0 || summary.totalMissingProcessIds > 0 || summary.invalidProcessIds.length > 0) process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}
