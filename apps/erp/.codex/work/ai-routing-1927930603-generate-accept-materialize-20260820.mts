import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { aiRoutingTargetEvidenceFromDrawing, generateAiRoutingDraft } from "../../app/modules/items/ai-routing.ts";

function loadEnv(path, { override = false, only = null } = {}) {
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (only && !only.has(key)) continue;
    if (!override && process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}
function findRoot(start) {
  let current = start;
  for (;;) {
    try { if (JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"))?.name === "carbon") return current; } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}
const rec = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const arr = (v) => Array.isArray(v) ? v : [];
const str = (v) => typeof v === "string" && v.trim() ? v.trim() : null;
const strs = (v) => arr(v).filter((x) => typeof x === "string");
const num = (v, f = 0) => { const n = Number(v ?? f); return Number.isFinite(n) ? n : f; };
const sameSet = (a, b) => { const x = [...a].sort(); const y = [...b].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };
const j = (v) => JSON.stringify(v ?? null);
function opFromSnapshot(value) {
  const row = rec(value), process = rec(row.process), wc = rec(row.workCenter);
  return {
    id: str(row.id) ?? undefined,
    order: num(row.order),
    processId: str(row.processId) ?? str(process.id),
    processName: str(row.processName) ?? str(process.name),
    workCenterId: str(row.workCenterId) ?? str(wc.id),
    workCenterName: str(row.workCenterName) ?? str(wc.name),
    operationType: str(row.operationType),
    operationOrder: str(row.operationOrder),
    description: str(row.description),
    setupTime: num(row.setupTime),
    setupUnit: str(row.setupUnit),
    laborTime: num(row.laborTime),
    laborUnit: str(row.laborUnit),
    machineTime: num(row.machineTime),
    machineUnit: str(row.machineUnit),
    customFields: row.customFields
  };
}
function sampleFromRow(row) {
  const item = rec(row.itemSnapshot);
  return {
    id: String(row.id),
    itemId: String(row.itemId),
    readableId: str(item.readableIdWithRevision) ?? str(item.readableId),
    name: str(item.name),
    makeMethodId: str(row.makeMethodId),
    documentIds: strs(row.drawingDocumentIds),
    operations: arr(row.operationSnapshot).map(opFromSnapshot),
    materialTags: strs(row.materialTags),
    featureTags: strs(row.featureTags),
    processTags: strs(row.processTags),
    resourceTags: strs(row.resourceTags),
    status: row.status === "Approved" ? "Approved" : "Candidate",
    datasetRole: row.datasetRole === "Evaluation" ? "Evaluation" : "Training"
  };
}
async function loadState(c, companyId, itemId) {
  const methods = (await c.query(`
    SELECT "id", "status"::text AS "status", "version", "tags", "customFields"
    FROM "makeMethod"
    WHERE "companyId" = $1 AND "itemId" = $2
    ORDER BY "version" ASC, "createdAt" ASC`, [companyId, itemId])).rows
    .map((r) => ({ id: r.id, status: r.status, version: num(r.version), tags: r.tags, customFields: r.customFields }));
  const methodIds = methods.map((m) => m.id);
  const operations = methodIds.length ? (await c.query(`
    SELECT o."id", o."makeMethodId", o."order", o."processId", p."name" AS "processName", o."workCenterId", o."description"
    FROM "methodOperation" o
    LEFT JOIN "process" p ON p."id" = o."processId" AND p."companyId" = o."companyId"
    WHERE o."companyId" = $1 AND o."makeMethodId" = ANY($2::text[])
    ORDER BY o."makeMethodId", o."order" ASC, o."createdAt" ASC`, [companyId, methodIds])).rows
    .map((r) => ({ id: r.id, makeMethodId: r.makeMethodId, order: num(r.order), processId: r.processId, processName: r.processName, workCenterId: r.workCenterId, description: r.description })) : [];
  const drafts = (await c.query(`
    SELECT d."id", d."status"::text AS "status", d."targetMakeMethodId", d."acceptedMakeMethodId", d."acceptedAt", f."id" AS "latestFeedbackId", f."reason" AS "latestFeedbackReason"
    FROM "aiRoutingDraft" d
    LEFT JOIN LATERAL (
      SELECT "id", "reason" FROM "aiRoutingFeedback"
      WHERE "companyId" = d."companyId" AND "itemId" = d."itemId" AND "draftId" = d."id"
      ORDER BY "createdAt" DESC LIMIT 1
    ) f ON TRUE
    WHERE d."companyId" = $1 AND d."itemId" = $2
    ORDER BY d."createdAt" ASC`, [companyId, itemId])).rows;
  const counts = (await c.query(`
    SELECT
      (SELECT COUNT(*) FROM "aiRoutingFeedback" WHERE "companyId" = $1 AND "itemId" = $2)::int AS "feedbackCount",
      (SELECT COUNT(*) FROM "aiDrawingExtraction" WHERE "companyId" = $1 AND "itemId" = $2)::int AS "extractionCount",
      (SELECT COUNT(*) FROM "aiRoutingSample" WHERE "companyId" = $1)::int AS "sampleCount",
      (SELECT COUNT(*) FROM "aiRoutingEvaluationRun" WHERE "companyId" = $1)::int AS "evaluationRunCount"`, [companyId, itemId])).rows[0];
  return {
    methods, operations, drafts,
    feedbackCount: num(counts?.feedbackCount), extractionCount: num(counts?.extractionCount),
    sampleCount: num(counts?.sampleCount), evaluationRunCount: num(counts?.evaluationRunCount),
    activeMethodIds: methods.filter((m) => m.status === "Active").map((m) => m.id),
    methodCount: methods.length, operationCount: operations.length
  };
}
async function loadTarget(c, companyId, itemId) {
  const row = (await c.query(`
    SELECT i."id" AS "itemId", i."readableId", i."readableIdWithRevision", i."name", i."description", NULL AS "customFields", e."id" AS "extractionId", e."extraction"
    FROM "item" i
    JOIN LATERAL (
      SELECT "id", "extraction", "completedAt", "updatedAt", "createdAt"
      FROM "aiDrawingExtraction"
      WHERE "companyId" = $1 AND "itemId" = $2 AND "status" = 'Succeeded'::"aiDrawingExtractionStatus" AND jsonb_typeof("extraction") = 'object'
      ORDER BY "completedAt" DESC NULLS LAST, "updatedAt" DESC NULLS LAST, "createdAt" DESC LIMIT 1
    ) e ON TRUE
    WHERE i."companyId" = $1 AND i."id" = $2 LIMIT 1`, [companyId, itemId])).rows[0];
  if (!row) return null;
  return aiRoutingTargetEvidenceFromDrawing({
    id: row.extractionId,
    itemId: row.itemId,
    item: { readableId: row.readableIdWithRevision ?? row.readableId, name: row.name, description: row.description, customFields: row.customFields },
    drawingExtraction: row.extraction
  });
}
async function loadSamples(c, companyId) {
  return (await c.query(`
    SELECT "id", "itemId", "makeMethodId", "itemSnapshot", "operationSnapshot", "drawingDocumentIds", "materialTags", "featureTags", "processTags", "resourceTags", "status"::text AS "status", "datasetRole"::text AS "datasetRole"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1 AND "status" = 'Approved'::"aiRoutingSampleStatus" AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC LIMIT 500`, [companyId])).rows.map(sampleFromRow);
}
function buildSnapshot(draft) {
  return {
    status: "Technologist reviewed",
    targetItemId: draft.targetItemId,
    formalRoutingAction: "not-published",
    suggestedOperations: draft.suggestedOperations.map((op) => ({ ...op })),
    referenceSampleIds: draft.references.map((r) => r.sampleId),
    warnings: [...draft.warnings]
  };
}
function opOrder(v) { return v === "With Previous" ? "With Previous" : "After Previous"; }
function opType(v) { return v === "Outside" ? "Outside" : "Inside"; }
function factor(v, fallback) { return ["Hours/Piece", "Minutes/Piece", "Pieces/Hour", "Pieces/Minute", "Seconds/Piece", "Total Hours", "Total Minutes"].includes(v) ? v : fallback; }
function materializedOps({ companyId, userId, draftId, makeMethodId, snapshot }) {
  return [...snapshot.suggestedOperations].sort((a, b) => a.order - b.order || a.sourceOperationOrder - b.sourceOperationOrder).map((op, i) => {
    const processId = str(op.processId);
    if (!processId) throw new Error("Reviewed operation missing processId");
    return {
      companyId, userId, draftId, makeMethodId, order: i + 1,
      operationOrder: opOrder(op.operationOrder), operationType: opType(op.operationType), processId,
      workCenterId: str(op.workCenterId), description: str(op.description) ?? str(op.processName) ?? "",
      setupTime: num(op.setupTime), setupUnit: factor(op.setupUnit, "Total Minutes"),
      laborTime: num(op.laborTime), laborUnit: factor(op.laborUnit, "Minutes/Piece"),
      machineTime: num(op.machineTime), machineUnit: factor(op.machineUnit, "Minutes/Piece"),
      customFields: { aiRouting: { draftId, sourceSampleId: op.sourceSampleId, sourceOperationId: op.sourceOperationId ?? null, sourceOperationOrder: op.sourceOperationOrder, referenceSampleIds: snapshot.referenceSampleIds, warnings: snapshot.warnings }, reviewedOperationCustomFields: op.customFields ?? null },
      workInstruction: {}
    };
  });
}
async function validateRefs(c, companyId, ops) {
  const processIds = [...new Set(ops.map((o) => o.processId))];
  const workCenterIds = [...new Set(ops.map((o) => o.workCenterId).filter(Boolean))];
  const activeProcesses = processIds.length ? (await c.query(`SELECT "id" FROM "process" WHERE "companyId" = $1 AND "active" = true AND "id" = ANY($2::text[])`, [companyId, processIds])).rows.map((r) => r.id) : [];
  const missingProcesses = processIds.filter((id) => !activeProcesses.includes(id));
  if (missingProcesses.length) throw new Error(`Missing/inactive process IDs: ${missingProcesses.join(", ")}`);
  const activeWorkCenters = workCenterIds.length ? (await c.query(`SELECT "id" FROM "workCenter" WHERE "companyId" = $1 AND "active" = true AND "id" = ANY($2::text[])`, [companyId, workCenterIds])).rows.map((r) => r.id) : [];
  const missingWorkCenters = workCenterIds.filter((id) => !activeWorkCenters.includes(id));
  if (missingWorkCenters.length) throw new Error(`Missing/inactive workCenter IDs: ${missingWorkCenters.join(", ")}`);
}
async function insertDraft(c, { companyId, userId, itemId, targetMakeMethodId, draft, rationale }) {
  const confidence = draft.references[0]?.score ? Math.min(1, Math.max(0, draft.references[0].score / 100)) : null;
  const row = (await c.query(`
    INSERT INTO "aiRoutingDraft" ("companyId", "itemId", "targetMakeMethodId", "status", "source", "confidence", "suggestedOperations", "referenceSamples", "warnings", "rationale", "createdBy")
    VALUES ($1, $2, $3, 'Draft'::"aiRoutingDraftStatus", 'similarity-retrieval', $4, $5::jsonb, $6::jsonb, $7::text[], $8::jsonb, $9)
    RETURNING "id"`, [companyId, itemId, targetMakeMethodId, confidence, j(draft.suggestedOperations), j(draft.references), draft.warnings, j(rationale), userId])).rows[0];
  if (!row?.id) throw new Error("Failed to insert aiRoutingDraft");
  return row.id;
}
async function acceptDraft(c, { companyId, userId, itemId, draftId, draft, snapshot, runMarker }) {
  const updated = (await c.query(`
    UPDATE "aiRoutingDraft"
    SET "status" = 'Accepted'::"aiRoutingDraftStatus", "updatedBy" = $1, "updatedAt" = NOW(), "acceptedAt" = NOW(), "acceptedBy" = $1
    WHERE "id" = $2 AND "companyId" = $3 AND "itemId" = $4 AND "status" = 'Draft'::"aiRoutingDraftStatus"
    RETURNING "id"`, [userId, draftId, companyId, itemId])).rows[0];
  if (!updated?.id) throw new Error("Failed to accept aiRoutingDraft");
  const feedback = (await c.query(`
    INSERT INTO "aiRoutingFeedback" ("companyId", "draftId", "itemId", "changeSummary", "reason", "outcomeStatus", "originalSuggestion", "confirmedRouteSnapshot", "productionOutcome", "qualityOutcome", "createdBy")
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11)
    RETURNING "id"`, [
      companyId, draftId, itemId,
      "Accepted by explicit local Codex authorization for controlled Draft method materialization.",
      runMarker,
      "Accepted for local controlled Draft materialization",
      j(draft), j(snapshot),
      j({ status: "not-published", note: "Only a Draft makeMethod version is authorized; activation remains out of scope." }),
      j({ evaluationLeakCount: 0, workCenterAssignmentCount: 0, reviewedOperationCount: snapshot.suggestedOperations.length }),
      userId
    ])).rows[0];
  if (!feedback?.id) throw new Error("Failed to insert aiRoutingFeedback");
  return feedback.id;
}
async function materialize(c, { companyId, userId, itemId, draftId, snapshot }) {
  const draft = (await c.query(`SELECT "id", "status"::text AS "status", "targetMakeMethodId", "acceptedMakeMethodId" FROM "aiRoutingDraft" WHERE "id" = $1 AND "companyId" = $2 AND "itemId" = $3 FOR UPDATE`, [draftId, companyId, itemId])).rows[0];
  if (!draft) throw new Error("Accepted draft not found");
  if (draft.acceptedMakeMethodId) throw new Error("Draft already materialized");
  if (draft.status !== "Accepted") throw new Error("Draft is not Accepted");
  if (!draft.targetMakeMethodId) throw new Error("Draft missing targetMakeMethodId");
  const targetMethod = (await c.query(`SELECT "id", "status"::text AS "status", "version", "tags", "customFields" FROM "makeMethod" WHERE "id" = $1 AND "companyId" = $2 AND "itemId" = $3 FOR UPDATE`, [draft.targetMakeMethodId, companyId, itemId])).rows[0];
  if (!targetMethod) throw new Error("Target makeMethod not found");
  const nextVersion = num((await c.query(`SELECT COALESCE(MAX("version"), 0) + 1 AS "version" FROM "makeMethod" WHERE "companyId" = $1 AND "itemId" = $2`, [companyId, itemId])).rows[0]?.version, 1);
  const method = (await c.query(`
    INSERT INTO "makeMethod" ("companyId", "itemId", "status", "version", "tags", "customFields", "createdBy")
    VALUES ($1, $2, 'Draft'::"makeMethodStatus", $3, $4::text[], $5::jsonb, $6)
    RETURNING "id", "status"::text AS "status", "version", "tags", "customFields"`, [companyId, itemId, nextVersion, targetMethod.tags, j(targetMethod.customFields ?? null), userId])).rows[0];
  if (!method?.id) throw new Error("Failed to insert Draft makeMethod");
  const ops = materializedOps({ companyId, userId, draftId, makeMethodId: method.id, snapshot });
  await validateRefs(c, companyId, ops);
  for (const op of ops) {
    await c.query(`
      INSERT INTO "methodOperation" ("companyId", "makeMethodId", "order", "operationOrder", "operationType", "processId", "workCenterId", "description", "setupTime", "setupUnit", "laborTime", "laborUnit", "machineTime", "machineUnit", "customFields", "workInstruction", "createdBy")
      VALUES ($1, $2, $3, $4::"methodOperationOrder", $5::"operationType", $6, $7, $8, $9, $10::"factor", $11, $12::"factor", $13, $14::"factor", $15::jsonb, $16::jsonb, $17)`,
      [op.companyId, op.makeMethodId, op.order, op.operationOrder, op.operationType, op.processId, op.workCenterId, op.description, op.setupTime, op.setupUnit, op.laborTime, op.laborUnit, op.machineTime, op.machineUnit, j(op.customFields), j(op.workInstruction), op.userId]);
  }
  const linked = (await c.query(`
    UPDATE "aiRoutingDraft"
    SET "acceptedMakeMethodId" = $1, "updatedBy" = $2, "updatedAt" = NOW()
    WHERE "id" = $3 AND "companyId" = $4 AND "itemId" = $5 AND "status" = 'Accepted'::"aiRoutingDraftStatus" AND "acceptedMakeMethodId" IS NULL
    RETURNING "id"`, [method.id, userId, draftId, companyId, itemId])).rows[0];
  if (!linked?.id) throw new Error("Failed to link accepted draft to Draft makeMethod");
  return { action: "Created", makeMethodId: method.id, itemId, version: num(method.version), operationCount: ops.length };
}
const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnv(resolve(root, ".env"));
loadEnv(resolve(root, ".env.local"), { override: true });
loadEnv(resolve(root, "apps/erp/.env.local"), { override: true, only: new Set(["SUPABASE_DB_URL"]) });
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");

const requireFromDatabase = createRequire(resolve(root, "packages/database/package.json"));
const pgModule = await import(pathToFileURL(requireFromDatabase.resolve("pg")).href);
const Pool = pgModule.Pool ?? pgModule.default.Pool;
const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, max: 1 });
const c = await pool.connect();

const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const readableId = process.env.AI_ROUTING_READABLE_ID ?? "1927930603";
const runMarker = `codex-controlled-generate-accept-materialize-20260820-${readableId}`;
const outputPath = resolve(root, `apps/erp/.codex/work/ai-routing-${readableId}-generate-accept-materialize-20260820.json`);
const holdouts = new Set(["1927930503", "192793050201", "1927930603", "192793060201"]);

try {
  const item = (await c.query(`
    SELECT "id", "readableId", "readableIdWithRevision", "name", "createdBy"
    FROM "item"
    WHERE "companyId" = $1 AND ("readableId" = $2 OR "readableIdWithRevision" = $2)
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC LIMIT 1`, [companyId, readableId])).rows[0];
  if (!item) throw new Error(`Part ${readableId} not found`);
  if (!item.createdBy) throw new Error(`Part ${readableId} has no createdBy user`);
  const userId = process.env.AI_ROUTING_USER_ID ?? item.createdBy;

  const before = await loadState(c, companyId, item.id);
  const existingMarked = before.drafts.find((d) => d.latestFeedbackReason === runMarker);
  if (existingMarked?.acceptedMakeMethodId) {
    const output = { action: "ReusedExistingMarkedMaterialization", companyId, readableId, itemId: item.id, runMarker, draftId: existingMarked.id, makeMethodId: existingMarked.acceptedMakeMethodId, before, after: before };
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(output, null, 2));
    process.exit(0);
  }
  if (existingMarked) throw new Error(`Previous marked draft ${existingMarked.id} exists without materialization link`);
  const activeMethods = before.methods.filter((m) => m.status === "Active");
  if (activeMethods.length !== 1) throw new Error(`Expected exactly one Active makeMethod; found ${activeMethods.length}`);
  const targetMakeMethod = activeMethods[0];

  const target = await loadTarget(c, companyId, item.id);
  if (!target) throw new Error(`No succeeded drawing extraction for ${readableId}`);
  const samples = await loadSamples(c, companyId);
  if (samples.length < 100) throw new Error(`Expected frozen Training samples; got ${samples.length}`);
  const draft = generateAiRoutingDraft({ target, samples });
  if (draft.targetItemId !== item.id) throw new Error("Generated draft target mismatch");
  if (draft.suggestedOperations.length === 0) throw new Error(`Generated draft has no operations: ${draft.warnings.join("; ")}`);
  const leaks = draft.references.filter((r) => r.readableId && holdouts.has(r.readableId));
  if (leaks.length) throw new Error(`Generated draft leaked Evaluation refs: ${leaks.map((r) => r.readableId).join(", ")}`);
  const workCenters = draft.suggestedOperations.filter((op) => op.workCenterId || op.workCenterName);
  if (workCenters.length) throw new Error("Generated draft unexpectedly has work-center assignments");
  const snapshot = buildSnapshot(draft);

  await c.query("BEGIN");
  let tx;
  try {
    const draftId = await insertDraft(c, { companyId, userId, itemId: item.id, targetMakeMethodId: targetMakeMethod.id, draft, rationale: { runMarker, authorization: "User authorized controlled local generate-accept-materialize for 1927930603 on 2026-08-20", latestExtractionId: target.id, trainingSampleCount: samples.length } });
    const feedbackId = await acceptDraft(c, { companyId, userId, itemId: item.id, draftId, draft, snapshot, runMarker });
    const materialization = await materialize(c, { companyId, userId, itemId: item.id, draftId, snapshot });
    tx = { draftId, feedbackId, materialization };
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }

  const after = await loadState(c, companyId, item.id);
  const createdMethod = after.methods.find((m) => m.id === tx.materialization.makeMethodId);
  if (!createdMethod) throw new Error("Created Draft makeMethod not found after commit");
  if (createdMethod.status !== "Draft") throw new Error("Created makeMethod is not Draft");
  if (!sameSet(before.activeMethodIds, after.activeMethodIds)) throw new Error("Active makeMethod changed");
  if (after.methodCount !== before.methodCount + 1) throw new Error(`Expected one new makeMethod; before ${before.methodCount}, after ${after.methodCount}`);
  if (after.operationCount !== before.operationCount + tx.materialization.operationCount) throw new Error(`Expected ${tx.materialization.operationCount} new operations; before ${before.operationCount}, after ${after.operationCount}`);
  if (after.extractionCount !== before.extractionCount) throw new Error("aiDrawingExtraction count changed unexpectedly");
  if (after.sampleCount !== before.sampleCount) throw new Error("aiRoutingSample count changed unexpectedly");
  if (after.evaluationRunCount !== before.evaluationRunCount) throw new Error("aiRoutingEvaluationRun count changed unexpectedly");
  const linkedDraft = after.drafts.find((d) => d.id === tx.draftId);
  if (!linkedDraft || linkedDraft.status !== "Accepted" || linkedDraft.acceptedMakeMethodId !== tx.materialization.makeMethodId) throw new Error("Accepted draft linkage check failed");
  const createdOperations = after.operations.filter((op) => op.makeMethodId === tx.materialization.makeMethodId).sort((a, b) => a.order - b.order);

  const output = {
    action: tx.materialization.action,
    companyId,
    readableId,
    item: { id: item.id, readableId: item.readableId, readableIdWithRevision: item.readableIdWithRevision, name: item.name },
    runMarker,
    targetMakeMethodId: targetMakeMethod.id,
    targetMakeMethodStatus: targetMakeMethod.status,
    targetEvidence: { extractionId: target.id, materialTags: target.materialTags, featureTags: target.featureTags, drawingEvidenceCount: target.drawingEvidence?.length ?? 0, drawingWarningCount: target.drawingWarnings?.length ?? 0, drawingWarnings: target.drawingWarnings ?? [] },
    trainingSampleCount: samples.length,
    generatedDraft: { id: tx.draftId, suggestedOperationCount: draft.suggestedOperations.length, warnings: draft.warnings, references: draft.references.slice(0, 5).map((r) => ({ sampleId: r.sampleId, readableId: r.readableId, score: r.score, matchedDrawingEvidenceCount: r.matchedDrawingEvidence.length })), operations: draft.suggestedOperations.map((op) => ({ order: op.order, processId: op.processId, processName: op.processName, description: op.description, sourceSampleId: op.sourceSampleId, sourceOperationOrder: op.sourceOperationOrder, workCenterId: op.workCenterId ?? null })) },
    feedbackId: tx.feedbackId,
    materialization: tx.materialization,
    createdMethod,
    createdOperations,
    checks: { activeMethodIdsUnchanged: sameSet(before.activeMethodIds, after.activeMethodIds), methodCountDelta: after.methodCount - before.methodCount, operationCountDelta: after.operationCount - before.operationCount, draftCountDelta: after.drafts.length - before.drafts.length, feedbackCountDelta: after.feedbackCount - before.feedbackCount, extractionCountDelta: after.extractionCount - before.extractionCount, sampleCountDelta: after.sampleCount - before.sampleCount, evaluationRunCountDelta: after.evaluationRunCount - before.evaluationRunCount, evaluationLeakCount: leaks.length, workCenterAssignmentCount: workCenters.length, linkedAcceptedMakeMethodId: linkedDraft.acceptedMakeMethodId },
    before,
    after
  };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  c.release();
  await pool.end();
}

