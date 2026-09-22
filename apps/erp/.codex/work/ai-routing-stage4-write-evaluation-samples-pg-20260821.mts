import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}
function operationFromRow(row: Record<string, unknown>) {
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
    customFields: row.customFields ?? null
  };
}
function routeSignature(operations: Array<Record<string, unknown>>) {
  return operations
    .slice()
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((operation) => `${operation.order ?? "?"}:${operation.description ?? operation.processName ?? operation.processId ?? "Unnamed"}`)
    .join(" -> ");
}
function buildJobRouteSample(args: { companyId: string; item: Record<string, unknown>; jobMakeMethod: Record<string, unknown>; operations: Array<Record<string, unknown>>; documents: Array<Record<string, unknown>> }) {
  if (args.jobMakeMethod.itemId !== args.item.id) return { data: null, error: "job_route_item_mismatch" };
  const operations = args.operations.map(operationFromRow).sort((a, b) => a.order - b.order);
  if (operations.length === 0) return { data: null, error: "job_route_operations_missing" };
  const itemText = [args.item.readableId, args.item.readableIdWithRevision, args.item.name, args.item.description, JSON.stringify(args.item.customFields ?? {})].join(" ");
  const operationText = operations.map((operation) => [operation.processName, operation.description].join(" ")).join(" ");
  return {
    data: {
      id: `${args.companyId}:job-route:${args.jobMakeMethod.id}`,
      itemId: String(args.item.id),
      readableId: stringValue(args.item.readableIdWithRevision) ?? stringValue(args.item.readableId),
      name: stringValue(args.item.name),
      makeMethodId: null,
      documentIds: args.documents.map((document) => stringValue(document.id)).filter((id): id is string => Boolean(id)),
      operations,
      status: "Approved",
      datasetRole: "Evaluation",
      materialTags: unique(matchingTags(itemText, materialPatterns)),
      featureTags: unique([...matchingTags(itemText, featurePatterns), ...matchingTags(operationText, featurePatterns)]),
      processTags: unique(matchingTags(operationText, processPatterns)),
      resourceTags: unique(operations.flatMap((operation) => [operation.workCenterName, operation.workCenterId]))
    },
    error: null
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
const partIds = [
  "1927326104", "1927881101", "1927881103", "1927930801", "1927930802", "1927930803", "1927930804", "192744140302", "192769010102", "192769010103", "192788110401", "192788110402", "192788110601", "192788110602", "192793010401", "192793010402", "192793080101", "192793080201", "19276939010203"
];
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-stage4-evaluation-sample-write-20260821.json");
const client = await pool.connect();
try {
  const beforeCounts = (await client.query(`
    SELECT "datasetRole"::text AS role, COUNT(*)::int AS count
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
    GROUP BY "datasetRole"::text
    ORDER BY role
  `, [companyId])).rows;
  const items = (await client.query(`
    SELECT "id", "readableId", "readableIdWithRevision", "name", "description", "notes" AS "customFields", "createdBy"
    FROM "item"
    WHERE "companyId" = $1 AND "readableId" = ANY($2::text[])
  `, [companyId, partIds])).rows;
  const itemsByReadable = new Map(items.map((item: any) => [item.readableId, item]));
  if (items.length !== partIds.length) throw new Error(`Expected ${partIds.length} items, found ${items.length}`);
  const itemIds = items.map((item: any) => item.id);
  const documents = (await client.query(`
    SELECT "id", "name", "path", "extension", "type", "sourceDocument", "sourceDocumentId", "active"
    FROM "document"
    WHERE "companyId" = $1
      AND "sourceDocument" = 'Part'
      AND "sourceDocumentId" = ANY($2::text[])
      AND "active" IS TRUE
      AND "type" = 'PDF'
      AND LOWER("extension") = 'pdf'
    ORDER BY "createdAt" DESC, "id" ASC
  `, [companyId, itemIds])).rows;
  const documentsByItem = new Map<string, Array<Record<string, unknown>>>();
  for (const document of documents) {
    const itemId = String(document.sourceDocumentId);
    const rows = documentsByItem.get(itemId) ?? [];
    rows.push(document);
    documentsByItem.set(itemId, rows);
  }
  const extractions = (await client.query(`
    SELECT "id", "itemId", "documentId", "status"::text AS "status", "contentHash", "rendererVersion", "extractorSchemaVersion", "promptVersion", "modelProvider", "modelName", "pageCount", "completedAt", "updatedAt", "createdAt", "extraction"
    FROM "aiDrawingExtraction"
    WHERE "companyId" = $1
      AND "itemId" = ANY($2::text[])
      AND "status" = 'Succeeded'::"aiDrawingExtractionStatus"
    ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
  `, [companyId, itemIds])).rows;
  const extractionsByItem = new Map<string, Array<Record<string, unknown>>>();
  for (const extraction of extractions) {
    const rows = extractionsByItem.get(extraction.itemId) ?? [];
    rows.push(extraction);
    extractionsByItem.set(extraction.itemId, rows);
  }
  const routeRows = (await client.query(`
    SELECT
      jmm."id" AS "jobMakeMethodId",
      jmm."itemId",
      jmm."jobId",
      j."jobId" AS "jobReadableId",
      j."createdAt" AS "jobCreatedAt",
      jo."id",
      jo."order",
      jo."operationOrder"::text AS "operationOrder",
      jo."operationType"::text AS "operationType",
      jo."processId",
      process."name" AS "processName",
      jo."workCenterId",
      workCenter."name" AS "workCenterName",
      jo."description",
      jo."setupTime",
      jo."setupUnit"::text AS "setupUnit",
      jo."laborTime",
      jo."laborUnit"::text AS "laborUnit",
      jo."machineTime",
      jo."machineUnit"::text AS "machineUnit",
      jo."customFields"
    FROM "jobMakeMethod" jmm
    JOIN "job" j ON j."companyId" = jmm."companyId" AND j."id" = jmm."jobId"
    JOIN "jobOperation" jo ON jo."companyId" = jmm."companyId" AND jo."jobMakeMethodId" = jmm."id"
    LEFT JOIN "process" process ON process."companyId" = jo."companyId" AND process."id" = jo."processId"
    LEFT JOIN "workCenter" workCenter ON workCenter."companyId" = jo."companyId" AND workCenter."id" = jo."workCenterId"
    WHERE jmm."companyId" = $1 AND jmm."itemId" = ANY($2::text[])
    ORDER BY jmm."itemId", j."createdAt" DESC, jmm."id", jo."order", jo."id"
  `, [companyId, itemIds])).rows;
  const routesByItem = new Map<string, Map<string, { method: Record<string, unknown>; operations: Array<Record<string, unknown>> }>>();
  for (const row of routeRows) {
    const itemId = String(row.itemId);
    const methodId = String(row.jobMakeMethodId);
    let routes = routesByItem.get(itemId);
    if (!routes) { routes = new Map(); routesByItem.set(itemId, routes); }
    let route = routes.get(methodId);
    if (!route) {
      route = { method: { id: methodId, itemId, jobId: row.jobId, jobReadableId: row.jobReadableId }, operations: [] };
      routes.set(methodId, route);
    }
    route.operations.push(row);
  }
  const readiness: Array<Record<string, unknown>> = [];
  for (const readableId of partIds) {
    const item = itemsByReadable.get(readableId) as Record<string, unknown> | undefined;
    const itemId = String(item?.id ?? "");
    const itemDocuments = documentsByItem.get(itemId) ?? [];
    const itemExtractions = extractionsByItem.get(itemId) ?? [];
    const routeCandidates = Array.from(routesByItem.get(itemId)?.values() ?? []).filter((route) => route.operations.length > 0);
    const signatures = Array.from(new Set(routeCandidates.map((route) => routeSignature(route.operations))));
    let drawingSnapshotCount = 0;
    let drawingReady = true;
    try {
      for (const document of itemDocuments) {
        const extraction = itemExtractions.find((row) => {
          const payload = asRecord(row.extraction);
          const docPayload = asRecord(payload.document);
          return row.documentId === document.id && row.contentHash === docPayload.contentHash && row.extractorSchemaVersion === payload.schemaVersion && row.promptVersion === "ai-routing-drawing.prompt.v2";
        });
        if (!extraction) throw new Error("current_v2_extraction_missing");
        drawingSnapshotCount += 1;
      }
      if (itemDocuments.length === 0) throw new Error("active_pdf_missing");
    } catch {
      drawingReady = false;
    }
    readiness.push({ readableId, itemId, documentCount: itemDocuments.length, drawingReady, drawingSnapshotCount, routeCandidateCount: routeCandidates.length, distinctRouteSignatureCount: signatures.length, selectedRouteOperationCount: routeCandidates[0]?.operations.length ?? 0 });
  }
  const notReady = readiness.filter((row) => !row.drawingReady || row.routeCandidateCount !== 1 && row.distinctRouteSignatureCount !== 1);
  if (notReady.length > 0) {
    throw new Error(`Stage 4 sample write readiness failed: ${JSON.stringify(notReady)}`);
  }
  const writeResults: Array<Record<string, unknown>> = [];
  await client.query('BEGIN');
  try {
    for (const readableId of partIds) {
      const item = itemsByReadable.get(readableId) as Record<string, unknown>;
      const itemId = String(item.id);
      const itemDocuments = documentsByItem.get(itemId) ?? [];
      const itemExtractions = extractionsByItem.get(itemId) ?? [];
      const routeCandidates = Array.from(routesByItem.get(itemId)?.values() ?? []).filter((route) => route.operations.length > 0);
      const selectedRoute = routeCandidates[0];
      const signatures = Array.from(new Set(routeCandidates.map((route) => routeSignature(route.operations))));
      if (!selectedRoute || signatures.length !== 1) throw new Error(`Route signature gate failed for ${readableId}`);
      const sampleResult = buildJobRouteSample({ companyId, item, jobMakeMethod: selectedRoute.method, operations: selectedRoute.operations, documents: itemDocuments });
      if (!sampleResult.data) throw new Error(`Sample build failed for ${readableId}: ${sampleResult.error}`);
      const sample = sampleResult.data;
      const drawingSnapshot = itemDocuments.map((document) => {
        const extraction = itemExtractions.find((row) => {
          const payload = asRecord(row.extraction);
          const docPayload = asRecord(payload.document);
          return row.documentId === document.id && row.contentHash === docPayload.contentHash && row.extractorSchemaVersion === payload.schemaVersion && row.promptVersion === "ai-routing-drawing.prompt.v2";
        });
        if (!extraction) throw new Error(`Current v2 extraction missing for ${readableId}`);
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
      const operationSnapshot = selectedRoute.operations.map(operationFromRow).sort((a, b) => a.order - b.order);
      const { createdBy: itemCreatedBy, ...itemSnapshot } = item;
      const userId = process.env.U8_CARBON_USER_ID || stringValue(itemCreatedBy);
      if (!userId) throw new Error(`User id missing for ${readableId}`);
      const existing = (await client.query(`
        SELECT "id", "datasetRole"::text AS "datasetRole", "lockedAt", "lockedBy"
        FROM "aiRoutingSample"
        WHERE "companyId" = $1 AND "id" = $2
        FOR UPDATE
      `, [companyId, sample.id])).rows[0];
      if (existing?.lockedAt) {
        if (existing.datasetRole !== "Evaluation") throw new Error(`Locked sample role mismatch for ${readableId}`);
        writeResults.push({ readableId, role: "Evaluation", sampleId: sample.id, operationCount: operationSnapshot.length, drawingSnapshotCount: drawingSnapshot.length, action: "KeptLocked" });
        continue;
      }
      const now = new Date().toISOString();
      if (existing) {
        await client.query(`
          UPDATE "aiRoutingSample"
          SET "itemSnapshot" = $3::jsonb,
              "drawingDocumentIds" = $4::text[],
              "drawingSnapshot" = $5::jsonb,
              "operationSnapshot" = $6::jsonb,
              "materialTags" = $7::text[],
              "featureTags" = $8::text[],
              "processTags" = $9::text[],
              "resourceTags" = $10::text[],
              "ontologySnapshot" = NULL,
              "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole",
              "status" = 'Approved'::"aiRoutingSampleStatus",
              "lockedAt" = COALESCE("lockedAt", $11::timestamptz),
              "lockedBy" = COALESCE("lockedBy", $12),
              "updatedBy" = $12,
              "updatedAt" = $11::timestamptz
          WHERE "companyId" = $1 AND "id" = $2 AND ("lockedAt" IS NULL OR "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole")
        `, [companyId, sample.id, JSON.stringify(itemSnapshot), sample.documentIds, JSON.stringify(drawingSnapshot), JSON.stringify(operationSnapshot), sample.materialTags, sample.featureTags, sample.processTags, sample.resourceTags, now, userId]);
        writeResults.push({ readableId, role: "Evaluation", sampleId: sample.id, operationCount: operationSnapshot.length, drawingSnapshotCount: drawingSnapshot.length, action: "Updated" });
      } else {
        await client.query(`
          INSERT INTO "aiRoutingSample" (
            "id", "companyId", "itemId", "makeMethodId", "source", "status", "datasetRole", "itemSnapshot", "drawingDocumentIds", "drawingSnapshot", "operationSnapshot", "materialTags", "featureTags", "processTags", "resourceTags", "ontologySnapshot", "createdBy", "updatedBy", "updatedAt", "lockedAt", "lockedBy"
          ) VALUES (
            $1, $2, $3, NULL, 'u8-job-route', 'Approved'::"aiRoutingSampleStatus", 'Evaluation'::"aiRoutingDatasetRole", $4::jsonb, $5::text[], $6::jsonb, $7::jsonb, $8::text[], $9::text[], $10::text[], $11::text[], NULL, $12, $12, $13::timestamptz, $13::timestamptz, $12
          )
        `, [sample.id, companyId, sample.itemId, JSON.stringify(itemSnapshot), sample.documentIds, JSON.stringify(drawingSnapshot), JSON.stringify(operationSnapshot), sample.materialTags, sample.featureTags, sample.processTags, sample.resourceTags, userId, now]);
        writeResults.push({ readableId, role: "Evaluation", sampleId: sample.id, operationCount: operationSnapshot.length, drawingSnapshotCount: drawingSnapshot.length, action: "Inserted" });
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  const afterCounts = (await client.query(`
    SELECT "datasetRole"::text AS role, COUNT(*)::int AS count
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
    GROUP BY "datasetRole"::text
    ORDER BY role
  `, [companyId])).rows;
  const output = { companyId, wrote: writeResults.length, readiness, beforeCounts, afterCounts, writeResults };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  if (writeResults.length !== 19) process.exitCode = 2;
} finally {
  client.release();
  await pool.end();
}
