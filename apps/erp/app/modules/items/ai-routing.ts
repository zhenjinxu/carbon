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

export type AiRoutingTargetEvidence = {
  id: string;
  itemId: string;
  readableId?: string | null;
  name?: string | null;
  materialTags: string[];
  featureTags: string[];
  drawingEvidence?: AiRoutingDrawingEvidenceFact[];
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
  ["轴类", /轴|shaft/i],
  ["箱体类", /箱体|壳体|housing|box/i],
  ["折弯", /折弯|bend/i]
];

const PROCESS_PATTERNS: Array<[string, RegExp]> = [
  ["激光切割", /激光|laser/i],
  ["折弯", /折弯|bend/i],
  ["攻丝", /攻丝|tap|thread/i],
  ["焊接", /焊|weld/i],
  ["打磨", /打磨|grind|polish/i],
  ["氧化", /氧化|anodiz/i],
  ["下料", /下料|cut.?off|blank/i],
  ["锯床", /锯|saw/i],
  ["铣削", /铣|milling|mill/i],
  ["车削", /车削|lathe|turn/i],
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

  return uniqueTags([
    ...(kindTags[fact.kind] ?? []),
    ...tagsFromPatterns(`${fact.label ?? ""} ${fact.text}`, FEATURE_PATTERNS)
  ]);
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

function normalizeSample(sample: AiRoutingSample): AiRoutingSample {
  return {
    ...sample,
    materialTags: uniqueTags(sample.materialTags),
    featureTags: uniqueTags(sample.featureTags),
    processTags: uniqueTags(sample.processTags),
    resourceTags: uniqueTags(sample.resourceTags)
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

  return {
    id: args.id,
    itemId: args.itemId,
    readableId: safeItem.readableId,
    name: safeItem.name,
    materialTags: itemTags.materialTags,
    featureTags: uniqueTags([
      ...itemTags.featureTags,
      ...drawingClassFeatureTags(drawing),
      ...tagsFromPatterns(drawingFeatureText, FEATURE_PATTERNS)
    ]),
    drawingEvidence: drawingEvidenceFacts(drawing),
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
    drawingEvidence: args.target.drawingEvidence ?? [],
    drawingWarnings: uniqueTags(args.target.drawingWarnings ?? [])
  };
  const limit = args.limit ?? 5;

  return args.samples
    .map(normalizeSample)
    .filter((sample) => args.includeSameItem || sample.itemId !== target.itemId)
    .filter(
      (sample) =>
        sample.status === "Approved" && sample.datasetRole !== "Evaluation"
    )
    .map((sample) => {
      const matched: AiRoutingKnowledgeTags = {
        materialTags: matchedTags(target.materialTags, sample.materialTags),
        featureTags: matchedTags(target.featureTags, sample.featureTags),
        processTags: [],
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
        b.matchedDrawingEvidence.length - a.matchedDrawingEvidence.length ||
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

  if (!best) {
    return {
      status: "Draft",
      targetItemId: args.target.itemId,
      suggestedOperations: [],
      references: ranked.map(rankedReference),
      warnings: [
        "No approved routing sample met the minimum similarity threshold."
      ]
    };
  }

  return {
    status: "Draft",
    targetItemId: args.target.itemId,
    suggestedOperations: best.sample.operations.map((operation) => ({
      ...operation,
      workCenterId: null,
      workCenterName: null,
      sourceSampleId: best.sampleId,
      sourceOperationId: operation.id,
      sourceOperationOrder: operation.order
    })),
    references: ranked.map(rankedReference),
    warnings: best.sample.operations.some(
      (operation) => operation.workCenterId || operation.workCenterName
    )
      ? [
          "Work center recommendations are withheld until resource capability evidence is available."
        ]
      : []
  };
}
