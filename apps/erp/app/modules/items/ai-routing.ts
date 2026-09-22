import type { AiRoutingDrawingExtraction } from "@carbon/lib/ai-routing-drawing";

export type AiRoutingOperation = {
  id?: string;
  order: number;
  processId?: string | null;
  processName?: string | null;
  workCenterId?: string | null;
  workCenterName?: string | null;
  operationType?: string | null;
  operationOrder?: string | null;
  description?: string | null;
  setupTime?: number | null;
  setupUnit?: string | null;
  laborTime?: number | null;
  laborUnit?: string | null;
  machineTime?: number | null;
  machineUnit?: string | null;
  customFields?: unknown;
};

export type AiRoutingKnowledgeItem = {
  id?: string;
  readableId?: string | null;
  name?: string | null;
  description?: string | null;
  material?: string | null;
  materialSubstance?: string | null;
  materialGrade?: string | null;
  materialForm?: string | null;
  customFields?: unknown;
};

export type AiRoutingKnowledgeTags = {
  materialTags: string[];
  featureTags: string[];
  processTags: string[];
  resourceTags: string[];
};

export type AiRoutingSampleScopeExclusionReason =
  | "component_scope"
  | "illegal_laser_no_plate";

export type AiRoutingSample = AiRoutingKnowledgeTags & {
  id: string;
  itemId: string;
  readableId?: string | null;
  name?: string | null;
  makeMethodId?: string | null;
  documentIds?: string[];
  operations: AiRoutingOperation[];
  status?: "Candidate" | "Approved" | "Retired";
  datasetRole?: "Training" | "Evaluation";
  customFields?: unknown;
  scopeExclusionReasons?: AiRoutingSampleScopeExclusionReason[];
};

export type AiRoutingDrawingEvidenceKind =
  | "dimension"
  | "hole"
  | "thread"
  | "slot"
  | "pocket"
  | "bend"
  | "weld"
  | "surface"
  | "note";

export type AiRoutingDrawingEvidenceFact = {
  kind: AiRoutingDrawingEvidenceKind;
  sourceId: string;
  evidenceId: string;
  label: string | null;
  pageNumber: number;
  text: string;
  confidence: number;
};

export type AiRoutingHumanEvidenceFact = {
  kind: "process_owner_review";
  sourceId: string;
  evidenceId: string;
  label: string | null;
  text: string;
  confidence: number;
  processHints: string[];
  sourceDocument?: string | null;
};

export type AiRoutingTargetEvidence = {
  id: string;
  itemId: string;
  readableId?: string | null;
  name?: string | null;
  materialTags: string[];
  featureTags: string[];
  processHints?: string[];
  drawingEvidence?: AiRoutingDrawingEvidenceFact[];
  humanEvidence?: AiRoutingHumanEvidenceFact[];
  drawingWarnings?: string[];
};

export type RankedAiRoutingSample = {
  sampleId: string;
  itemId: string;
  readableId?: string | null;
  name?: string | null;
  score: number;
  matched: AiRoutingKnowledgeTags;
  matchedDrawingEvidence: AiRoutingDrawingEvidenceFact[];
  sample: AiRoutingSample;
};

export type AiRoutingDraftOperation = AiRoutingOperation & {
  sourceSampleId: string;
  sourceOperationId?: string;
  sourceOperationOrder: number;
};

export type AiRoutingDraft = {
  status: "Draft";
  targetItemId: string;
  suggestedOperations: AiRoutingDraftOperation[];
  references: Omit<RankedAiRoutingSample, "sample">[];
  warnings: string[];
};

const SHAFT_EVIDENCE_PATTERN = /\u8f74(?!\s*\u627f)|shaft/i;
const OXIDATION_EVIDENCE_PATTERN = /氧化|阳极|anodiz|外协氧化/i;
const GALVANIZING_EVIDENCE_PATTERN = /\u9540\u950c|galvaniz/i;

const MATERIAL_PATTERNS: Array<[string, RegExp]> = [
  ["6061", /6061/i],
  ["7075", /7075/i],
  ["304", /\b304\b|sus304|不锈钢304/i],
  ["316", /\b316\b|sus316|不锈钢316/i],
  ["铝", /铝|aluminium|aluminum/i],
  ["不锈钢", /不锈钢|stainless/i],
  ["碳钢", /碳钢|carbon steel/i],
  ["塑料", /塑料|尼龙|abs|pom|pa66/i]
];

const FEATURE_PATTERNS: Array<[string, RegExp]> = [
  ["板件", /板|板件|sheet|plate/i],
  ["孔", /孔|攻丝|钻|hole|thread|tap/i],
  ["槽", /槽|slot|groove/i],
  ["台阶", /台阶|step/i],
  ["螺纹", /螺纹|thread/i],
  ["焊接件", /焊|焊接|weld/i],
  ["支架", /支架|bracket/i],
  ["轴类", SHAFT_EVIDENCE_PATTERN],
  ["箱体类", /箱体|壳体|housing|box/i],
  ["折弯", /折弯|bend/i]
];

const PROCESS_PATTERNS: Array<[string, RegExp]> = [
  ["激光切割", /激光|laser/i],
  ["折弯", /折弯|bend/i],
  ["攻丝", /攻丝|tap|thread|螺纹/i],
  ["钻孔", /钻|钻床|drill/i],
  ["焊接", /焊|weld/i],
  ["打磨", /打磨|拉丝|grind|polish/i],
  ["氧化", OXIDATION_EVIDENCE_PATTERN],
  ["\u9540\u950c", GALVANIZING_EVIDENCE_PATTERN],
  ["下料", /下料|cut.?off|blank/i],
  ["锯床", /锯|saw/i],
  ["铣削", /铣|加工中心|milling|mill/i],
  ["车削", /车床|车削|lathe|turn/i],
  ["领料", /领料|material issue/i]
];

function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
}

function uniqueTags(tags: Iterable<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function isCompoundNonPlateConnectorText(text: string) {
  return /推板.{0,12}(连接杆|连杆|拉杆|导杆|杆)|(?:连接杆|连杆|拉杆|导杆|杆).{0,12}推板/.test(
    text
  );
}

function removeMisleadingPlateTag(tags: string[], text: string) {
  if (!isCompoundNonPlateConnectorText(text)) return tags;
  return tags.filter((tag) => tag !== "板件");
}

type DrawingEvidenceEntry =
  AiRoutingDrawingExtraction["dimensions"][number]["evidence"][number];

function nullableText(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function drawingClassFeatureTags(extraction: AiRoutingDrawingExtraction) {
  const tags: string[] = [];

  if (
    extraction.part.class === "sheet-metal" ||
    extraction.part.stockForm === "sheet" ||
    extraction.part.stockForm === "plate"
  ) {
    tags.push("板件");
  }
  if (extraction.part.class === "weldment") tags.push("焊接件");
  if (extraction.features.holes.length > 0) tags.push("孔");
  if (
    extraction.features.threads.length > 0 ||
    extraction.features.holes.some((hole) => nullableText(hole.thread))
  ) {
    tags.push("螺纹");
  }
  if (extraction.features.slots.length > 0) tags.push("槽");
  if (extraction.features.bends.length > 0) tags.push("折弯");
  if (extraction.features.welds.length > 0) tags.push("焊接件");

  return tags;
}

function drawingProcessHints(
  extraction: AiRoutingDrawingExtraction,
  featureTags: string[]
) {
  const tags = new Set(uniqueTags(featureTags));
  const hints: string[] = [];
  const stockForm = extraction.part.stockForm;
  const partClass = extraction.part.class;
  const text = drawingText(extraction);
  const isSheetLike =
    partClass === "sheet-metal" ||
    stockForm === "sheet" ||
    stockForm === "plate" ||
    tags.has("板件");
  const hasExplicitLaserEvidence = /激光|laser/i.test(text);
  const hasLaserUnsuitableEvidence =
    /(?:不适合|不宜|不能|不可|禁止).{0,16}(?:激光|laser)|(?:激光|laser).{0,16}(?:不适合|不宜|不能|不可|禁止)|not suitable.{0,24}laser|laser.{0,24}not suitable/i.test(
      text
    );
  const isTubeLike = stockForm === "tube" || /管|tube/i.test(text);
  const surfaceProcessText = [
    extraction.titleBlock.finish,
    ...extraction.features.surfaces.flatMap((feature) => [
      feature.label,
      feature.finish,
      ...feature.evidence.map((evidence) => evidence.text)
    ])
  ]
    .filter(Boolean)
    .join(" ");
  const hasExplicitPolishEvidence = /打磨|抛光|拉丝|polish|grind/i.test(
    surfaceProcessText
  );
  const hasExplicitOxidationEvidence = OXIDATION_EVIDENCE_PATTERN.test(
    `${text} ${surfaceProcessText}`
  );
  const hasExplicitGalvanizingEvidence = GALVANIZING_EVIDENCE_PATTERN.test(
    `${text} ${surfaceProcessText}`
  );

  if (
    (isSheetLike || hasExplicitLaserEvidence) &&
    !hasLaserUnsuitableEvidence
  ) {
    hints.push("激光切割");
  }
  if (extraction.features.bends.length > 0) {
    hints.push("折弯");
  }
  if (
    tags.has("螺纹") ||
    extraction.features.threads.length > 0 ||
    extraction.features.holes.some((hole) => nullableText(hole.thread))
  ) {
    hints.push("攻丝");
  }
  if (isTubeLike) hints.push("锯床");
  if (tags.has("轴类") || SHAFT_EVIDENCE_PATTERN.test(text)) hints.push("车削");
  if (hasExplicitOxidationEvidence) hints.push("氧化");
  if (hasExplicitGalvanizingEvidence) hints.push("\u9540\u950c");
  if (tags.has("焊接件") || extraction.features.welds.length > 0) {
    hints.push("焊接");
  }
  if (hasExplicitPolishEvidence) hints.push("打磨");

  return uniqueTags(hints);
}
function drawingText(extraction: AiRoutingDrawingExtraction) {
  return [
    extraction.titleBlock.partNumber,
    extraction.titleBlock.material,
    extraction.titleBlock.finish,
    extraction.titleBlock.heatTreatment,
    extraction.part.class,
    extraction.part.stockForm,
    ...extraction.dimensions.flatMap((dimension) => [
      dimension.kind,
      dimension.label,
      dimension.nominal?.toString(),
      dimension.unit,
      ...dimension.evidence.map((evidence) => evidence.text)
    ]),
    ...Object.values(extraction.features).flatMap((features) =>
      features.flatMap((feature) => [
        feature.label,
        feature.quantity?.toString(),
        ...feature.evidence.map((evidence) => evidence.text)
      ])
    ),
    ...extraction.notes.flatMap((note) => [
      note.category,
      note.text,
      ...note.evidence.map((evidence) => evidence.text)
    ])
  ]
    .filter(Boolean)
    .join(" ");
}

function evidenceFacts(args: {
  kind: AiRoutingDrawingEvidenceKind;
  sourceId: string;
  label?: string | null;
  evidence: DrawingEvidenceEntry[];
}) {
  return args.evidence.map((evidence) => ({
    kind: args.kind,
    sourceId: args.sourceId,
    evidenceId: evidence.id,
    label: nullableText(args.label),
    pageNumber: evidence.pageNumber,
    text: evidence.text,
    confidence: evidence.confidence
  }));
}

function drawingEvidenceFacts(
  extraction: AiRoutingDrawingExtraction
): AiRoutingDrawingEvidenceFact[] {
  return [
    ...extraction.dimensions.flatMap((dimension) =>
      evidenceFacts({
        kind: "dimension",
        sourceId: dimension.id,
        label: dimension.label,
        evidence: dimension.evidence
      })
    ),
    ...extraction.features.holes.flatMap((feature) =>
      evidenceFacts({
        kind: "hole",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.threads.flatMap((feature) =>
      evidenceFacts({
        kind: "thread",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.slots.flatMap((feature) =>
      evidenceFacts({
        kind: "slot",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.pockets.flatMap((feature) =>
      evidenceFacts({
        kind: "pocket",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.bends.flatMap((feature) =>
      evidenceFacts({
        kind: "bend",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.welds.flatMap((feature) =>
      evidenceFacts({
        kind: "weld",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.features.surfaces.flatMap((feature) =>
      evidenceFacts({
        kind: "surface",
        sourceId: feature.id,
        label: feature.label,
        evidence: feature.evidence
      })
    ),
    ...extraction.notes.flatMap((note) =>
      evidenceFacts({
        kind: "note",
        sourceId: note.id,
        label: note.category,
        evidence: note.evidence
      })
    )
  ];
}

function tagsForDrawingEvidence(fact: AiRoutingDrawingEvidenceFact) {
  const kindTags: Partial<Record<AiRoutingDrawingEvidenceKind, string[]>> = {
    hole: ["孔"],
    thread: ["螺纹", "孔"],
    slot: ["槽"],
    bend: ["折弯"],
    weld: ["焊接件"],
    surface: [],
    dimension: [],
    pocket: [],
    note: []
  };

  const evidenceText = `${fact.label ?? ""} ${fact.text}`;

  return removeMisleadingPlateTag(
    uniqueTags([
      ...(kindTags[fact.kind] ?? []),
      ...tagsFromPatterns(evidenceText, FEATURE_PATTERNS)
    ]),
    evidenceText
  );
}

function matchedDrawingEvidence(
  target: AiRoutingTargetEvidence,
  sample: AiRoutingSample
) {
  const sampleFeatureTags = new Set(uniqueTags(sample.featureTags));

  return (target.drawingEvidence ?? [])
    .filter((fact) =>
      tagsForDrawingEvidence(fact).some((tag) => sampleFeatureTags.has(tag))
    )
    .slice(0, 8);
}

function tagsFromPatterns(text: string, patterns: Array<[string, RegExp]>) {
  return patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);
}

function customFieldText(customFields: unknown) {
  if (!customFields || typeof customFields !== "object") return "";
  try {
    return JSON.stringify(customFields);
  } catch {
    return "";
  }
}

export function routingKnowledgeTags(args: {
  item?: AiRoutingKnowledgeItem | null;
  operations?: Array<Partial<AiRoutingOperation>>;
}): AiRoutingKnowledgeTags {
  const item = args.item;
  const itemText = [
    item?.readableId,
    item?.name,
    item?.description,
    item?.material,
    item?.materialSubstance,
    item?.materialGrade,
    item?.materialForm,
    customFieldText(item?.customFields)
  ]
    .filter(Boolean)
    .join(" ");

  const operationText = (args.operations ?? [])
    .flatMap((operation) => [
      operation.processName,
      operation.workCenterName,
      operation.description,
      operation.operationType,
      operation.operationOrder,
      customFieldText(operation.customFields)
    ])
    .filter(Boolean)
    .join(" ");

  const allText = `${itemText} ${operationText}`;
  const resourceTags = uniqueTags(
    (args.operations ?? []).flatMap((operation) => [
      operation.workCenterName ?? undefined,
      operation.workCenterId ?? undefined
    ])
  );

  return {
    materialTags: uniqueTags(
      tagsFromPatterns(itemText || allText, MATERIAL_PATTERNS)
    ),
    featureTags: uniqueTags(tagsFromPatterns(allText, FEATURE_PATTERNS)),
    processTags: uniqueTags(
      tagsFromPatterns(operationText || allText, PROCESS_PATTERNS)
    ),
    resourceTags
  };
}

function matchedTags(targetTags: string[], sampleTags: string[]) {
  const target = new Set(uniqueTags(targetTags));
  return uniqueTags(sampleTags).filter((tag) => target.has(tag));
}

function weightedCoverage(
  targetTags: string[],
  matched: string[],
  weight: number
) {
  const denominator = uniqueTags(targetTags).length;
  if (denominator === 0) return 0;
  return (matched.length / denominator) * weight;
}

const AI_ROUTING_SAMPLE_SCOPE_EXCLUSION_REASONS =
  new Set<AiRoutingSampleScopeExclusionReason>([
    "component_scope",
    "illegal_laser_no_plate"
  ]);

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rawStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function rawObjectArray(value: unknown) {
  return Array.isArray(value) ? value.map(objectRecord) : [];
}

function unknownText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isAllowedHumanEvidence(value: unknown) {
  if (value === true) return true;
  const text = unknownText(value);
  return Boolean(text && /^(?:允许|是|approved|true|yes)$/i.test(text));
}

function humanEvidenceAllowedProcessHints(evidenceType: string | null) {
  if (evidenceType === "folded_edge_closure_requires_welding") {
    return new Set(["\u710a\u63a5", "\u6253\u78e8"]);
  }
  if (evidenceType === "shaft_stock_preparation_requires_saw_cutoff") {
    return new Set(["\u952f\u5e8a"]);
  }
  if (
    evidenceType ===
    "machined_plate_pad_tap_oxidation_requires_milling_base_route"
  ) {
    return new Set(["\u94e3\u524a"]);
  }
  return new Set<string>();
}

function humanEvidenceRequiredProcessHint(evidenceType: string | null) {
  if (evidenceType === "folded_edge_closure_requires_welding") {
    return "\u710a\u63a5";
  }
  if (evidenceType === "shaft_stock_preparation_requires_saw_cutoff") {
    return "\u952f\u5e8a";
  }
  if (
    evidenceType ===
    "machined_plate_pad_tap_oxidation_requires_milling_base_route"
  ) {
    return "\u94e3\u524a";
  }
  return null;
}

function humanEvidenceProcessHints(entry: Record<string, unknown>) {
  const evidenceType = unknownText(entry.evidenceType);
  const allowedProcessHints = humanEvidenceAllowedProcessHints(evidenceType);
  const explicitProcesses = rawStringArray(entry.processes).join(" ");
  const evidenceText = [
    explicitProcesses,
    unknownText(entry.text),
    unknownText(entry.explanation),
    unknownText(entry.label)
  ]
    .filter(Boolean)
    .join(" ");

  return uniqueTags(tagsFromPatterns(evidenceText, PROCESS_PATTERNS)).filter(
    (tag) => allowedProcessHints.has(tag)
  );
}

function aiRoutingHumanEvidenceFacts(
  customFields: unknown
): AiRoutingHumanEvidenceFact[] {
  const humanEvidence = objectRecord(
    objectRecord(customFields).aiRoutingHumanEvidence
  );
  const confirmations = rawObjectArray(humanEvidence.processConfirmations);

  return confirmations.flatMap((entry, index) => {
    const source = unknownText(entry.source);
    const evidenceType = unknownText(entry.evidenceType);
    const text = unknownText(entry.text) ?? unknownText(entry.explanation);
    const processHints = humanEvidenceProcessHints(entry);
    const requiredProcessHint = humanEvidenceRequiredProcessHint(evidenceType);

    if (
      source !== "process_owner_review" ||
      !requiredProcessHint ||
      !isAllowedHumanEvidence(entry.allowed) ||
      !text ||
      !processHints.includes(requiredProcessHint)
    ) {
      return [];
    }

    return [
      {
        kind: "process_owner_review" as const,
        sourceId: source,
        evidenceId: `${evidenceType}:${index + 1}`,
        label: evidenceType,
        text,
        confidence:
          typeof entry.confidence === "number"
            ? Math.max(0, Math.min(1, entry.confidence))
            : 1,
        processHints,
        sourceDocument: unknownText(entry.sourceDocument)
      }
    ];
  });
}

function isKnownScopeExclusionReason(
  reason: string
): reason is AiRoutingSampleScopeExclusionReason {
  return AI_ROUTING_SAMPLE_SCOPE_EXCLUSION_REASONS.has(
    reason as AiRoutingSampleScopeExclusionReason
  );
}

export function aiRoutingSampleScopeExclusionReasons(
  sample: Pick<
    AiRoutingSample,
    "customFields" | "name" | "readableId" | "scopeExclusionReasons"
  >
): AiRoutingSampleScopeExclusionReason[] {
  const reasons = new Set<AiRoutingSampleScopeExclusionReason>();

  for (const reason of sample.scopeExclusionReasons ?? []) {
    if (isKnownScopeExclusionReason(reason)) reasons.add(reason);
  }

  const scope = objectRecord(objectRecord(sample.customFields).aiRoutingScope);
  for (const reason of rawStringArray(scope.exclusionReasons)) {
    if (isKnownScopeExclusionReason(reason)) reasons.add(reason);
  }

  const sampleText = [sample.readableId, sample.name].filter(Boolean).join(" ");
  if (/\u7ec4\u4ef6/.test(sampleText)) reasons.add("component_scope");

  return [...reasons];
}

export function isAiRoutingTrainingReferenceEligible(
  sample: Pick<
    AiRoutingSample,
    "customFields" | "name" | "readableId" | "scopeExclusionReasons"
  >
) {
  return aiRoutingSampleScopeExclusionReasons(sample).length === 0;
}

function normalizeSample(sample: AiRoutingSample): AiRoutingSample {
  const operationTags = routingKnowledgeTags({
    operations: sample.operations
  }).processTags;

  return {
    ...sample,
    materialTags: uniqueTags(sample.materialTags),
    featureTags: uniqueTags(sample.featureTags),
    processTags:
      operationTags.length > 0 ? operationTags : uniqueTags(sample.processTags),
    resourceTags: uniqueTags(sample.resourceTags),
    customFields: sample.customFields,
    scopeExclusionReasons: aiRoutingSampleScopeExclusionReasons(sample)
  };
}

export function aiRoutingTargetEvidence(
  sample: AiRoutingSample
): AiRoutingTargetEvidence {
  return {
    id: sample.id,
    itemId: sample.itemId,
    readableId: sample.readableId,
    name: sample.name,
    materialTags: uniqueTags(sample.materialTags),
    featureTags: uniqueTags(sample.featureTags)
  };
}

export function aiRoutingTargetEvidenceFromDrawing(args: {
  id: string;
  itemId: string;
  item?: AiRoutingKnowledgeItem | null;
  drawingExtraction: AiRoutingDrawingExtraction;
}): AiRoutingTargetEvidence {
  const drawing = args.drawingExtraction;
  const item = args.item;
  const safeItem: AiRoutingKnowledgeItem = {
    readableId: item?.readableId ?? drawing.titleBlock.partNumber,
    name: item?.name,
    description: item?.description,
    material: drawing.titleBlock.material ?? item?.material,
    materialSubstance: item?.materialSubstance,
    materialGrade: item?.materialGrade,
    materialForm: item?.materialForm
  };
  const drawingFeatureText = drawingText(drawing);
  const itemTags = routingKnowledgeTags({ item: safeItem, operations: [] });
  const humanEvidence = aiRoutingHumanEvidenceFacts(item?.customFields);
  const humanFeatureTags = humanEvidence.flatMap((fact) =>
    fact.processHints.includes("焊接") ? ["焊接件"] : []
  );
  const featureTags = removeMisleadingPlateTag(
    uniqueTags([
      ...itemTags.featureTags,
      ...drawingClassFeatureTags(drawing),
      ...tagsFromPatterns(drawingFeatureText, FEATURE_PATTERNS),
      ...humanFeatureTags
    ]),
    [safeItem.name, drawingFeatureText].filter(Boolean).join(" ")
  );
  const processHints = uniqueTags([
    ...drawingProcessHints(drawing, featureTags),
    ...humanEvidence.flatMap((fact) => fact.processHints)
  ]);

  return {
    id: args.id,
    itemId: args.itemId,
    readableId: safeItem.readableId,
    name: safeItem.name,
    materialTags: itemTags.materialTags,
    featureTags,
    processHints,
    drawingEvidence: drawingEvidenceFacts(drawing),
    humanEvidence: humanEvidence.length > 0 ? humanEvidence : undefined,
    drawingWarnings: uniqueTags(drawing.warnings)
  };
}

export function rankSimilarRoutingSamples(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  limit?: number;
  includeSameItem?: boolean;
}): RankedAiRoutingSample[] {
  const target: AiRoutingTargetEvidence = {
    ...args.target,
    materialTags: uniqueTags(args.target.materialTags),
    featureTags: uniqueTags(args.target.featureTags),
    processHints: uniqueTags(args.target.processHints ?? []),
    drawingEvidence: args.target.drawingEvidence ?? [],
    humanEvidence: args.target.humanEvidence ?? [],
    drawingWarnings: uniqueTags(args.target.drawingWarnings ?? [])
  };
  const limit = args.limit ?? 5;
  const shouldPreferShorterSameScoreRoute =
    target.featureTags.length === 0 && target.processHints.length > 0;

  return args.samples
    .map(normalizeSample)
    .filter((sample) => args.includeSameItem || sample.itemId !== target.itemId)
    .filter(
      (sample) =>
        sample.status === "Approved" && sample.datasetRole !== "Evaluation"
    )
    .filter(isAiRoutingTrainingReferenceEligible)
    .map((sample) => {
      const matched: AiRoutingKnowledgeTags = {
        materialTags: matchedTags(target.materialTags, sample.materialTags),
        featureTags: matchedTags(target.featureTags, sample.featureTags),
        processTags: matchedTags(target.processHints ?? [], sample.processTags),
        resourceTags: []
      };
      const score = Math.round(
        weightedCoverage(target.materialTags, matched.materialTags, 35) +
          weightedCoverage(target.featureTags, matched.featureTags, 30)
      );

      return {
        sampleId: sample.id,
        itemId: sample.itemId,
        readableId: sample.readableId,
        name: sample.name,
        score,
        matched,
        matchedDrawingEvidence: matchedDrawingEvidence(target, sample),
        sample
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.matched.processTags.length - a.matched.processTags.length ||
        b.matchedDrawingEvidence.length - a.matchedDrawingEvidence.length ||
        (shouldPreferShorterSameScoreRoute &&
        a.matchedDrawingEvidence.length === 0 &&
        b.matchedDrawingEvidence.length === 0
          ? a.sample.operations.length - b.sample.operations.length
          : 0) ||
        a.sampleId.localeCompare(b.sampleId)
    )
    .slice(0, limit);
}

function rankedReference(ranked: RankedAiRoutingSample) {
  return {
    sampleId: ranked.sampleId,
    itemId: ranked.itemId,
    readableId: ranked.readableId,
    name: ranked.name,
    score: ranked.score,
    matched: ranked.matched,
    matchedDrawingEvidence: ranked.matchedDrawingEvidence
  };
}

function routingOperationSignature(sample: AiRoutingSample) {
  return sample.operations
    .map((operation) =>
      [operation.processName, operation.description]
        .filter((value): value is string => Boolean(value?.trim()))
        .join("|")
        .toLowerCase()
    )
    .join(">");
}

function hasWeakAmbiguousEvidence(
  target: AiRoutingTargetEvidence,
  ranked: RankedAiRoutingSample[],
  best: RankedAiRoutingSample
) {
  if (
    target.materialTags.length > 0 ||
    target.featureTags.length !== 1 ||
    target.featureTags[0] !== "板件" ||
    best.matchedDrawingEvidence.length > 0
  ) {
    return false;
  }

  const tied = ranked.filter(
    (candidate) =>
      candidate.score === best.score &&
      candidate.matchedDrawingEvidence.length ===
        best.matchedDrawingEvidence.length &&
      candidate.score > 0 &&
      candidate.sample.operations.length > 0
  );

  return (
    new Set(tied.map(({ sample }) => routingOperationSignature(sample))).size >
    1
  );
}

type SelectedDraftOperation = {
  operation: AiRoutingOperation;
  sourceSampleId: string;
  order: number;
};

type EvidenceOperationSelection = {
  operations: SelectedDraftOperation[];
  reference?: RankedAiRoutingSample;
};

function operationProcessTags(operation: AiRoutingOperation) {
  return routingKnowledgeTags({ operations: [operation] }).processTags;
}

function operationEvidenceTags(operation: AiRoutingOperation) {
  return operationProcessTags(operation).filter((tag) => tag !== "下料");
}

function isMaterialIssueOperation(operation: AiRoutingOperation) {
  return /领料|material issue/i.test(operation.processName ?? "");
}

function isOperationSupportedByProcessHints(
  operation: AiRoutingOperation,
  targetProcessHints: Set<string>
) {
  if (isMaterialIssueOperation(operation)) return true;

  const tags = operationEvidenceTags(operation).filter((tag) => tag !== "领料");

  return tags.length > 0 && tags.some((tag) => targetProcessHints.has(tag));
}

function hasExplicitOxidationDrawingEvidence(target: AiRoutingTargetEvidence) {
  return (target.drawingEvidence ?? []).some(
    (fact) =>
      (fact.kind === "surface" || fact.kind === "note") &&
      OXIDATION_EVIDENCE_PATTERN.test(`${fact.label ?? ""} ${fact.text}`)
  );
}

function hasExplicitWeldDrawingEvidence(target: AiRoutingTargetEvidence) {
  return (target.drawingEvidence ?? []).some((fact) => {
    if (fact.kind === "weld") return true;
    return (
      fact.kind === "note" &&
      /焊接|焊缝|焊后|weld/i.test(`${fact.label ?? ""} ${fact.text}`)
    );
  });
}

function hasHumanConfirmedWeldEvidence(target: AiRoutingTargetEvidence) {
  return (target.humanEvidence ?? []).some(
    (fact) =>
      fact.kind === "process_owner_review" &&
      fact.label === "folded_edge_closure_requires_welding" &&
      fact.processHints.includes("焊接")
  );
}

function hasExplicitWeldEvidence(target: AiRoutingTargetEvidence) {
  return (
    hasExplicitWeldDrawingEvidence(target) ||
    hasHumanConfirmedWeldEvidence(target)
  );
}

function hasExplicitPolishDrawingEvidence(target: AiRoutingTargetEvidence) {
  return (target.drawingEvidence ?? []).some(
    (fact) =>
      (fact.kind === "surface" || fact.kind === "note") &&
      /打磨|抛光|拉丝|polish|grind/i.test(`${fact.label ?? ""} ${fact.text}`)
  );
}

function hasDrawingEvidenceKind(
  facts: AiRoutingDrawingEvidenceFact[],
  kind: AiRoutingDrawingEvidenceKind
) {
  return facts.some((fact) => fact.kind === kind);
}

const GUARDED_COMPOSED_BASE_OPERATION_TAGS = new Set([
  "铣削",
  "折弯",
  "焊接",
  "打磨",
  "氧化",
  "\u9540\u950c"
]);

function isGuardedComposedBaseOperationSupported(args: {
  operation: AiRoutingOperation;
  targetFeatureTags: Set<string>;
  targetProcessHints: Set<string>;
  targetDrawingEvidence: AiRoutingDrawingEvidenceFact[];
}) {
  if (isMaterialIssueOperation(args.operation)) return true;
  if (
    args.targetProcessHints.size === 0 &&
    args.targetDrawingEvidence.length === 0
  ) {
    return true;
  }

  const operationTags = operationEvidenceTags(args.operation).filter(
    (tag) => tag !== "领料"
  );
  if (operationTags.length === 0) return true;

  const hasWeakBendTextEvidence = args.targetDrawingEvidence.some(
    (fact) =>
      fact.kind === "note" &&
      /折弯|bend/i.test(`${fact.label ?? ""} ${fact.text}`)
  );

  return operationTags.every((tag) => {
    if (!GUARDED_COMPOSED_BASE_OPERATION_TAGS.has(tag)) return true;
    if (args.targetProcessHints.has(tag)) return true;
    if (tag === "折弯") {
      return (
        hasDrawingEvidenceKind(args.targetDrawingEvidence, "bend") ||
        (args.targetFeatureTags.has("折弯") && !hasWeakBendTextEvidence)
      );
    }
    if (tag === "焊接") {
      return hasDrawingEvidenceKind(args.targetDrawingEvidence, "weld");
    }
    return false;
  });
}

function shouldRetainComposedBaseOperation(args: {
  operation: AiRoutingOperation;
  targetFeatureTags: Set<string>;
  targetProcessHints: Set<string>;
  targetDrawingEvidence: AiRoutingDrawingEvidenceFact[];
}) {
  return (
    shouldRetainBaseOperation(args) &&
    isGuardedComposedBaseOperationSupported({
      operation: args.operation,
      targetFeatureTags: args.targetFeatureTags,
      targetProcessHints: args.targetProcessHints,
      targetDrawingEvidence: args.targetDrawingEvidence
    })
  );
}

function canUseBelowThresholdOxidationCandidate(args: {
  candidate: RankedAiRoutingSample;
  supportedMissingTags: string[];
  targetHasExplicitOxidationEvidence: boolean;
}) {
  return (
    args.targetHasExplicitOxidationEvidence &&
    args.candidate.score > 0 &&
    args.candidate.matched.processTags.includes("氧化") &&
    args.supportedMissingTags.includes("氧化")
  );
}

function drillTapEvidenceOperations(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  best: RankedAiRoutingSample;
  minimumScore: number;
}): EvidenceOperationSelection | null {
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const hasHoleEvidence = targetDrawingEvidence.some(
    (fact) => fact.kind === "hole"
  );
  const threadEvidenceCount = targetDrawingEvidence.filter(
    (fact) => fact.kind === "thread"
  ).length;
  const hasThreadEvidence = threadEvidenceCount > 0;
  const hasDisqualifyingFeature = [
    "板件",
    "轴类",
    "折弯",
    "焊接件",
    "槽",
    "台阶"
  ].some((tag) => targetFeatureTags.has(tag));
  const hasDisqualifyingHint = [
    "激光切割",
    "折弯",
    "车削",
    "锯床",
    "焊接",
    "氧化"
  ].some((tag) => targetProcessHints.has(tag));

  if (
    !targetFeatureTags.has("孔") ||
    !targetFeatureTags.has("螺纹") ||
    hasDisqualifyingFeature ||
    hasDisqualifyingHint ||
    !targetProcessHints.has("攻丝") ||
    !hasHoleEvidence ||
    !hasThreadEvidence ||
    threadEvidenceCount < 2
  ) {
    return null;
  }

  const bestTags = new Set(
    args.best.sample.operations.flatMap(operationProcessTags)
  );
  if (bestTags.has("钻孔") || !bestTags.has("攻丝") || !bestTags.has("铣削")) {
    return null;
  }

  const supportingProcessHints = new Set([...targetProcessHints, "钻孔"]);
  const expandedRanked = rankSimilarRoutingSamples({
    target: args.target,
    samples: args.samples,
    limit: 20
  });
  const candidate = expandedRanked.find((ranked) => {
    const operationTags = new Set(
      ranked.sample.operations.flatMap(operationProcessTags)
    );

    return (
      ranked.score > 0 &&
      ranked.score < args.minimumScore &&
      ranked.matched.featureTags.includes("孔") &&
      ranked.matched.processTags.includes("攻丝") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "hole") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "thread") &&
      operationTags.has("钻孔") &&
      operationTags.has("攻丝")
    );
  });

  if (!candidate) return null;

  const operations = candidate.sample.operations.filter(
    (operation) =>
      shouldRetainBaseOperation({
        operation,
        targetFeatureTags,
        targetProcessHints: supportingProcessHints,
        targetDrawingEvidence
      }) &&
      isOperationSupportedByProcessHints(operation, supportingProcessHints)
  );
  const retainedTags = new Set(operations.flatMap(operationEvidenceTags));

  if (!retainedTags.has("钻孔") || !retainedTags.has("攻丝")) {
    return null;
  }

  return {
    operations: operations.map((operation) => ({
      operation,
      sourceSampleId: candidate.sampleId,
      order: operation.order
    })),
    reference: candidate
  };
}
function laserTurnEvidenceOperations(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  best: RankedAiRoutingSample;
  minimumScore: number;
}): EvidenceOperationSelection | null {
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const hasHoleEvidence = targetDrawingEvidence.some(
    (fact) => fact.kind === "hole"
  );
  const hasDisqualifyingFeature = ["螺纹", "折弯", "焊接件", "槽", "台阶"].some(
    (tag) => targetFeatureTags.has(tag)
  );
  const hasDisqualifyingHint = ["攻丝", "锯床", "折弯", "焊接", "氧化"].some(
    (tag) => targetProcessHints.has(tag)
  );

  if (
    !targetFeatureTags.has("板件") ||
    !targetFeatureTags.has("轴类") ||
    !targetFeatureTags.has("孔") ||
    hasDisqualifyingFeature ||
    !targetProcessHints.has("激光切割") ||
    !targetProcessHints.has("车削") ||
    hasDisqualifyingHint ||
    !hasHoleEvidence
  ) {
    return null;
  }

  const bestTags = new Set(
    args.best.sample.operations.flatMap(operationProcessTags)
  );
  if (!bestTags.has("激光切割") || bestTags.has("车削")) {
    return null;
  }

  const expandedRanked = rankSimilarRoutingSamples({
    target: args.target,
    samples: args.samples,
    limit: args.samples.length
  });
  const candidate = expandedRanked.find((ranked) => {
    const operationTags = new Set(
      ranked.sample.operations.flatMap(operationProcessTags)
    );

    return (
      ranked.score > 0 &&
      ranked.score < args.minimumScore &&
      ranked.matched.featureTags.includes("轴类") &&
      ranked.matched.processTags.includes("车削") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "hole") &&
      operationTags.has("车削")
    );
  });

  if (!candidate) return null;

  const baseOperations = args.best.sample.operations.filter((operation) =>
    shouldRetainBaseOperation({
      operation,
      targetFeatureTags,
      targetProcessHints,
      targetDrawingEvidence
    })
  );
  const selected: SelectedDraftOperation[] = baseOperations.map(
    (operation) => ({
      operation,
      sourceSampleId: args.best.sampleId,
      order: operation.order
    })
  );
  const selectedProcessTags = new Set(
    baseOperations.flatMap(operationProcessTags)
  );
  if (!selectedProcessTags.has("激光切割")) return null;

  const turningOperation = candidate.sample.operations.find(
    (operation) =>
      operationEvidenceTags(operation).includes("车削") &&
      isOperationSupportedByProcessHints(operation, targetProcessHints)
  );
  if (!turningOperation) return null;

  selected.push({
    operation: turningOperation,
    sourceSampleId: candidate.sampleId,
    order: Math.max(0, ...selected.map(({ order }) => order)) + 10
  });

  return {
    operations: selected,
    reference: candidate
  };
}
function threadedShaftTurnEvidenceOperations(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  best: RankedAiRoutingSample;
  minimumScore: number;
}): EvidenceOperationSelection | null {
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const hasHoleEvidence = targetDrawingEvidence.some(
    (fact) => fact.kind === "hole"
  );
  const hasThreadEvidence = targetDrawingEvidence.some(
    (fact) => fact.kind === "thread"
  );
  const hasDisqualifyingFeature = ["板件", "折弯", "焊接件", "槽", "台阶"].some(
    (tag) => targetFeatureTags.has(tag)
  );
  const hasDisqualifyingHint = [
    "激光切割",
    "锯床",
    "折弯",
    "焊接",
    "氧化"
  ].some((tag) => targetProcessHints.has(tag));

  if (
    !targetFeatureTags.has("轴类") ||
    !targetFeatureTags.has("孔") ||
    !targetFeatureTags.has("螺纹") ||
    hasDisqualifyingFeature ||
    hasDisqualifyingHint ||
    !targetProcessHints.has("攻丝") ||
    !targetProcessHints.has("车削") ||
    !hasHoleEvidence ||
    !hasThreadEvidence
  ) {
    return null;
  }

  const bestTags = new Set(
    args.best.sample.operations.flatMap(operationProcessTags)
  );
  if (!bestTags.has("铣削") || !bestTags.has("攻丝") || bestTags.has("车削")) {
    return null;
  }

  const expandedRanked = rankSimilarRoutingSamples({
    target: args.target,
    samples: args.samples,
    limit: 20
  });
  const candidate = expandedRanked.find((ranked) => {
    const operationTags = new Set(
      ranked.sample.operations.flatMap(operationProcessTags)
    );

    return (
      ranked.score > 0 &&
      ranked.score < args.minimumScore &&
      ranked.matched.featureTags.includes("轴类") &&
      ranked.matched.featureTags.includes("孔") &&
      ranked.matched.processTags.includes("车削") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "hole") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "thread") &&
      operationTags.has("车削")
    );
  });

  if (!candidate) return null;

  const baseOperations = args.best.sample.operations.filter((operation) =>
    shouldRetainBaseOperation({
      operation,
      targetFeatureTags,
      targetProcessHints,
      targetDrawingEvidence
    })
  );
  const selected: SelectedDraftOperation[] = baseOperations.map(
    (operation) => ({
      operation,
      sourceSampleId: args.best.sampleId,
      order: operation.order
    })
  );
  const selectedProcessTags = new Set(
    baseOperations.flatMap(operationProcessTags)
  );
  if (!selectedProcessTags.has("铣削") || !selectedProcessTags.has("攻丝")) {
    return null;
  }

  const turningOperation = candidate.sample.operations.find(
    (operation) =>
      operationEvidenceTags(operation).includes("车削") &&
      isOperationSupportedByProcessHints(operation, targetProcessHints)
  );
  if (!turningOperation) return null;

  const baseIssueOrders = selected
    .filter(({ operation }) => isMaterialIssueOperation(operation))
    .map(({ order }) => order);
  const baseNonIssueOrders = selected
    .filter(({ operation }) => !isMaterialIssueOperation(operation))
    .map(({ order }) => order);
  const previousOrder = Math.max(0, ...baseIssueOrders);
  const nextOrder = Math.min(...baseNonIssueOrders);
  const insertedOrder = Number.isFinite(nextOrder)
    ? (previousOrder + nextOrder) / 2
    : previousOrder + 10;

  selected.push({
    operation: turningOperation,
    sourceSampleId: candidate.sampleId,
    order: insertedOrder
  });

  return {
    operations: selected,
    reference: candidate
  };
}
function weldGrindEvidenceOperations(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  best: RankedAiRoutingSample;
  minimumScore: number;
}): EvidenceOperationSelection | null {
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const hasDisqualifyingHint = ["车削", "锯床", "氧化"].some((tag) =>
    targetProcessHints.has(tag)
  );

  if (
    !targetProcessHints.has("焊接") ||
    !targetProcessHints.has("打磨") ||
    !hasExplicitWeldEvidence(args.target) ||
    !hasExplicitPolishDrawingEvidence(args.target) ||
    hasDisqualifyingHint
  ) {
    return null;
  }

  const baseOperations = args.best.sample.operations.filter((operation) =>
    shouldRetainComposedBaseOperation({
      operation,
      targetFeatureTags,
      targetProcessHints,
      targetDrawingEvidence
    })
  );
  const baseProcessTags = new Set(baseOperations.flatMap(operationProcessTags));
  if (!baseProcessTags.has("激光切割") && !baseProcessTags.has("折弯")) {
    return null;
  }
  if (baseProcessTags.has("焊接") && baseProcessTags.has("打磨")) {
    return null;
  }

  const expandedRanked = rankSimilarRoutingSamples({
    target: args.target,
    samples: args.samples,
    limit: args.samples.length
  });
  const candidate = expandedRanked.find((ranked) => {
    if (ranked.sampleId === args.best.sampleId) return false;

    const operationTags = new Set(
      ranked.sample.operations.flatMap(operationProcessTags)
    );

    return (
      ranked.score > 0 &&
      ranked.score < args.minimumScore &&
      ranked.matched.processTags.includes("焊接") &&
      ranked.matched.processTags.includes("打磨") &&
      operationTags.has("焊接") &&
      operationTags.has("打磨")
    );
  });

  if (!candidate) return null;

  const selected: SelectedDraftOperation[] = baseOperations.map(
    (operation) => ({
      operation,
      sourceSampleId: args.best.sampleId,
      order: operation.order
    })
  );
  const selectedProcessTags = new Set(baseProcessTags);
  let nextOrder = Math.max(0, ...selected.map(({ order }) => order)) + 10;

  for (const operation of candidate.sample.operations) {
    const missingWeldGrindTags = operationEvidenceTags(operation).filter(
      (tag) =>
        (tag === "焊接" || tag === "打磨") && !selectedProcessTags.has(tag)
    );
    if (missingWeldGrindTags.length === 0) continue;
    if (!isOperationSupportedByProcessHints(operation, targetProcessHints)) {
      continue;
    }

    selected.push({
      operation,
      sourceSampleId: candidate.sampleId,
      order: nextOrder
    });
    nextOrder += 10;
    for (const tag of missingWeldGrindTags) selectedProcessTags.add(tag);
  }

  if (!selectedProcessTags.has("焊接") || !selectedProcessTags.has("打磨")) {
    return null;
  }

  return {
    operations: selected,
    reference: candidate
  };
}
function sheetBendEvidenceOperations(args: {
  target: AiRoutingTargetEvidence;
  ranked: RankedAiRoutingSample[];
  minimumScore: number;
}): SelectedDraftOperation[] | null {
  const targetMaterialTags = uniqueTags(args.target.materialTags);
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const hasExplicitBendEvidence = targetDrawingEvidence.some(
    (fact) => fact.kind === "bend"
  );

  if (
    targetMaterialTags.length > 0 ||
    !targetFeatureTags.has("板件") ||
    !targetFeatureTags.has("折弯") ||
    !targetProcessHints.has("激光切割") ||
    !targetProcessHints.has("折弯") ||
    !hasExplicitBendEvidence
  ) {
    return null;
  }

  const candidate = args.ranked.find(
    (ranked) =>
      ranked.score >= 30 &&
      ranked.score < args.minimumScore &&
      ranked.matched.featureTags.includes("板件") &&
      ranked.matched.featureTags.includes("折弯") &&
      ranked.matchedDrawingEvidence.some((fact) => fact.kind === "bend") &&
      ranked.sample.operations.length > 0
  );

  if (!candidate) return null;

  const operations = candidate.sample.operations.filter(
    (operation) =>
      shouldRetainBaseOperation({
        operation,
        targetFeatureTags,
        targetProcessHints,
        targetDrawingEvidence
      }) && isOperationSupportedByProcessHints(operation, targetProcessHints)
  );
  const retainedTags = new Set(operations.flatMap(operationEvidenceTags));

  if (!retainedTags.has("激光切割") || !retainedTags.has("折弯")) {
    return null;
  }

  return operations.map((operation) => ({
    operation,
    sourceSampleId: candidate.sampleId,
    order: operation.order
  }));
}

function shouldRetainBaseOperation(args: {
  operation: AiRoutingOperation;
  targetFeatureTags: Set<string>;
  targetProcessHints: Set<string>;
  targetDrawingEvidence: AiRoutingDrawingEvidenceFact[];
}) {
  const operationTags = operationProcessTags(args.operation);

  const hasHoleEvidence = args.targetDrawingEvidence.some(
    (fact) => fact.kind === "hole"
  );
  const hasThreadEvidence = args.targetDrawingEvidence.some(
    (fact) => fact.kind === "thread"
  );
  const hasSpecificNonBendFeature = ["孔", "槽", "螺纹", "台阶"].some((tag) =>
    args.targetFeatureTags.has(tag)
  );

  if (
    args.targetProcessHints.size > 0 &&
    hasSpecificNonBendFeature &&
    operationTags.includes("折弯") &&
    !args.targetProcessHints.has("折弯") &&
    !args.targetFeatureTags.has("折弯")
  ) {
    return false;
  }

  if (
    hasHoleEvidence &&
    !hasThreadEvidence &&
    operationTags.includes("攻丝") &&
    !args.targetProcessHints.has("攻丝") &&
    !args.targetFeatureTags.has("螺纹")
  ) {
    return false;
  }

  return true;
}

function composeSuggestedOperations(args: {
  target: AiRoutingTargetEvidence;
  ranked: RankedAiRoutingSample[];
  best: RankedAiRoutingSample;
  minimumScore: number;
}): SelectedDraftOperation[] {
  const targetFeatureTags = new Set(uniqueTags(args.target.featureTags));
  const targetProcessHints = new Set(
    uniqueTags(args.target.processHints ?? [])
  );
  const targetDrawingEvidence = args.target.drawingEvidence ?? [];
  const targetHasExplicitOxidationEvidence =
    targetProcessHints.has("氧化") &&
    hasExplicitOxidationDrawingEvidence(args.target);
  const baseOperations = args.best.sample.operations.filter((operation) =>
    shouldRetainComposedBaseOperation({
      operation,
      targetFeatureTags,
      targetProcessHints,
      targetDrawingEvidence
    })
  );
  const selected: SelectedDraftOperation[] = baseOperations.map(
    (operation) => ({
      operation,
      sourceSampleId: args.best.sampleId,
      order: operation.order
    })
  );
  const selectedProcessTags = new Set(
    baseOperations.flatMap(operationProcessTags)
  );
  let nextOrder = Math.max(0, ...selected.map(({ order }) => order)) + 10;

  if (targetProcessHints.size === 0) return selected;

  for (const candidate of args.ranked) {
    if (candidate.sampleId === args.best.sampleId) continue;

    for (const operation of candidate.sample.operations) {
      const supportedMissingTags = operationProcessTags(operation).filter(
        (tag) => targetProcessHints.has(tag) && !selectedProcessTags.has(tag)
      );
      if (supportedMissingTags.length === 0) continue;
      if (
        candidate.score < args.minimumScore &&
        !canUseBelowThresholdOxidationCandidate({
          candidate,
          supportedMissingTags,
          targetHasExplicitOxidationEvidence
        })
      ) {
        continue;
      }

      selected.push({
        operation,
        sourceSampleId: candidate.sampleId,
        order: nextOrder
      });
      nextOrder += 10;
      for (const tag of supportedMissingTags) selectedProcessTags.add(tag);
    }
  }

  return selected;
}
export function generateAiRoutingDraft(args: {
  target: AiRoutingTargetEvidence;
  samples: AiRoutingSample[];
  limit?: number;
  minimumScore?: number;
}): AiRoutingDraft {
  const minimumScore = args.minimumScore ?? 35;
  const ranked = rankSimilarRoutingSamples({
    target: args.target,
    samples: args.samples,
    limit: args.limit ?? 5
  });
  const best = ranked.find(
    (candidate) =>
      candidate.score >= minimumScore && candidate.sample.operations.length > 0
  );

  let selectedOperations: SelectedDraftOperation[] | null = null;
  let referenceRanked = ranked;

  if (best) {
    const drillTapSelection = drillTapEvidenceOperations({
      target: args.target,
      samples: args.samples,
      best,
      minimumScore
    });

    if (drillTapSelection) {
      selectedOperations = drillTapSelection.operations;
      if (
        drillTapSelection.reference &&
        !referenceRanked.some(
          (reference) =>
            reference.sampleId === drillTapSelection.reference?.sampleId
        )
      ) {
        referenceRanked = [...referenceRanked, drillTapSelection.reference];
      }
    } else {
      const laserTurnSelection = laserTurnEvidenceOperations({
        target: args.target,
        samples: args.samples,
        best,
        minimumScore
      });

      if (laserTurnSelection) {
        selectedOperations = laserTurnSelection.operations;
        if (
          laserTurnSelection.reference &&
          !referenceRanked.some(
            (reference) =>
              reference.sampleId === laserTurnSelection.reference?.sampleId
          )
        ) {
          referenceRanked = [...referenceRanked, laserTurnSelection.reference];
        }
      } else {
        const threadedShaftTurnSelection = threadedShaftTurnEvidenceOperations({
          target: args.target,
          samples: args.samples,
          best,
          minimumScore
        });

        if (threadedShaftTurnSelection) {
          selectedOperations = threadedShaftTurnSelection.operations;
          if (
            threadedShaftTurnSelection.reference &&
            !referenceRanked.some(
              (reference) =>
                reference.sampleId ===
                threadedShaftTurnSelection.reference?.sampleId
            )
          ) {
            referenceRanked = [
              ...referenceRanked,
              threadedShaftTurnSelection.reference
            ];
          }
        }
      }

      if (!selectedOperations) {
        const weldGrindSelection = weldGrindEvidenceOperations({
          target: args.target,
          samples: args.samples,
          best,
          minimumScore
        });

        if (weldGrindSelection) {
          selectedOperations = weldGrindSelection.operations;
          if (
            weldGrindSelection.reference &&
            !referenceRanked.some(
              (reference) =>
                reference.sampleId === weldGrindSelection.reference?.sampleId
            )
          ) {
            referenceRanked = [
              ...referenceRanked,
              weldGrindSelection.reference
            ];
          }
        }
      }

      if (
        !selectedOperations &&
        hasWeakAmbiguousEvidence(args.target, ranked, best)
      ) {
        return {
          status: "Draft",
          targetItemId: args.target.itemId,
          suggestedOperations: [],
          references: referenceRanked.map(rankedReference),
          warnings: [
            "Insufficient PDF evidence to choose among equally scored routing samples."
          ]
        };
      }

      if (!selectedOperations) {
        selectedOperations = composeSuggestedOperations({
          target: args.target,
          ranked,
          best,
          minimumScore
        });
      }
    }
  } else {
    selectedOperations = sheetBendEvidenceOperations({
      target: args.target,
      ranked,
      minimumScore
    });
  }

  if (!selectedOperations) {
    return {
      status: "Draft",
      targetItemId: args.target.itemId,
      suggestedOperations: [],
      references: referenceRanked.map(rankedReference),
      warnings: [
        "No approved routing sample met the minimum similarity threshold."
      ]
    };
  }

  return {
    status: "Draft",
    targetItemId: args.target.itemId,
    suggestedOperations: selectedOperations.map(
      ({ operation, sourceSampleId, order }) => ({
        ...operation,
        order,
        workCenterId: null,
        workCenterName: null,
        sourceSampleId,
        sourceOperationId: operation.id,
        sourceOperationOrder: operation.order
      })
    ),
    references: referenceRanked.map(rankedReference),
    warnings: selectedOperations.some(
      ({ operation }) => operation.workCenterId || operation.workCenterName
    )
      ? [
          "Work center recommendations are withheld until resource capability evidence is available."
        ]
      : []
  };
}
