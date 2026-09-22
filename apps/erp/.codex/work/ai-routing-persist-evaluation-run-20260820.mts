import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgresDriver } from "kysely";
import {
  buildAiRoutingEvaluationRunRecord,
  evaluateAiRoutingHoldouts,
  type AiRoutingEvaluationCaseInput
} from "../../app/modules/items/ai-routing-evaluation.ts";
import { persistAiRoutingEvaluationRun } from "../../app/modules/items/ai-routing-evaluation.server.ts";

function loadEnvFile(
  path: string,
  options: { override?: boolean; only?: Set<string> } = {}
) {
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
    if (!key || rawValue === undefined) continue;
    if (options.only && !options.only.has(key)) continue;
    if (!options.override && process.env[key] !== undefined) continue;

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

function findRoot(start: string) {
  let current = start;
  for (;;) {
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(current, "package.json"), "utf8")
      );
      if (pkg?.name === "carbon") return current;
    } catch {
      // keep walking
    }
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

function readJsonFile(path: string) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
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

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function sortedUnique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function arraysEqual(left: string[], right: string[]) {
  const leftSorted = sortedUnique(left);
  const rightSorted = sortedUnique(right);
  return (
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function sampleReadableId(row: Record<string, unknown>) {
  const snapshot = asRecord(row.itemSnapshot);
  return (
    stringValue(snapshot.readableId) ??
    stringValue(snapshot.readableIdWithRevision) ??
    null
  );
}

function commonString(
  rows: Array<Record<string, unknown>>,
  key: string,
  fallback: string | null = null
) {
  const values = sortedUnique(
    rows.map((row) => stringValue(row[key])).filter(Boolean) as string[]
  );
  if (values.length === 0) return fallback;
  if (values.length === 1) return values[0];
  return `mixed:${values.join(",")}`;
}

function operationsFromComparison(result: Record<string, unknown>) {
  const comparison = asRecord(result.comparison);
  const byPosition = asArray(comparison.byPosition).map(asRecord);
  const expectedOperations = byPosition
    .filter((row) => stringValue(row.expectedProcessId) || stringValue(row.expectedProcessName))
    .map((row) => ({
      order: numberValue(row.position),
      processId: stringValue(row.expectedProcessId),
      processName: stringValue(row.expectedProcessName),
      description: stringValue(row.expectedProcessName),
      workCenterId: null,
      workCenterName: null
    }));
  const suggestedOperations = byPosition
    .filter((row) => stringValue(row.predictedProcessId) || stringValue(row.predictedProcessName))
    .map((row) => ({
      order: numberValue(row.position),
      processId: stringValue(row.predictedProcessId),
      processName: stringValue(row.predictedProcessName),
      description: stringValue(row.predictedProcessName),
      workCenterId: null,
      workCenterName: null
    }));
  return { expectedOperations, suggestedOperations };
}

function existingRunMatches(
  row: Record<string, unknown>,
  args: {
    trainingSampleIds: string[];
    evaluationSampleIds: string[];
    promptVersion: string | null;
    extractorSchemaVersion: string;
    modelProvider: string | null;
    modelName: string | null;
    targetExtractionIds: string[];
  }
) {
  const caseResults = asArray(row.caseResults).map(asRecord);
  const rowExtractionIds = caseResults
    .map((result) => stringValue(result.targetExtractionId))
    .filter(Boolean) as string[];
  return (
    arraysEqual(stringArray(row.trainingSampleIds), args.trainingSampleIds) &&
    arraysEqual(stringArray(row.evaluationSampleIds), args.evaluationSampleIds) &&
    (row.promptVersion ?? null) === args.promptVersion &&
    row.extractorSchemaVersion === args.extractorSchemaVersion &&
    (row.modelProvider ?? null) === args.modelProvider &&
    (row.modelName ?? null) === args.modelName &&
    arraysEqual(rowExtractionIds, args.targetExtractionIds)
  );
}

async function requireSupabase<T>(
  promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  label: string
) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message ?? "Supabase error"}`);
  return data;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = findRoot(scriptDir);
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});

if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL is not configured");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
}
if (!process.env.SUPABASE_DB_URL) throw new Error("SUPABASE_DB_URL is not configured");

const requireFromErp = createRequire(resolve(root, "apps/erp/package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromErp.resolve("@supabase/supabase-js")).href
);
const { getPostgresConnectionPool, getPostgresClient } = await import(
  pathToFileURL(
    resolve(root, "packages/database/supabase/functions/lib/postgres/index.ts")
  ).href
);

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const companyId = "d8s9bh4f8gm357312pbg";
const generatorVersion = "ai-routing-draft.v1";
const holdoutPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-second-batch-holdout-evaluation-20260820.json"
);
const normalizedPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-second-batch-normalized-evaluation-20260820.json"
);
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-evaluation-run-persist-20260820.json"
);

const holdout = readJsonFile(holdoutPath);
const normalized = readJsonFile(normalizedPath);
const holdoutResults = asArray(holdout.results).map(asRecord);
const evaluationReadableIds = holdoutResults
  .map((result) => stringValue(result.readableId))
  .filter(Boolean) as string[];
const targetExtractionIds = holdoutResults
  .map((result) => stringValue(result.targetExtractionId))
  .filter(Boolean) as string[];

if (companyId !== holdout.companyId) throw new Error("Unexpected companyId in holdout file");
if (holdout.holdoutCount !== 4 || holdoutResults.length !== 4) {
  throw new Error("Expected exactly 4 second-batch holdouts");
}
if (holdout.totalEvaluationLeaks !== 0) throw new Error("Holdout file reports Evaluation leakage");
if (holdout.totalWorkCenterAssignments !== 0) {
  throw new Error("Holdout file reports unreviewed work-center assignments");
}
if (holdout.totalMissingProcessIds !== 0) throw new Error("Holdout file reports missing process IDs");
if (asArray(holdout.invalidProcessIds).length > 0) {
  throw new Error("Holdout file reports invalid process IDs");
}
if (normalized.normalizedExactSequenceMatches !== 4) {
  throw new Error("Normalized evaluation file does not report 4/4 semantic matches");
}

const samples =
  (await requireSupabase(
    carbon
      .from("aiRoutingSample")
      .select("id,itemId,status,datasetRole,itemSnapshot")
      .eq("companyId", companyId)
      .eq("status", "Approved"),
    "load aiRoutingSample"
  )) ?? [];
const sampleRows = samples.map((row: unknown) => asRecord(row));
const trainingSampleIds = sortedUnique(
  sampleRows
    .filter((row) => row.datasetRole === "Training")
    .map((row) => stringValue(row.id))
    .filter(Boolean) as string[]
);
const evaluationSampleRows = sampleRows.filter(
  (row) =>
    row.datasetRole === "Evaluation" &&
    evaluationReadableIds.includes(sampleReadableId(row) ?? "")
);
const evaluationSampleIds = sortedUnique(
  evaluationSampleRows
    .map((row) => stringValue(row.id))
    .filter(Boolean) as string[]
);
if (trainingSampleIds.length !== holdout.trainingSampleCount) {
  throw new Error(
    `Training sample count drifted: expected ${holdout.trainingSampleCount}, got ${trainingSampleIds.length}`
  );
}
if (evaluationSampleIds.length !== evaluationReadableIds.length) {
  throw new Error("Evaluation sample set does not match the holdout result file");
}

const items =
  (await requireSupabase(
    carbon
      .from("item")
      .select("id,readableId,createdBy")
      .eq("companyId", companyId)
      .in("readableId", evaluationReadableIds),
    "load evaluation items"
  )) ?? [];
const itemRows = items.map((row: unknown) => asRecord(row));
const itemByReadableId = new Map(
  itemRows.map((row) => [stringValue(row.readableId), row])
);
const evaluationItemIds = itemRows
  .map((row) => stringValue(row.id))
  .filter(Boolean) as string[];
if (evaluationItemIds.length !== evaluationReadableIds.length) {
  throw new Error("Evaluation item set does not match the holdout result file");
}

async function loadFormalCounts() {
  const methodRows =
    (await requireSupabase(
      carbon
        .from("makeMethod")
        .select("id,itemId")
        .eq("companyId", companyId)
        .in("itemId", evaluationItemIds),
      "load formal make methods"
    )) ?? [];
  const methodIds = methodRows
    .map((row: unknown) => stringValue(asRecord(row).id))
    .filter(Boolean) as string[];
  const operationRows = methodIds.length
    ? ((await requireSupabase(
        carbon
          .from("methodOperation")
          .select("id,makeMethodId")
          .eq("companyId", companyId)
          .in("makeMethodId", methodIds),
        "load formal method operations"
      )) ?? [])
    : [];
  return {
    methodCount: methodRows.length,
    operationCount: operationRows.length
  };
}

const formalBefore = await loadFormalCounts();

const extractionRows =
  (await requireSupabase(
    carbon
      .from("aiDrawingExtraction")
      .select("id,promptVersion,extractorSchemaVersion,modelProvider,modelName")
      .eq("companyId", companyId)
      .in("id", targetExtractionIds),
    "load target extractions"
  )) ?? [];
const extractions = extractionRows.map((row: unknown) => asRecord(row));
if (extractions.length !== targetExtractionIds.length) {
  throw new Error("Target extraction provenance is incomplete");
}
const promptVersion = commonString(extractions, "promptVersion", null);
const extractorSchemaVersion = commonString(
  extractions,
  "extractorSchemaVersion",
  "ai-routing-drawing.v1"
);
if (!extractorSchemaVersion) throw new Error("Extractor schema version is missing");
const modelProvider = commonString(extractions, "modelProvider", null);
const modelName = commonString(extractions, "modelName", null);

const processRows =
  (await requireSupabase(
    carbon.from("process").select("id").eq("companyId", companyId),
    "load valid processes"
  )) ?? [];
const validProcessIds = processRows
  .map((row: unknown) => stringValue(asRecord(row).id))
  .filter(Boolean) as string[];

const cases: AiRoutingEvaluationCaseInput[] = holdoutResults.map((result) => {
  const readableId = stringValue(result.readableId);
  if (!readableId) throw new Error("Holdout result missing readableId");
  const item = itemByReadableId.get(readableId);
  if (!item) throw new Error(`Missing item for holdout ${readableId}`);
  const { expectedOperations, suggestedOperations } = operationsFromComparison(result);
  const references = asArray(result.topReferences)
    .map(asRecord)
    .map((reference) => stringValue(reference.sampleId))
    .filter(Boolean) as string[];
  const evaluationSample = evaluationSampleRows.find(
    (row) => sampleReadableId(row) === readableId
  );
  if (!evaluationSample) throw new Error(`Missing Evaluation sample for ${readableId}`);
  return {
    evaluationSampleId: stringValue(evaluationSample.id) ?? "",
    targetItemId: stringValue(item.id) ?? "",
    targetExtractionId: stringValue(result.targetExtractionId) ?? "",
    expectedOperations,
    suggestedOperations,
    referenceSampleIds: references,
    warnings: stringArray(result.warnings)
  };
});

const evaluation = evaluateAiRoutingHoldouts({
  evaluationSampleIds,
  validProcessIds,
  cases
});
if (evaluation.metrics.totalEvaluationLeaks !== 0) throw new Error("Evaluation leakage detected");
if (evaluation.metrics.totalWorkCenterAssignments !== 0) {
  throw new Error("Unreviewed work-center assignments detected");
}
if (evaluation.metrics.totalMissingProcessIds !== 0) throw new Error("Missing process IDs detected");
if (evaluation.metrics.invalidProcessIds.length > 0) throw new Error("Invalid process IDs detected");
if (evaluation.metrics.normalizedExactSequenceMatches !== 4) {
  throw new Error("Expected 4/4 normalized semantic matches");
}
if (evaluation.metrics.productionGate.eligible) {
  throw new Error("Four holdouts must not satisfy the production quality gate");
}

const userId =
  process.env.U8_CARBON_USER_ID ??
  (itemRows.map((row) => stringValue(row.createdBy)).find(Boolean) as string | undefined);
if (!userId) throw new Error("No user id available for evaluation run createdBy");

const record = buildAiRoutingEvaluationRunRecord({
  companyId,
  userId,
  trainingSampleIds,
  evaluationSampleIds,
  generatorVersion,
  promptVersion,
  extractorSchemaVersion,
  modelProvider,
  modelName,
  evaluation,
  completedAt: new Date(stringValue(holdout.evaluatedAt) ?? new Date().toISOString())
});

const existingRows =
  (await requireSupabase(
    carbon
      .from("aiRoutingEvaluationRun")
      .select(
        "id,trainingSampleIds,evaluationSampleIds,generatorVersion,promptVersion,extractorSchemaVersion,modelProvider,modelName,caseResults,metrics,completedAt,createdAt"
      )
      .eq("companyId", companyId)
      .eq("status", "Succeeded")
      .eq("generatorVersion", generatorVersion)
      .eq("extractorSchemaVersion", extractorSchemaVersion)
      .order("createdAt", { ascending: false }),
    "load existing evaluation runs"
  )) ?? [];
const existingRun = existingRows
  .map((row: unknown) => asRecord(row))
  .find((row) =>
    existingRunMatches(row, {
      trainingSampleIds,
      evaluationSampleIds,
      promptVersion,
      extractorSchemaVersion,
      modelProvider,
      modelName,
      targetExtractionIds
    })
  );

let action: "Inserted" | "Reused" = "Reused";
let evaluationRunId = stringValue(existingRun?.id);
if (!evaluationRunId) {
  const postgresPool = getPostgresConnectionPool(2);
  const postgres = getPostgresClient(postgresPool, PostgresDriver);
  try {
    evaluationRunId = await persistAiRoutingEvaluationRun(
      postgres as never,
      record,
      { partsView: true, partsUpdate: true }
    );
    action = "Inserted";
  } finally {
    await postgres.destroy();
  }
}

const formalAfter = await loadFormalCounts();
if (
  formalBefore.methodCount !== formalAfter.methodCount ||
  formalBefore.operationCount !== formalAfter.operationCount
) {
  throw new Error("Formal routing counts changed during evaluation persistence");
}

const output = {
  action,
  evaluationRunId,
  companyId,
  generatorVersion,
  promptVersion,
  extractorSchemaVersion,
  modelProvider,
  modelName,
  trainingSampleCount: trainingSampleIds.length,
  evaluationSampleCount: evaluationSampleIds.length,
  targetExtractionIds,
  metrics: evaluation.metrics,
  formalBefore,
  formalAfter,
  productionGate: evaluation.metrics.productionGate
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify(output, null, 2));