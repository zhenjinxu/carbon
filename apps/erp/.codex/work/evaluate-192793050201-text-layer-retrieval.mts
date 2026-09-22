import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  aiRoutingTargetEvidenceFromDrawing,
  generateAiRoutingDraft,
  rankSimilarRoutingSamples,
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
    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function operation(value: unknown): AiRoutingOperation {
  const row = record(value);
  const process = record(row.process);
  const workCenter = record(row.workCenter);
  return {
    id: text(row.id) ?? undefined,
    order: Number(row.order ?? 0),
    processId: text(row.processId) ?? text(process.id),
    processName: text(row.processName) ?? text(process.name),
    workCenterId: text(row.workCenterId) ?? text(workCenter.id),
    workCenterName: text(row.workCenterName) ?? text(workCenter.name),
    description: text(row.description)
  };
}

function sample(row: Record<string, unknown>): AiRoutingSample {
  const itemSnapshot = record(row.itemSnapshot);
  return {
    id: String(row.id),
    itemId: String(row.itemId),
    readableId:
      text(itemSnapshot.readableIdWithRevision) ?? text(itemSnapshot.readableId),
    name: text(itemSnapshot.name),
    operations: Array.isArray(row.operationSnapshot)
      ? row.operationSnapshot.map(operation)
      : [],
    materialTags: strings(row.materialTags),
    featureTags: strings(row.featureTags),
    processTags: strings(row.processTags),
    resourceTags: strings(row.resourceTags),
    status: row.status === "Approved" ? "Approved" : "Candidate",
    datasetRole: row.datasetRole === "Evaluation" ? "Evaluation" : "Training"
  };
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
const readableId = "192793050201";
const probePath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-192793050201-text-layer-probe-20260819.json"
);
const probe = JSON.parse(readFileSync(probePath, "utf8")) as {
  extraction: unknown;
};

const { data: items, error: itemError } = await carbon
  .from("item")
  .select("id,readableId,readableIdWithRevision,name,description")
  .eq("companyId", companyId)
  .eq("readableId", readableId)
  .limit(1);
if (itemError) throw itemError;
const item = items?.[0];
if (!item) throw new Error("Target item not found");

const { data: sampleRows, error: sampleError } = await carbon
  .from("aiRoutingSample")
  .select(
    "id,itemId,itemSnapshot,operationSnapshot,materialTags,featureTags,processTags,resourceTags,status,datasetRole"
  )
  .eq("companyId", companyId)
  .eq("status", "Approved")
  .eq("datasetRole", "Training");
if (sampleError) throw sampleError;
const samples = (sampleRows ?? []).map((row) =>
  sample(row as Record<string, unknown>)
);

const target = aiRoutingTargetEvidenceFromDrawing({
  id: "read-only-text-layer-probe",
  itemId: item.id,
  item: {
    readableId: item.readableIdWithRevision ?? item.readableId,
    name: item.name,
    description: item.description
  },
  drawingExtraction: probe.extraction as never
});
const ranked = rankSimilarRoutingSamples({ target, samples, limit: 5 });
const draft = generateAiRoutingDraft({ target, samples });
const output = {
  target: {
    materialTags: target.materialTags,
    featureTags: target.featureTags,
    drawingEvidenceKinds: target.drawingEvidence?.map((fact) => fact.kind),
    drawingWarnings: target.drawingWarnings
  },
  topReferences: ranked.map((candidate) => ({
    sampleId: candidate.sampleId,
    readableId: candidate.readableId,
    score: candidate.score,
    matched: candidate.matched,
    matchedDrawingEvidenceCount: candidate.matchedDrawingEvidence.length,
    operations: candidate.sample.operations.map(
      (operation) => operation.processName ?? operation.description
    )
  })),
  draft: {
    operationCount: draft.suggestedOperations.length,
    operations: draft.suggestedOperations.map(
      (operation) => operation.processName ?? operation.description
    ),
    sourceSampleIds: Array.from(
      new Set(draft.suggestedOperations.map((operation) => operation.sourceSampleId))
    ),
    warnings: draft.warnings
  }
};
const outputPath = resolve(
  process.cwd(),
  ".codex/work/ai-routing-192793050201-text-layer-retrieval-20260819.json"
);
writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify({ outputPath, ...output }, null, 2));