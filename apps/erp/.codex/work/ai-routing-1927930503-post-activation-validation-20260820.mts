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
function opFromSnapshot(value) {
  const row = rec(value), process = rec(row.process), wc = rec(row.workCenter);
  return {
    id: str(row.id) ?? undefined,
    order: num(row.order),
    processId: str(row.processId) ?? str(process.id),
    processName: str(row.processName) ?? str(process.name),
    workCenterId: str(row.workCenterId) ?? str(wc.id),
    workCenterName: str(row.workCenterName) ?? str(wc.name),
    operationType: str(row.operationType), operationOrder: str(row.operationOrder), description: str(row.description),
    setupTime: num(row.setupTime), setupUnit: str(row.setupUnit), laborTime: num(row.laborTime), laborUnit: str(row.laborUnit), machineTime: num(row.machineTime), machineUnit: str(row.machineUnit), customFields: row.customFields
  };
}
function sampleFromRow(row) {
  const item = rec(row.itemSnapshot);
  return {
    id: String(row.id), itemId: String(row.itemId), readableId: str(item.readableIdWithRevision) ?? str(item.readableId), name: str(item.name), makeMethodId: str(row.makeMethodId), documentIds: strs(row.drawingDocumentIds),
    operations: arr(row.operationSnapshot).map(opFromSnapshot), materialTags: strs(row.materialTags), featureTags: strs(row.featureTags), processTags: strs(row.processTags), resourceTags: strs(row.resourceTags),
    status: row.status === "Approved" ? "Approved" : "Candidate", datasetRole: row.datasetRole === "Evaluation" ? "Evaluation" : "Training"
  };
}
function routeSig(ops) { return [...ops].sort((a,b)=>a.order-b.order).map((op)=>str(op.processName) ?? str(op.description) ?? str(op.processId) ?? "?").join(" -> "); }
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
  return aiRoutingTargetEvidenceFromDrawing({ id: row.extractionId, itemId: row.itemId, item: { readableId: row.readableIdWithRevision ?? row.readableId, name: row.name, description: row.description, customFields: null }, drawingExtraction: row.extraction });
}
async function loadSamples(c, companyId) {
  return (await c.query(`
    SELECT "id", "itemId", "makeMethodId", "itemSnapshot", "operationSnapshot", "drawingDocumentIds", "materialTags", "featureTags", "processTags", "resourceTags", "status"::text AS "status", "datasetRole"::text AS "datasetRole"
    FROM "aiRoutingSample"
    WHERE "companyId" = $1 AND "status" = 'Approved'::"aiRoutingSampleStatus" AND "datasetRole" = 'Training'::"aiRoutingDatasetRole"
    ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC LIMIT 500`, [companyId])).rows.map(sampleFromRow);
}
async function loadSampleRoles(c, companyId) {
  const rows = (await c.query(`SELECT "id", "itemId", "itemSnapshot", "datasetRole"::text AS "datasetRole", "status"::text AS "status" FROM "aiRoutingSample" WHERE "companyId" = $1 AND "status" = 'Approved'::"aiRoutingSampleStatus"`, [companyId])).rows;
  const byReadable = new Map();
  for (const row of rows) {
    const item = rec(row.itemSnapshot);
    const readable = str(item.readableIdWithRevision) ?? str(item.readableId) ?? row.itemId;
    const entry = byReadable.get(readable) ?? { readableId: readable, sampleIds: [], roles: [] };
    entry.sampleIds.push(row.id);
    entry.roles.push(row.datasetRole);
    byReadable.set(readable, entry);
  }
  return { rows, byReadable };
}
async function loadActivation(c, companyId, itemId) {
  const methods = (await c.query(`
    SELECT "id", "status"::text AS "status", "version", "createdAt", "updatedAt"
    FROM "makeMethod" WHERE "companyId" = $1 AND "itemId" = $2 ORDER BY "version" ASC, "createdAt" ASC`, [companyId, itemId])).rows;
  const methodIds = methods.map((m) => m.id);
  const operations = methodIds.length ? (await c.query(`
    SELECT o."id", o."makeMethodId", o."order", o."processId", p."name" AS "processName", o."workCenterId", o."description"
    FROM "methodOperation" o
    LEFT JOIN "process" p ON p."id" = o."processId" AND p."companyId" = o."companyId"
    WHERE o."companyId" = $1 AND o."makeMethodId" = ANY($2::text[]) ORDER BY o."makeMethodId", o."order" ASC`, [companyId, methodIds])).rows : [];
  const drafts = (await c.query(`
    SELECT d."id", d."status"::text AS "status", d."targetMakeMethodId", d."acceptedMakeMethodId", d."acceptedAt", f."id" AS "feedbackId", f."reason"
    FROM "aiRoutingDraft" d
    LEFT JOIN LATERAL (SELECT "id", "reason" FROM "aiRoutingFeedback" WHERE "companyId" = d."companyId" AND "itemId" = d."itemId" AND "draftId" = d."id" ORDER BY "createdAt" DESC LIMIT 1) f ON TRUE
    WHERE d."companyId" = $1 AND d."itemId" = $2 ORDER BY d."createdAt" ASC`, [companyId, itemId])).rows;
  const active = methods.filter((m) => m.status === "Active");
  return {
    methods: methods.map((m) => ({ id: m.id, status: m.status, version: num(m.version), createdAt: m.createdAt, updatedAt: m.updatedAt })),
    operations: operations.map((o) => ({ id: o.id, makeMethodId: o.makeMethodId, order: num(o.order), processId: o.processId, processName: o.processName, workCenterId: o.workCenterId, description: o.description })),
    drafts,
    activeMethodIds: active.map((m) => m.id),
    activeOperationCount: operations.filter((o) => active.some((m) => m.id === o.makeMethodId)).length,
    activeRouteSignature: routeSig(operations.filter((o) => active.some((m) => m.id === o.makeMethodId)))
  };
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

const companyId = "d8s9bh4f8gm357312pbg";
const targetReadableId = "1927930503";
const holdouts = ["1927930503", "192793050201", "1927930603", "192793060201"];
const holdoutSet = new Set(holdouts);
const expectedActivatedMethodId = "make_4Q4iCL2kiACFpZiwiVq2pV";
const outputPath = resolve(root, "apps/erp/.codex/work/ai-routing-1927930503-post-activation-validation-20260820.json");
try {
  const targetItem = (await c.query(`SELECT "id", "readableId", "readableIdWithRevision", "name" FROM "item" WHERE "companyId" = $1 AND ("readableId" = $2 OR "readableIdWithRevision" = $2) LIMIT 1`, [companyId, targetReadableId])).rows[0];
  if (!targetItem) throw new Error("Target item not found");
  const activation = await loadActivation(c, companyId, targetItem.id);
  if (activation.activeMethodIds.length !== 1) throw new Error(`Expected exactly one active method; got ${activation.activeMethodIds.length}`);
  if (activation.activeMethodIds[0] !== expectedActivatedMethodId) throw new Error(`Expected active method ${expectedActivatedMethodId}; got ${activation.activeMethodIds[0]}`);
  if (activation.activeOperationCount !== 3) throw new Error(`Expected active operation count 3; got ${activation.activeOperationCount}`);
  const linkedDraft = activation.drafts.find((d) => d.acceptedMakeMethodId === expectedActivatedMethodId);
  if (!linkedDraft || linkedDraft.status !== "Accepted") throw new Error("Accepted draft linkage to activated method is missing");

  const samples = await loadSamples(c, companyId);
  const sampleRoles = await loadSampleRoles(c, companyId);
  const trainingReadableSet = new Set(samples.map((s) => s.readableId).filter(Boolean));
  const roleChecks = holdouts.map((readableId) => {
    const entry = sampleRoles.byReadable.get(readableId) ?? { roles: [] };
    return { readableId, roles: entry.roles, hasEvaluation: entry.roles.includes("Evaluation"), hasTraining: entry.roles.includes("Training") };
  });
  const badRole = roleChecks.find((r) => !r.hasEvaluation || r.hasTraining);
  if (badRole) throw new Error(`Holdout role check failed for ${badRole.readableId}`);
  const trainingOverlap = holdouts.filter((id) => trainingReadableSet.has(id));
  if (trainingOverlap.length) throw new Error(`Holdouts present in Training samples: ${trainingOverlap.join(", ")}`);

  const itemRows = (await c.query(`SELECT "id", "readableId", "readableIdWithRevision", "name" FROM "item" WHERE "companyId" = $1 AND "readableId" = ANY($2::text[])`, [companyId, holdouts])).rows;
  const itemByReadable = new Map(itemRows.map((row) => [row.readableId, row]));
  const draftResults = [];
  const processIds = new Set();
  for (const readableId of holdouts) {
    const item = itemByReadable.get(readableId);
    if (!item) throw new Error(`Missing holdout item ${readableId}`);
    const target = await loadTarget(c, companyId, item.id);
    if (!target) throw new Error(`Missing latest extraction for ${readableId}`);
    const draft = generateAiRoutingDraft({ target, samples });
    for (const op of draft.suggestedOperations) if (op.processId) processIds.add(op.processId);
    const leaks = draft.references.filter((r) => r.readableId && holdoutSet.has(r.readableId));
    const workCenters = draft.suggestedOperations.filter((op) => op.workCenterId || op.workCenterName);
    const missingProcessIds = draft.suggestedOperations.filter((op) => !op.processId);
    draftResults.push({
      readableId,
      extractionId: target.id,
      materialTags: target.materialTags,
      featureTags: target.featureTags,
      drawingEvidenceCount: target.drawingEvidence?.length ?? 0,
      suggestedOperationCount: draft.suggestedOperations.length,
      routeSignature: routeSig(draft.suggestedOperations),
      referenceCount: draft.references.length,
      topReferences: draft.references.slice(0, 5).map((r) => ({ sampleId: r.sampleId, readableId: r.readableId, score: r.score, matchedDrawingEvidenceCount: r.matchedDrawingEvidence.length })),
      warningCount: draft.warnings.length,
      warnings: draft.warnings,
      evaluationLeakCount: leaks.length,
      workCenterAssignmentCount: workCenters.length,
      missingProcessIdCount: missingProcessIds.length
    });
  }
  const activeProcessRows = processIds.size ? (await c.query(`SELECT "id" FROM "process" WHERE "companyId" = $1 AND "active" = true AND "id" = ANY($2::text[])`, [companyId, [...processIds]])).rows.map((r) => r.id) : [];
  const invalidProcessIds = [...processIds].filter((id) => !activeProcessRows.includes(id));
  if (invalidProcessIds.length) throw new Error(`Invalid generated process IDs: ${invalidProcessIds.join(", ")}`);

  const totals = {
    holdoutCount: holdouts.length,
    trainingSampleCount: samples.length,
    evaluationLeakCount: draftResults.reduce((sum, r) => sum + r.evaluationLeakCount, 0),
    workCenterAssignmentCount: draftResults.reduce((sum, r) => sum + r.workCenterAssignmentCount, 0),
    missingProcessIdCount: draftResults.reduce((sum, r) => sum + r.missingProcessIdCount, 0),
    invalidProcessIdCount: invalidProcessIds.length,
    activatedTargetDraftOperationCount: draftResults.find((r) => r.readableId === targetReadableId)?.suggestedOperationCount ?? null
  };
  if (totals.evaluationLeakCount || totals.workCenterAssignmentCount || totals.missingProcessIdCount || totals.invalidProcessIdCount) throw new Error(`Post-activation smoke failed: ${JSON.stringify(totals)}`);

  const counts = (await c.query(`SELECT
    (SELECT COUNT(*) FROM "aiDrawingExtraction" WHERE "companyId" = $1)::int AS "extractionCount",
    (SELECT COUNT(*) FROM "aiRoutingSample" WHERE "companyId" = $1)::int AS "sampleCount",
    (SELECT COUNT(*) FROM "aiRoutingEvaluationRun" WHERE "companyId" = $1)::int AS "evaluationRunCount"`, [companyId])).rows[0];
  const output = { companyId, validatedAt: new Date().toISOString(), target: { readableId: targetReadableId, itemId: targetItem.id }, activation, linkedDraft: { id: linkedDraft.id, acceptedMakeMethodId: linkedDraft.acceptedMakeMethodId, feedbackId: linkedDraft.feedbackId, reason: linkedDraft.reason }, roleChecks, totals, draftResults, counts };
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
} finally {
  c.release();
  await pool.end();
}
