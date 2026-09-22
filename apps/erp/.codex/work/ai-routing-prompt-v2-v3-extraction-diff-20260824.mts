import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function loadEnvFile(path: string, options: { override?: boolean; only?: Set<string> } = {}) {
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
      const pkg = JSON.parse(readFileSync(resolve(current, "package.json"), "utf8"));
      if (pkg?.name === "carbon") return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) throw new Error("Unable to locate Carbon root");
    current = parent;
  }
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
loadEnvFile(resolve(root, ".env"));
loadEnvFile(resolve(root, ".env.local"), { override: true });
loadEnvFile(resolve(root, "apps/erp/.env.local"), {
  override: true,
  only: new Set(["SUPABASE_DB_URL"])
});

const requireFromRoot = createRequire(resolve(root, "package.json"));
const { createClient } = await import(
  pathToFileURL(requireFromRoot.resolve("@supabase/supabase-js")).href
);
const { aiRoutingTargetEvidenceFromDrawing } = await import(
  pathToFileURL(resolve(root, "apps/erp/app/modules/items/ai-routing.ts")).href
);

const companyId = process.env.AI_ROUTING_COMPANY_ID ?? "d8s9bh4f8gm357312pbg";
const v2ArtifactPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-stage4-30-gate-controlled-v2-extractions-20260823.json"
);
const v3ArtifactPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-stage4-controlled-v3-extractions-20260824.json"
);
const outputPath = resolve(
  root,
  "apps/erp/.codex/work/ai-routing-prompt-v2-v3-extraction-diff-20260824.json"
);

if (!existsSync(v2ArtifactPath)) throw new Error(`Missing v2 artifact: ${v2ArtifactPath}`);
if (!existsSync(v3ArtifactPath)) throw new Error(`Missing v3 artifact: ${v3ArtifactPath}`);

const v2Artifact = JSON.parse(readFileSync(v2ArtifactPath, "utf8"));
const v3Artifact = JSON.parse(readFileSync(v3ArtifactPath, "utf8"));
const readableIds = [
  "192472540409",
  "192759010202",
  "192472540414",
  "192739030308"
];

const byReadableId = (artifact: any) =>
  new Map((artifact.results ?? []).map((row: any) => [row.readableId, row]));
const v2ByReadableId = byReadableId(v2Artifact);
const v3ByReadableId = byReadableId(v3Artifact);

const carbon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function loadExtraction(id: string) {
  const { data, error } = await carbon
    .from("aiDrawingExtraction")
    .select(
      "id,itemId,documentId,status,promptVersion,contentHash,rendererVersion,extractorSchemaVersion,modelProvider,modelName,pageCount,completedAt,createdAt,updatedAt,extraction,warnings"
    )
    .eq("companyId", companyId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Extraction not found: ${id}`);
  return data;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean).map((value) => value.trim()).filter(Boolean)));
}

function diffList(before: string[], after: string[]) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((value) => !beforeSet.has(value)),
    removed: before.filter((value) => !afterSet.has(value)),
    unchanged: after.filter((value) => beforeSet.has(value))
  };
}

function byKind(target: any) {
  const counts: Record<string, number> = {};
  for (const fact of target.drawingEvidence ?? []) {
    counts[fact.kind] = (counts[fact.kind] ?? 0) + 1;
  }
  return counts;
}

function evidenceTexts(values: any[]) {
  return unique(
    values.flatMap((value) =>
      (value.evidence ?? []).map((evidence: any) => String(evidence.text ?? ""))
    )
  ).slice(0, 12);
}

function noteTexts(extraction: any, pattern?: RegExp) {
  const notes = (extraction.notes ?? []).map((note: any) => String(note.text ?? ""));
  return unique(pattern ? notes.filter((text) => pattern.test(text)) : notes).slice(0, 12);
}

function featureSummary(extraction: any) {
  const features = extraction.features ?? {};
  const holes = features.holes ?? [];
  const threads = features.threads ?? [];
  return {
    dimensions: extraction.dimensions?.length ?? 0,
    holes: holes.length,
    holesWithThread: holes.filter((hole: any) => Boolean(hole.thread)).length,
    holeTexts: evidenceTexts(holes),
    threads: threads.length,
    threadSpecs: unique(threads.map((thread: any) => String(thread.specification ?? thread.label ?? ""))).slice(0, 12),
    threadTexts: evidenceTexts(threads),
    slots: features.slots?.length ?? 0,
    pockets: features.pockets?.length ?? 0,
    bends: features.bends?.length ?? 0,
    welds: features.welds?.length ?? 0,
    surfaces: features.surfaces?.length ?? 0,
    surfaceTexts: evidenceTexts(features.surfaces ?? []),
    notes: extraction.notes?.length ?? 0,
    manufacturingNotes: noteTexts(extraction, /锯|下料|车|车削|普通车床|氧化|阳极|发黑|攻丝|钻|孔|螺纹|thread|tap|lathe|saw|oxid/i),
    allNotes: noteTexts(extraction)
  };
}

function summary(row: any, readableId: string) {
  const extraction = row.extraction;
  const target = aiRoutingTargetEvidenceFromDrawing({
    id: row.id,
    itemId: row.itemId,
    item: { readableId },
    drawingExtraction: extraction
  });
  return {
    id: row.id,
    promptVersion: row.promptVersion,
    status: row.status,
    contentHash: row.contentHash,
    rendererVersion: row.rendererVersion,
    extractorSchemaVersion: row.extractorSchemaVersion,
    completedAt: row.completedAt,
    document: extraction.document,
    titleBlock: extraction.titleBlock,
    part: extraction.part,
    explicitUnknowns: extraction.explicitUnknowns ?? [],
    extractionWarnings: extraction.warnings ?? [],
    target: {
      materialTags: target.materialTags,
      featureTags: target.featureTags,
      processHints: target.processHints ?? [],
      drawingEvidenceCount: target.drawingEvidence?.length ?? 0,
      drawingEvidenceByKind: byKind(target)
    },
    features: featureSummary(extraction)
  };
}

function compareSummaries(v2: any, v3: any) {
  return {
    sameContentHash: Boolean(v2.contentHash && v2.contentHash === v3.contentHash),
    partClassChanged: v2.part.class !== v3.part.class,
    stockFormChanged: v2.part.stockForm !== v3.part.stockForm,
    materialChanged: v2.titleBlock.material !== v3.titleBlock.material,
    finishChanged: v2.titleBlock.finish !== v3.titleBlock.finish,
    explicitUnknowns: diffList(v2.explicitUnknowns, v3.explicitUnknowns),
    materialTags: diffList(v2.target.materialTags, v3.target.materialTags),
    featureTags: diffList(v2.target.featureTags, v3.target.featureTags),
    processHints: diffList(v2.target.processHints, v3.target.processHints),
    evidenceCountDelta: v3.target.drawingEvidenceCount - v2.target.drawingEvidenceCount,
    featureCountDelta: {
      dimensions: v3.features.dimensions - v2.features.dimensions,
      holes: v3.features.holes - v2.features.holes,
      holesWithThread: v3.features.holesWithThread - v2.features.holesWithThread,
      threads: v3.features.threads - v2.features.threads,
      slots: v3.features.slots - v2.features.slots,
      pockets: v3.features.pockets - v2.features.pockets,
      bends: v3.features.bends - v2.features.bends,
      welds: v3.features.welds - v2.features.welds,
      surfaces: v3.features.surfaces - v2.features.surfaces,
      notes: v3.features.notes - v2.features.notes
    },
    manufacturingNotes: diffList(v2.features.manufacturingNotes, v3.features.manufacturingNotes),
    holeTexts: diffList(v2.features.holeTexts, v3.features.holeTexts),
    threadTexts: diffList(v2.features.threadTexts, v3.features.threadTexts),
    surfaceTexts: diffList(v2.features.surfaceTexts, v3.features.surfaceTexts)
  };
}

const rows = [];
for (const readableId of readableIds) {
  const v2Meta = v2ByReadableId.get(readableId) as any;
  const v3Meta = v3ByReadableId.get(readableId) as any;
  if (!v2Meta?.extractionId) throw new Error(`Missing v2 extraction id for ${readableId}`);
  if (!v3Meta?.extractionId) throw new Error(`Missing v3 extraction id for ${readableId}`);
  const v2Row = await loadExtraction(v2Meta.extractionId);
  const v3Row = await loadExtraction(v3Meta.extractionId);
  const v2 = summary(v2Row, readableId);
  const v3 = summary(v3Row, readableId);
  rows.push({
    readableId,
    itemId: v3Row.itemId,
    documentId: v3Row.documentId,
    v2,
    v3,
    diff: compareSummaries(v2, v3)
  });
}

const output = {
  generatedAt: new Date().toISOString(),
  companyId,
  scope: "Prompt v2/v3 extraction diff for the four original 30-gate residual candidates",
  sourceArtifacts: {
    v2: v2ArtifactPath,
    v3: v3ArtifactPath
  },
  rows,
  rollup: {
    comparedCount: rows.length,
    sameContentHashCount: rows.filter((row) => row.diff.sameContentHash).length,
    partClassChanged: rows.filter((row) => row.diff.partClassChanged).map((row) => row.readableId),
    stockFormChanged: rows.filter((row) => row.diff.stockFormChanged).map((row) => row.readableId),
    materialChanged: rows.filter((row) => row.diff.materialChanged).map((row) => row.readableId),
    finishChanged: rows.filter((row) => row.diff.finishChanged).map((row) => row.readableId),
    processHintChanged: rows.filter(
      (row) => row.diff.processHints.added.length > 0 || row.diff.processHints.removed.length > 0
    ).map((row) => row.readableId),
    featureTagChanged: rows.filter(
      (row) => row.diff.featureTags.added.length > 0 || row.diff.featureTags.removed.length > 0
    ).map((row) => row.readableId),
    totalEvidenceCountDelta: rows.reduce((sum, row) => sum + row.diff.evidenceCountDelta, 0),
    routeGenerationRecommendation: "No route-generation change is recommended from this diff alone; use it as extraction evidence attribution only."
  }
};

writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  outputPath,
  comparedCount: output.rollup.comparedCount,
  sameContentHashCount: output.rollup.sameContentHashCount,
  partClassChanged: output.rollup.partClassChanged,
  stockFormChanged: output.rollup.stockFormChanged,
  featureTagChanged: output.rollup.featureTagChanged,
  processHintChanged: output.rollup.processHintChanged,
  totalEvidenceCountDelta: output.rollup.totalEvidenceCountDelta
}, null, 2));

await carbon.auth.signOut();