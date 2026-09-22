import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type JsonRecord = Record<string, any>;

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

function valueList(values: unknown) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "none";
}

function md(value: unknown) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function code(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? `\`${text.replace(/`/g, "'")}\`` : "`none`";
}

function routeSignature(target: JsonRecord, key: string) {
  return target.routes?.[key]?.signature ?? "";
}

function nonIssueFamilies(target: JsonRecord) {
  return (target.routes?.lockedEvaluationActual?.families ?? []).filter((family: string) => family !== "issue");
}

function hasFamily(target: JsonRecord, family: string) {
  return nonIssueFamilies(target).includes(family);
}

function missingFamilies(target: JsonRecord) {
  return target.routes?.familyDiff?.missing ?? [];
}

function extraFamilies(target: JsonRecord) {
  return target.routes?.familyDiff?.extra ?? [];
}

function targetFeatures(target: JsonRecord) {
  return target.extraction?.targetFeatureTags ?? [];
}

function targetHints(target: JsonRecord) {
  return target.extraction?.targetProcessHints ?? [];
}

function conflictFlags(target: JsonRecord) {
  const flags: string[] = [];
  const hints = targetHints(target);
  const features = targetFeatures(target);
  const partClass = target.extraction?.part?.class;
  const stockForm = target.extraction?.part?.stockForm;
  if (hints.includes("激光切割") && !hasFamily(target, "laser")) {
    flags.push("laser hint conflicts with non-laser truth route");
  }
  if (features.includes("板件") && (hasFamily(target, "saw") || hasFamily(target, "turn"))) {
    flags.push("sheet target tag conflicts with saw/turn truth route");
  }
  if ((partClass === "turned" || stockForm === "bar") && features.includes("板件")) {
    flags.push("turned/bar extraction coexists with sheet target tag");
  }
  if (hasFamily(target, "oxidation") && (target.trainingCoverage?.coveringTrainingMatchCount ?? 0) === 0) {
    flags.push("oxidation truth route lacks coherent Training coverage");
  }
  if ((target.trainingCoverage?.coveringTrainingMatchCount ?? 0) === 0) {
    flags.push("no coherent approved Training route covers truth families");
  }
  return Array.from(new Set(flags));
}

function reviewQuestions(target: JsonRecord) {
  const questions = new Set<string>();
  questions.add("Confirm the active PDF is the same revision/source used for the locked Evaluation route.");
  questions.add("Confirm whether the locked Evaluation route is the correct manufacturing route for this PDF.");
  for (const family of missingFamilies(target)) {
    if (family === "saw") questions.add("Mark whether the drawing explicitly supports saw/cut-off/bar/tube stock preparation.");
    if (family === "turn") questions.add("Mark whether the drawing explicitly supports lathe/turning/shaft operations.");
    if (family === "mill") questions.add("Mark whether the drawing explicitly supports milling operations.");
    if (family === "machining-center") questions.add("Mark whether the drawing explicitly supports machining-center/CNC operations.");
    if (family === "drill") questions.add("Mark whether the drawing explicitly supports drilling separate from tapping/thread notes.");
    if (family === "tap") questions.add("Mark whether thread evidence is a visible tapped hole, not only a standalone thread spec.");
    if (family === "oxidation") questions.add("Mark whether oxidation/anodizing is specified on the drawing or route source.");
  }
  if (targetHints(target).includes("激光切割") && !hasFamily(target, "laser")) {
    questions.add("If laser is not in the truth route, decide whether the extraction laser hint is a false positive or the truth route is incomplete.");
  }
  if ((target.extraction?.part?.class === "turned" || target.extraction?.part?.stockForm === "bar") && targetFeatures(target).includes("板件")) {
    questions.add("Resolve turned/bar versus sheet tag conflict before using this row for Training or routing logic.");
  }
  questions.add("If source review confirms the truth route, identify or create a non-Evaluation Training source with the same coherent non-issue family signature.");
  return Array.from(questions);
}

function evidenceSnippets(target: JsonRecord) {
  return (target.extraction?.targetDrawingEvidenceSample ?? [])
    .slice(0, 10)
    .map((fact: JsonRecord) => `${fact.kind}${fact.label ? `:${fact.label}` : ""} — ${fact.text ?? ""}`)
    .filter(Boolean);
}

function groupedCoverage(targets: JsonRecord[]) {
  const groups = new Map<string, JsonRecord[]>();
  for (const target of targets) {
    const signature = nonIssueFamilies(target).join(" -> ");
    const rows = groups.get(signature) ?? [];
    rows.push(target);
    groups.set(signature, rows);
  }
  return Array.from(groups.entries()).map(([signature, rows]) => ({
    signature,
    readableIds: rows.map((row) => row.readableId),
    coveringTrainingMatchCount: Math.max(...rows.map((row) => row.trainingCoverage?.coveringTrainingMatchCount ?? 0)),
    requiredFamilies: signature.split(" -> ").filter(Boolean),
    recommendedGate: "source/PDF review first; then add or identify coherent approved Training source outside Evaluation if route is confirmed"
  }));
}

function targetDecisionSummary(target: JsonRecord) {
  return {
    readableId: target.readableId,
    activePdfCount: target.sourceAvailability?.activePartPdfCount ?? 0,
    latestExtractionId: target.sourceAvailability?.latestSucceededExtractionId ?? null,
    promptVersion: target.sourceAvailability?.latestSucceededPromptVersion ?? null,
    partClass: target.extraction?.part?.class ?? null,
    stockForm: target.extraction?.part?.stockForm ?? null,
    materialTags: target.extraction?.targetMaterialTags ?? [],
    featureTags: target.extraction?.targetFeatureTags ?? [],
    processHints: target.extraction?.targetProcessHints ?? [],
    actualSignature: routeSignature(target, "lockedEvaluationActual"),
    generatedSignature: routeSignature(target, "currentGenerated"),
    missingFamilies: missingFamilies(target),
    extraFamilies: extraFamilies(target),
    exactTrainingMatchCount: target.trainingCoverage?.exactTrainingMatchCount ?? 0,
    coveringTrainingMatchCount: target.trainingCoverage?.coveringTrainingMatchCount ?? 0,
    conflictFlags: conflictFlags(target),
    reviewQuestions: reviewQuestions(target),
    safeForRouteGenerationChange: false,
    safeForSampleRoleWrite: false,
    safeForMaterialization: false
  };
}

const root = findRoot(dirname(fileURLToPath(import.meta.url)));
const inputPath = resolve(root, "apps/erp/.codex/work/ai-routing-data-governance-residual-audit-20260824.json");
const outputMdPath = resolve(root, "apps/erp/.codex/work/ai-routing-source-pdf-review-packet-20260824.md");
const outputJsonPath = resolve(root, "apps/erp/.codex/work/ai-routing-source-pdf-review-packet-20260824.json");
const audit = JSON.parse(readFileSync(inputPath, "utf8"));
const targets: JsonRecord[] = audit.targets ?? [];
const coveragePlan = groupedCoverage(targets);
const decisions = targets.map(targetDecisionSummary);

const lines: string[] = [];
lines.push("# AI Routing Source/PDF Review Packet — 2026-08-24");
lines.push("");
lines.push("Scope: read-only reviewer packet for data-governance residuals after the 30-holdout Stage 4 audit.");
lines.push("");
lines.push("## Gate Status");
lines.push("");
lines.push("- Route generation change: blocked");
lines.push("- Training/Evaluation sample-role write: blocked until manual source review confirms route/evidence coherence");
lines.push("- Draft/materialization/formal method write: closed");
lines.push("- Work-center assignment: closed");
lines.push("- Required next gate: human source/PDF review plus coherent Training coverage planning");
lines.push("");
lines.push("## Summary Table");
lines.push("");
lines.push("| Part | PDF | Extraction | Prompt | Class / Stock | Target Tags | Process Hints | Truth Families | Generated Families | Training Coverage | Conflict Flags |");
lines.push("|---|---:|---|---|---|---|---|---|---|---:|---|");
for (const target of targets) {
  lines.push([
    md(target.readableId),
    md(target.sourceAvailability?.activePartPdfCount ?? 0),
    md(target.sourceAvailability?.latestSucceededExtractionId ?? "none"),
    md(target.sourceAvailability?.latestSucceededPromptVersion ?? "none"),
    md(`${target.extraction?.part?.class ?? "unknown"} / ${target.extraction?.part?.stockForm ?? "unknown"}`),
    md(valueList(target.extraction?.targetFeatureTags)),
    md(valueList(target.extraction?.targetProcessHints)),
    md(routeSignature(target, "lockedEvaluationActual") || "none"),
    md(routeSignature(target, "currentGenerated") || "empty"),
    md(target.trainingCoverage?.coveringTrainingMatchCount ?? 0),
    md(valueList(conflictFlags(target)))
  ].join(" | ").replace(/^/, "|").replace(/$/, "|"));
}
lines.push("");
lines.push("## Coherent Training Coverage Plan");
lines.push("");
lines.push("| Required Non-Issue Family Signature | Parts | Current Covering Training | Gate |");
lines.push("|---|---|---:|---|");
for (const group of coveragePlan) {
  lines.push(`| ${md(group.signature)} | ${md(group.readableIds.join(", "))} | ${group.coveringTrainingMatchCount} | ${md(group.recommendedGate)} |`);
}
lines.push("");
for (const target of targets) {
  lines.push(`## ${target.readableId}`);
  lines.push("");
  lines.push("### Source Snapshot");
  lines.push("");
  lines.push(`- Active Part PDFs: ${target.sourceAvailability?.activePartPdfCount ?? 0}`);
  for (const document of target.sourceAvailability?.partPdfDocuments ?? []) {
    lines.push(`- PDF: ${code(document.id)} · ${md(document.name ?? "unnamed")} · path ${code(document.path ?? "none")} · size ${document.size ?? "unknown"}`);
  }
  lines.push(`- Latest extraction: ${code(target.sourceAvailability?.latestSucceededExtractionId ?? "none")} · prompt ${code(target.sourceAvailability?.latestSucceededPromptVersion ?? "none")}`);
  lines.push(`- Part class / stock form: ${code(target.extraction?.part?.class ?? "unknown")} / ${code(target.extraction?.part?.stockForm ?? "unknown")}`);
  lines.push(`- Target material tags: ${code(valueList(target.extraction?.targetMaterialTags))}`);
  lines.push(`- Target feature tags: ${code(valueList(target.extraction?.targetFeatureTags))}`);
  lines.push(`- Target process hints: ${code(valueList(target.extraction?.targetProcessHints))}`);
  lines.push("");
  lines.push("### Route Conflict");
  lines.push("");
  lines.push(`- Locked truth route: ${code(routeSignature(target, "lockedEvaluationActual") || "none")}`);
  lines.push(`- Current generated route: ${code(routeSignature(target, "currentGenerated") || "empty")}`);
  lines.push(`- Missing truth families: ${code(valueList(missingFamilies(target)))}`);
  lines.push(`- Extra generated families: ${code(valueList(extraFamilies(target)))}`);
  lines.push(`- Exact Training matches: ${target.trainingCoverage?.exactTrainingMatchCount ?? 0}`);
  lines.push(`- Covering Training matches: ${target.trainingCoverage?.coveringTrainingMatchCount ?? 0}`);
  lines.push("");
  lines.push("### Evidence Snippets");
  lines.push("");
  const snippets = evidenceSnippets(target);
  if (snippets.length === 0) {
    lines.push("- none captured in packet");
  } else {
    for (const snippet of snippets) lines.push(`- ${md(snippet)}`);
  }
  lines.push("");
  lines.push("### Manual Review Questions");
  lines.push("");
  for (const question of reviewQuestions(target)) lines.push(`- ${md(question)}`);
  lines.push("");
  lines.push("### Decision Before Any Write");
  lines.push("");
  lines.push("- If PDF and locked route do not match: correct data/source first; do not create Training from this row.");
  lines.push("- If PDF and locked route match: plan coherent Training coverage outside Evaluation; then rerun controlled holdout gates before route-generation changes.");
  lines.push("- If extraction prompt version is v2: consider controlled v3 re-extraction after source review, then compare evidence before any routing change.");
  lines.push("");
}

const outputJson = {
  generatedAt: new Date().toISOString(),
  inputPath,
  outputMdPath,
  gateStatus: {
    routeGenerationChange: "blocked",
    sampleRoleWrite: "blocked_until_source_review",
    materialization: "closed",
    workCenterAssignment: "closed"
  },
  coveragePlan,
  decisions
};

writeFileSync(outputJsonPath, `${JSON.stringify(outputJson, null, 2)}\n`, "utf8");
writeFileSync(outputMdPath, `${lines.join("\n").trimEnd()}\n`, "utf8");
console.log(JSON.stringify({
  generatedAt: outputJson.generatedAt,
  targetCount: decisions.length,
  coverageSignatureCount: coveragePlan.length,
  outputMdPath,
  outputJsonPath
}, null, 2));