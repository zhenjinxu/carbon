#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const PART_IDS = [
  "192472540409",
  "192759010202",
  "192472540414",
  "192739030308"
];
const COMPANY_ID = process.env.AI_ROUTING_COMPANY_ID || "d8s9bh4f8gm357312pbg";
const PROMPT_VERSION = "ai-routing-drawing.prompt.v2";
const MODE = process.argv.includes("--commit")
  ? "commit"
  : process.argv.includes("--rollback")
    ? "rollback"
    : "dry-run";

function findRoot(start) {
  let current = start;
  for (;;) {
    const packagePath = path.join(current, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        if (pkg && pkg.name === "carbon") return current;
      } catch {}
    }
    const parent = path.dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const carbonRoot = findRoot(__dirname);
const env = {
  ...parseEnvFile(path.join(carbonRoot, ".env")),
  ...parseEnvFile(path.join(carbonRoot, ".env.local")),
  ...parseEnvFile(path.join(carbonRoot, "apps", "erp", ".env.local")),
  ...process.env
};

if (!env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");
const { Pool } = require(path.join(carbonRoot, "packages", "database", "node_modules", "pg"));
const outputPath = process.env.AI_ROUTING_STAGE4_30_EVALUATION_SAMPLE_OUTPUT_PATH
  ? path.resolve(carbonRoot, process.env.AI_ROUTING_STAGE4_30_EVALUATION_SAMPLE_OUTPUT_PATH)
  : path.join(
      carbonRoot,
      "apps",
      "erp",
      ".codex",
      "work",
      "ai-routing-stage4-30-gate-evaluation-sample-write-20260821.json"
    );

function stringValue(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function unique(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0).map((value) => value.trim())));
}
function matchingTags(text, patterns) {
  return patterns.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

const materialPatterns = [
  ["304", /\b304\b|sus304|不锈钢304/i],
  ["316", /\b316\b|sus316|不锈钢316/i],
  ["铝", /铝|aluminium|aluminum/i],
  ["不锈钢", /不锈钢|stainless/i],
  ["碳钢", /碳钢|carbon steel/i]
];
const featurePatterns = [
  ["板件", /板|板件|sheet|plate/i],
  ["孔", /孔|攻丝|钻|hole|thread|tap/i],
  ["轴", /轴|shaft/i],
  ["管", /管|tube/i],
  ["折弯", /折弯|bend/i],
  ["表面处理", /氧化|阳极|表面|finish|anodiz/i]
];
const processPatterns = [
  ["领料", /领料|material issue/i],
  ["激光切割", /激光|laser/i],
  ["折弯", /折弯|bend/i],
  ["锯床", /锯床|片锯|saw/i],
  ["车削", /车床|车削|lathe|turn/i],
  ["铣削", /铣|加工中心|mill|machining center/i],
  ["钻孔", /钻床|钻孔|drill/i],
  ["攻丝", /攻丝|tap|thread/i],
  ["氧化", /氧化|阳极|anodiz/i],
  ["焊接", /焊|weld/i],
  ["打磨", /打磨|拉丝|抛光|grind|brush|polish/i]
];

function operationFromRow(row) {
  return {
    id: stringValue(row.id) || undefined,
    order: Number(row.order || 0),
    processId: stringValue(row.processId),
    processName: stringValue(row.processName),
    workCenterId: stringValue(row.workCenterId),
    workCenterName: stringValue(row.workCenterName),
    operationType: stringValue(row.operationType),
    operationOrder: stringValue(row.operationOrder),
    description: stringValue(row.description),
    setupTime: Number(row.setupTime || 0),
    setupUnit: stringValue(row.setupUnit),
    laborTime: Number(row.laborTime || 0),
    laborUnit: stringValue(row.laborUnit),
    machineTime: Number(row.machineTime || 0),
    machineUnit: stringValue(row.machineUnit),
    customFields: row.customFields || null
  };
}

function routeSignature(operations) {
  return operations
    .slice()
    .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
    .map((operation) => `${operation.order || "?"}:${operation.description || operation.processName || operation.processId || "Unnamed"}`)
    .join(" -> ");
}

function currentExtractionForDocument(document, extractions) {
  return extractions.find((row) => {
    const payload = asRecord(row.extraction);
    const documentPayload = asRecord(payload.document);
    return row.documentId === document.id &&
      row.status === "Succeeded" &&
      row.contentHash === documentPayload.contentHash &&
      row.extractorSchemaVersion === payload.schemaVersion &&
      row.promptVersion === PROMPT_VERSION;
  }) || null;
}

function buildSample({ item, method, documents, operations }) {
  const operationSnapshot = operations.map(operationFromRow).sort((a, b) => a.order - b.order);
  const itemText = [item.readableId, item.readableIdWithRevision, item.name, item.description, JSON.stringify(item.customFields || {})].join(" ");
  const operationText = operationSnapshot.map((operation) => [operation.processName, operation.description, operation.workCenterName].join(" ")).join(" ");
  return {
    id: `${COMPANY_ID}:${method.id}`,
    itemId: String(item.id),
    readableId: stringValue(item.readableIdWithRevision) || stringValue(item.readableId),
    name: stringValue(item.name),
    makeMethodId: String(method.id),
    documentIds: documents.map((document) => stringValue(document.id)).filter(Boolean),
    operations: operationSnapshot,
    status: "Approved",
    datasetRole: "Evaluation",
    materialTags: unique(matchingTags(itemText, materialPatterns)),
    featureTags: unique([...matchingTags(itemText, featurePatterns), ...matchingTags(operationText, featurePatterns)]),
    processTags: unique(matchingTags(operationText, processPatterns)),
    resourceTags: unique(operationSnapshot.flatMap((operation) => [operation.workCenterName, operation.workCenterId]))
  };
}

async function counts(client) {
  const roles = (await client.query(`
    SELECT "datasetRole"::text AS role, COUNT(*)::int AS count
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
    GROUP BY "datasetRole"::text
    ORDER BY role
  `, [COMPANY_ID])).rows;
  const lockedEvaluation = (await client.query(`
    SELECT COUNT(DISTINCT "itemId")::int AS count
    FROM "aiRoutingSample"
    WHERE "companyId" = $1
      AND "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole"
      AND "lockedAt" IS NOT NULL
      AND "status" = 'Approved'::"aiRoutingSampleStatus"
  `, [COMPANY_ID])).rows[0]?.count || 0;
  return { roles, lockedEvaluation };
}

async function main() {
  if (!["dry-run", "rollback", "commit"].includes(MODE)) throw new Error(`Unsupported mode ${MODE}`);
  const pool = new Pool({ connectionString: env.SUPABASE_DB_URL, max: 1 });
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const beforeCounts = await counts(client);
    const items = (await client.query(`
      SELECT "id", "readableId", "readableIdWithRevision", "name", "description", "notes" AS "customFields", "createdBy"
      FROM "item"
      WHERE "companyId" = $1 AND "type" = 'Part' AND "readableId" = ANY($2::text[])
      ORDER BY "readableId"
    `, [COMPANY_ID, PART_IDS])).rows;
    const itemsByReadable = new Map(items.map((item) => [item.readableId, item]));
    if (items.length !== PART_IDS.length) throw new Error(`Expected ${PART_IDS.length} items, found ${items.length}`);
    const itemIds = items.map((item) => item.id);

    const documents = (await client.query(`
      SELECT "id", "name", "path", "extension", "type", "sourceDocument", "sourceDocumentId", "active", "createdAt"
      FROM "document"
      WHERE "companyId" = $1
        AND "sourceDocument" = 'Part'
        AND "sourceDocumentId" = ANY($2::text[])
        AND COALESCE("active", true) = true
        AND "type" = 'PDF'
        AND LOWER("extension") = 'pdf'
      ORDER BY "createdAt" DESC, "id" ASC
    `, [COMPANY_ID, itemIds])).rows;
    const documentsByItem = new Map();
    for (const document of documents) {
      const rows = documentsByItem.get(document.sourceDocumentId) || [];
      rows.push(document);
      documentsByItem.set(document.sourceDocumentId, rows);
    }

    const extractions = (await client.query(`
      SELECT "id", "itemId", "documentId", "status"::text AS "status", "contentHash", "rendererVersion", "extractorSchemaVersion", "promptVersion", "modelProvider", "modelName", "pageCount", "completedAt", "updatedAt", "createdAt", "extraction"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = $1
        AND "itemId" = ANY($2::text[])
        AND "status" = 'Succeeded'::"aiDrawingExtractionStatus"
      ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC
    `, [COMPANY_ID, itemIds])).rows;
    const extractionsByItem = new Map();
    for (const extraction of extractions) {
      const rows = extractionsByItem.get(extraction.itemId) || [];
      rows.push(extraction);
      extractionsByItem.set(extraction.itemId, rows);
    }

    const methods = (await client.query(`
      SELECT "id", "itemId", "status"::text AS "status", "version", "customFields"
      FROM "makeMethod"
      WHERE "companyId" = $1
        AND "itemId" = ANY($2::text[])
        AND "status" = 'Active'::"makeMethodStatus"
      ORDER BY "itemId", "version" DESC, "id"
    `, [COMPANY_ID, itemIds])).rows;
    const methodsByItem = new Map();
    for (const method of methods) {
      const rows = methodsByItem.get(method.itemId) || [];
      rows.push(method);
      methodsByItem.set(method.itemId, rows);
    }

    const methodIds = methods.map((method) => method.id);
    const operations = methodIds.length === 0 ? [] : (await client.query(`
      SELECT mo."makeMethodId", mo."id", mo."order", mo."operationOrder"::text AS "operationOrder", mo."operationType"::text AS "operationType", mo."processId", p."name" AS "processName", mo."workCenterId", wc."name" AS "workCenterName", mo."description", mo."setupTime", mo."setupUnit"::text AS "setupUnit", mo."laborTime", mo."laborUnit"::text AS "laborUnit", mo."machineTime", mo."machineUnit"::text AS "machineUnit", mo."customFields"
      FROM "methodOperation" mo
      LEFT JOIN "process" p ON p."companyId" = mo."companyId" AND p."id" = mo."processId"
      LEFT JOIN "workCenter" wc ON wc."companyId" = mo."companyId" AND wc."id" = mo."workCenterId"
      WHERE mo."companyId" = $1 AND mo."makeMethodId" = ANY($2::text[])
      ORDER BY mo."makeMethodId", mo."order", mo."id"
    `, [COMPANY_ID, methodIds])).rows;
    const operationsByMethod = new Map();
    for (const operation of operations) {
      const rows = operationsByMethod.get(operation.makeMethodId) || [];
      rows.push(operation);
      operationsByMethod.set(operation.makeMethodId, rows);
    }

    const sampleRows = (await client.query(`
      SELECT "id", "itemId", "makeMethodId", "datasetRole"::text AS "datasetRole", "status"::text AS "status", "lockedAt", "lockedBy"
      FROM "aiRoutingSample"
      WHERE "companyId" = $1 AND "itemId" = ANY($2::text[])
      ORDER BY "itemId", "id"
    `, [COMPANY_ID, itemIds])).rows;
    const samplesByItem = new Map();
    for (const sample of sampleRows) {
      const rows = samplesByItem.get(sample.itemId) || [];
      rows.push(sample);
      samplesByItem.set(sample.itemId, rows);
    }

    const readiness = [];
    for (const readableId of PART_IDS) {
      const item = itemsByReadable.get(readableId);
      const itemDocuments = documentsByItem.get(item.id) || [];
      const itemExtractions = extractionsByItem.get(item.id) || [];
      const itemMethods = methodsByItem.get(item.id) || [];
      const method = itemMethods[0] || null;
      const methodOperations = method ? operationsByMethod.get(method.id) || [] : [];
      const itemSamples = samplesByItem.get(item.id) || [];
      const drawingSnapshots = [];
      const blockers = [];
      if (itemDocuments.length === 0) blockers.push("active_pdf_missing");
      for (const document of itemDocuments) {
        const extraction = currentExtractionForDocument(document, itemExtractions);
        if (!extraction) blockers.push(`current_v2_extraction_missing:${document.id}`);
        else drawingSnapshots.push({ document, extraction });
      }
      if (itemMethods.length !== 1) blockers.push(`active_method_count:${itemMethods.length}`);
      if (methodOperations.length === 0) blockers.push("active_method_operations_missing");
      if (itemSamples.some((sample) => sample.datasetRole === "Training")) blockers.push("existing_training_sample_would_leak");
      if (itemSamples.some((sample) => sample.datasetRole !== "Evaluation" && sample.lockedAt)) blockers.push("locked_non_evaluation_sample_exists");
      readiness.push({
        readableId,
        itemId: item.id,
        documentCount: itemDocuments.length,
        currentV2ExtractionCount: drawingSnapshots.length,
        activeMethodCount: itemMethods.length,
        activeMethodId: method ? method.id : null,
        operationCount: methodOperations.length,
        routeSignature: routeSignature(methodOperations),
        existingSampleRoles: unique(itemSamples.map((sample) => sample.datasetRole)),
        blockers
      });
    }

    const blocked = readiness.filter((row) => row.blockers.length > 0);
    if (blocked.length > 0) {
      const output = { generatedAt: new Date().toISOString(), mode: MODE, committed: false, companyId: COMPANY_ID, partIds: PART_IDS, beforeCounts, readiness, blocked, wrote: 0, writeResults: [] };
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
      console.log(JSON.stringify(output, null, 2));
      process.exitCode = 2;
      return;
    }

    const writeResults = [];
    if (MODE !== "dry-run") {
      await client.query("BEGIN");
      inTransaction = true;
      for (const readableId of PART_IDS) {
        const item = itemsByReadable.get(readableId);
        const method = methodsByItem.get(item.id)[0];
        const itemDocuments = documentsByItem.get(item.id) || [];
        const itemExtractions = extractionsByItem.get(item.id) || [];
        const methodOperations = operationsByMethod.get(method.id) || [];
        const sample = buildSample({ item, method, documents: itemDocuments, operations: methodOperations });
        const { createdBy, ...itemSnapshot } = item;
        const userId = env.U8_CARBON_USER_ID || stringValue(createdBy);
        if (!userId) throw new Error(`User id missing for ${readableId}`);
        const drawingSnapshot = itemDocuments.map((document) => {
          const extraction = currentExtractionForDocument(document, itemExtractions);
          if (!extraction) throw new Error(`Current v2 extraction missing for ${readableId}`);
          return {
            id: document.id,
            name: document.name || null,
            path: document.path || null,
            extension: document.extension || null,
            type: document.type || null,
            sourceDocument: document.sourceDocument || null,
            sourceDocumentId: document.sourceDocumentId || null,
            aiDrawingExtraction: {
              id: extraction.id,
              documentId: extraction.documentId,
              contentHash: extraction.contentHash,
              rendererVersion: extraction.rendererVersion || null,
              extractorSchemaVersion: extraction.extractorSchemaVersion,
              promptVersion: extraction.promptVersion || null,
              modelProvider: extraction.modelProvider || null,
              modelName: extraction.modelName || null,
              pageCount: extraction.pageCount || null,
              completedAt: extraction.completedAt || null
            }
          };
        });
        const operationSnapshot = methodOperations.map(operationFromRow).sort((a, b) => a.order - b.order);
        const existing = (await client.query(`
          SELECT "id", "datasetRole"::text AS "datasetRole", "lockedAt", "lockedBy"
          FROM "aiRoutingSample"
          WHERE "companyId" = $1 AND ("id" = $2 OR "makeMethodId" = $3)
          FOR UPDATE
        `, [COMPANY_ID, sample.id, sample.makeMethodId])).rows[0];
        if (existing && existing.datasetRole !== "Evaluation") throw new Error(`Refusing to convert non-Evaluation sample for ${readableId}`);
        const now = new Date().toISOString();
        if (existing) {
          await client.query(`
            UPDATE "aiRoutingSample"
            SET "itemSnapshot" = $4::jsonb,
                "drawingDocumentIds" = $5::text[],
                "drawingSnapshot" = $6::jsonb,
                "operationSnapshot" = $7::jsonb,
                "materialTags" = $8::text[],
                "featureTags" = $9::text[],
                "processTags" = $10::text[],
                "resourceTags" = $11::text[],
                "ontologySnapshot" = NULL,
                "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole",
                "status" = 'Approved'::"aiRoutingSampleStatus",
                "lockedAt" = COALESCE("lockedAt", $12::timestamptz),
                "lockedBy" = COALESCE("lockedBy", $13),
                "updatedBy" = $13,
                "updatedAt" = $12::timestamptz
            WHERE "companyId" = $1 AND "id" = $2 AND ("lockedAt" IS NULL OR "datasetRole" = 'Evaluation'::"aiRoutingDatasetRole")
          `, [COMPANY_ID, existing.id, sample.makeMethodId, JSON.stringify(itemSnapshot), sample.documentIds, JSON.stringify(drawingSnapshot), JSON.stringify(operationSnapshot), sample.materialTags, sample.featureTags, sample.processTags, sample.resourceTags, now, userId]);
          writeResults.push({ readableId, sampleId: existing.id, makeMethodId: sample.makeMethodId, operationCount: operationSnapshot.length, drawingSnapshotCount: drawingSnapshot.length, action: "UpdatedOrLocked" });
        } else {
          await client.query(`
            INSERT INTO "aiRoutingSample" (
              "id", "companyId", "itemId", "makeMethodId", "source", "status", "datasetRole", "itemSnapshot", "drawingDocumentIds", "drawingSnapshot", "operationSnapshot", "materialTags", "featureTags", "processTags", "resourceTags", "ontologySnapshot", "createdBy", "updatedBy", "updatedAt", "lockedAt", "lockedBy"
            ) VALUES (
              $1, $2, $3, $4, 'u8-part-route', 'Approved'::"aiRoutingSampleStatus", 'Evaluation'::"aiRoutingDatasetRole", $5::jsonb, $6::text[], $7::jsonb, $8::jsonb, $9::text[], $10::text[], $11::text[], $12::text[], NULL, $13, $13, $14::timestamptz, $14::timestamptz, $13
            )
          `, [sample.id, COMPANY_ID, sample.itemId, sample.makeMethodId, JSON.stringify(itemSnapshot), sample.documentIds, JSON.stringify(drawingSnapshot), JSON.stringify(operationSnapshot), sample.materialTags, sample.featureTags, sample.processTags, sample.resourceTags, userId, now]);
          writeResults.push({ readableId, sampleId: sample.id, makeMethodId: sample.makeMethodId, operationCount: operationSnapshot.length, drawingSnapshotCount: drawingSnapshot.length, action: "Inserted" });
        }
      }
      if (MODE === "commit") {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      inTransaction = false;
    }

    const afterCounts = await counts(client);
    const output = { generatedAt: new Date().toISOString(), mode: MODE, committed: MODE === "commit", companyId: COMPANY_ID, partIds: PART_IDS, beforeCounts, afterCounts, readiness, blocked: [], wrote: writeResults.length, writeResults, databaseMutationsPerformed: MODE === "commit", formalRouteWritesPerformed: false, draftWritesPerformed: false };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ mode: output.mode, committed: output.committed, wrote: output.wrote, beforeCounts: output.beforeCounts, afterCounts: output.afterCounts, outputPath }, null, 2));
    if (MODE !== "dry-run" && writeResults.length !== PART_IDS.length) process.exitCode = 2;
  } catch (error) {
    if (inTransaction) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

