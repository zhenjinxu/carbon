import { readFileSync, writeFileSync } from "node:fs";
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
function routeNames(operations: AiRoutingOperation[]) {
  return operations.slice().sort((a, b) => a.order - b.order).map((operation) => operation.processName ?? operation.description ?? operation.processId ?? "Unnamed");
}
function operationTags(operation: AiRoutingOperation) {
  return routingKnowledgeTags({ operations: [operation] }).processTags;
}
function draftSummary(target: any, samples: AiRoutingSample[], limit?: number) {
  const draft = generateAiRoutingDraft({ target, samples, limit });
  return {
    route: routeNames(draft.suggestedOperations),
    processTags: draft.suggestedOperations.map((operation) => ({ name: operation.processName, tags: operationTags(operation), sourceSampleId: operation.sourceSampleId })),
    warnings: draft.warnings,
    refs: draft.references.slice(0, 12).map((reference) => ({ id: reference.readableId, score: reference.score, matched: reference.matched, evidence: reference.matchedDrawingEvidence?.length ?? 0 }))
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
const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const targetReadableIds = ["1927930804", "1927930206", "192769010102", "192788110601", "192788110602", "192472540409", "19276939010203", "192472540414", "192739030308", "1927326104", "1927881101", "192788110401", "192788110402", "192759010202"];
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-rank-pool-diagnostics-20260824.json");
const client = await pool.connect();
try {
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
  `, [companyId, targetReadableIds])).rows;
  const itemsByReadable = new Map(itemRows.map((item: any) => [item.readableId, item]));
  const itemIds = itemRows.map((item: any) => item.id);
  const evaluationRows = (await client.query(`
    SELECT "itemId", "operationSnapshot"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1 AND "itemId" = ANY($2::text[]) AND "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole" AND "status" = 'Approved'::"aiRoutingSampleStatus" AND "lockedAt" IS NOT NULL
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `, [companyId, itemIds])).rows;
  const evaluationByItem = new Map(evaluationRows.map((row: any) => [row.itemId, row]));
  const extractionRows = (await client.query(`
    SELECT DISTINCT ON ("itemId") "id", "itemId", "extraction"
    FROM "aiDrawingExtraction"
    WHERE "companyId" = $1 AND "itemId" = ANY($2::text[]) AND "status" = 'Succeeded'::"aiDrawingExtractionStatus" AND jsonb_typeof("extraction") = 'object'
    ORDER BY "itemId", "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `, [companyId, itemIds])).rows;
  const extractionByItem = new Map(extractionRows.map((row: any) => [row.itemId, row]));
  const results = [];
  for (const readableId of targetReadableIds) {
    const item = itemsByReadable.get(readableId) as any;
    const extraction = extractionByItem.get(item.id) as any;
    const target = aiRoutingTargetEvidenceFromDrawing({
      id: String(extraction.id),
      itemId: item.id,
      item: { readableId: item.readableIdWithRevision ?? item.readableId, name: item.name, description: item.description },
      drawingExtraction: extraction.extraction
    });
    const actual = (evaluationByItem.get(item.id) as any)?.operationSnapshot?.map(operationFromSnapshot) ?? [];
    const ranked20 = rankSimilarRoutingSamples({ target, samples, limit: 20 });
    results.push({
      readableId,
      target: {
        materialTags: target.materialTags,
        featureTags: target.featureTags,
        processHints: target.processHints,
        drawingEvidenceKinds: (target.drawingEvidence ?? []).reduce((acc: Record<string, number>, fact) => { acc[fact.kind] = (acc[fact.kind] ?? 0) + 1; return acc; }, {})
      },
      actualRoute: routeNames(actual),
      defaultDraft: draftSummary(target, samples),
      limit20Draft: draftSummary(target, samples, 20),
      ranked20: ranked20.map((candidate) => ({
        id: candidate.readableId,
        score: candidate.score,
        matched: candidate.matched,
        evidence: candidate.matchedDrawingEvidence.length,
        operations: routeNames(candidate.sample.operations),
        operationTags: candidate.sample.operations.map((operation) => ({ name: operation.processName, tags: operationTags(operation) }))
      }))
    });
  }
  const output = { companyId, inspectedAt: new Date().toISOString(), trainingSampleCount: samples.length, results };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  client.release();
  await pool.end();
}