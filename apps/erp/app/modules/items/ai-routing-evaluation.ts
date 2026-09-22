import type { AiRoutingOperation } from "./ai-routing";

type EvaluationOperation = Pick<
  AiRoutingOperation,
  | "order"
  | "processId"
  | "processName"
  | "description"
  | "workCenterId"
  | "workCenterName"
>;

export type AiRoutingEvaluationCaseInput = {
  evaluationSampleId: string;
  targetItemId: string;
  targetExtractionId: string;
  expectedOperations: EvaluationOperation[];
  suggestedOperations: EvaluationOperation[];
  referenceSampleIds?: string[];
  warnings?: string[];
};

export type AiRoutingEvaluationCaseResult = {
  evaluationSampleId: string;
  targetItemId: string;
  targetExtractionId: string;
  expectedOperationCount: number;
  suggestedOperationCount: number;
  rawExactSequenceMatch: boolean;
  normalizedExactSequenceMatch: boolean;
  rawPositionMatchCount: number;
  normalizedPositionMatchCount: number;
  orderedSequenceSimilarity: number;
  semanticPrecision: number;
  semanticRecall: number;
  semanticF1: number;
  evaluationLeakCount: number;
  workCenterAssignmentCount: number;
  unsupportedWorkCenterAssignmentCount: number;
  missingProcessIdCount: number;
  invalidProcessIds: string[];
  warnings: string[];
};

export type AiRoutingProductionGate = {
  eligible: boolean;
  minimumHoldouts: number;
  reason: string | null;
};

export type AiRoutingEvaluationMetrics = {
  holdoutCount: number;
  rawExactSequenceMatches: number;
  normalizedExactSequenceMatches: number;
  rawPositionMatchCount: number;
  normalizedPositionMatchCount: number;
  orderedSequenceSimilarity: number;
  semanticPrecision: number;
  semanticRecall: number;
  semanticF1: number;
  totalEvaluationLeaks: number;
  totalWorkCenterAssignments: number;
  totalUnsupportedWorkCenterAssignments: number;
  totalMissingProcessIds: number;
  invalidProcessIds: string[];
  productionGate: AiRoutingProductionGate;
};

export type AiRoutingEvaluationResult = {
  caseResults: AiRoutingEvaluationCaseResult[];
  metrics: AiRoutingEvaluationMetrics;
};

export type AiRoutingEvaluationRunRecord = AiRoutingEvaluationResult & {
  companyId: string;
  status: "Succeeded";
  trainingSampleIds: string[];
  evaluationSampleIds: string[];
  generatorVersion: string;
  promptVersion: string | null;
  extractorSchemaVersion: string;
  modelProvider: string | null;
  modelName: string | null;
  createdBy: string;
  completedAt: string;
};

function normalizedText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

/** Normalize provider-specific process labels without treating IDs as semantics. */
export function normalizeAiRoutingProcessSemanticName(
  value: string | null | undefined
) {
  const normalized = normalizedText(value)
    .replace(/^u8\s+[a-z0-9_-]+\s+/i, "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/\s+/g, " ")
    .replace(/\s*([()])\s*/g, "$1");

  return normalized.replace(/^普通车床[^()]*\(机加工\)$/i, "普通车床(机加工)");
}

function sortedOperations(operations: EvaluationOperation[]) {
  return [...operations].sort((a, b) => a.order - b.order);
}

function processId(operation: EvaluationOperation) {
  const value = normalizedText(operation.processId);
  return value || null;
}

function workCenterId(operation: EvaluationOperation) {
  const value = normalizedText(operation.workCenterId);
  return value || null;
}

function workCenterProcessPairKey(args: {
  processId: string;
  workCenterId: string;
}) {
  return `${args.processId}\u0000${args.workCenterId}`;
}

function semanticName(operation: EvaluationOperation) {
  return normalizeAiRoutingProcessSemanticName(
    operation.processName ?? operation.description ?? operation.processId
  );
}

function positionMatches(
  expected: EvaluationOperation[],
  suggested: EvaluationOperation[],
  match: (
    expected: EvaluationOperation,
    suggested: EvaluationOperation
  ) => boolean
) {
  return expected.reduce(
    (count, operation, index) =>
      count + (suggested[index] && match(operation, suggested[index]) ? 1 : 0),
    0
  );
}

function multisetIntersectionCount(expected: string[], suggested: string[]) {
  const counts = new Map<string, number>();
  for (const value of expected) {
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let matches = 0;
  for (const value of suggested) {
    const count = counts.get(value) ?? 0;
    if (count > 0) {
      matches += 1;
      counts.set(value, count - 1);
    }
  }
  return matches;
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : numerator / denominator;
}

function f1(precision: number, recall: number) {
  return precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
}

const PRODUCTION_GATE_MINIMUM_HOLDOUTS = 30;

function productionGateForHoldouts(
  holdoutCount: number
): AiRoutingProductionGate {
  if (holdoutCount >= PRODUCTION_GATE_MINIMUM_HOLDOUTS) {
    return {
      eligible: true,
      minimumHoldouts: PRODUCTION_GATE_MINIMUM_HOLDOUTS,
      reason: null
    };
  }

  return {
    eligible: false,
    minimumHoldouts: PRODUCTION_GATE_MINIMUM_HOLDOUTS,
    reason: `Requires at least ${PRODUCTION_GATE_MINIMUM_HOLDOUTS} representative holdouts; evaluated ${holdoutCount}.`
  };
}

export function evaluateAiRoutingHoldouts(args: {
  evaluationSampleIds: string[];
  validProcessIds: string[];
  supportedWorkCenterProcessPairs?: Array<{
    processId: string;
    workCenterId: string;
  }>;
  cases: AiRoutingEvaluationCaseInput[];
}): AiRoutingEvaluationResult {
  const evaluationIds = new Set(args.evaluationSampleIds);
  const validProcessIds = new Set(args.validProcessIds);
  const supportedWorkCenterProcessPairs = new Set(
    (args.supportedWorkCenterProcessPairs ?? []).map((pair) =>
      workCenterProcessPairKey(pair)
    )
  );
  const caseResults = args.cases.map((input) => {
    const expected = sortedOperations(input.expectedOperations);
    const suggested = sortedOperations(input.suggestedOperations);
    const suggestedIds = suggested
      .map(processId)
      .filter((value): value is string => Boolean(value));
    const expectedNames = expected.map(semanticName).filter(Boolean);
    const suggestedNames = suggested.map(semanticName).filter(Boolean);
    const rawPositionMatchCount = positionMatches(
      expected,
      suggested,
      (left, right) =>
        Boolean(processId(left)) && processId(left) === processId(right)
    );
    const normalizedPositionMatchCount = positionMatches(
      expected,
      suggested,
      (left, right) => semanticName(left) === semanticName(right)
    );
    const semanticMatches = multisetIntersectionCount(
      expectedNames,
      suggestedNames
    );
    const semanticPrecision = ratio(semanticMatches, suggestedNames.length);
    const semanticRecall = ratio(semanticMatches, expectedNames.length);
    const invalidProcessIds = Array.from(
      new Set(suggestedIds.filter((id) => !validProcessIds.has(id)))
    ).sort();
    const evaluationLeakCount = (input.referenceSampleIds ?? []).filter((id) =>
      evaluationIds.has(id)
    ).length;
    const workCenterAssignmentCount = suggested.filter(
      (operation) =>
        Boolean(normalizedText(operation.workCenterId)) ||
        Boolean(normalizedText(operation.workCenterName))
    ).length;
    const unsupportedWorkCenterAssignmentCount = suggested.filter(
      (operation) => {
        const suggestedProcessId = processId(operation);
        const suggestedWorkCenterId = workCenterId(operation);
        if (!suggestedWorkCenterId) return false;
        if (!suggestedProcessId) return true;
        return !supportedWorkCenterProcessPairs.has(
          workCenterProcessPairKey({
            processId: suggestedProcessId,
            workCenterId: suggestedWorkCenterId
          })
        );
      }
    ).length;
    const missingProcessIdCount = suggested.filter(
      (operation) => !processId(operation)
    ).length;
    const maxLength = Math.max(expected.length, suggested.length);

    return {
      evaluationSampleId: input.evaluationSampleId,
      targetItemId: input.targetItemId,
      targetExtractionId: input.targetExtractionId,
      expectedOperationCount: expected.length,
      suggestedOperationCount: suggested.length,
      rawExactSequenceMatch:
        expected.length === suggested.length &&
        rawPositionMatchCount === expected.length,
      normalizedExactSequenceMatch:
        expected.length === suggested.length &&
        normalizedPositionMatchCount === expected.length,
      rawPositionMatchCount,
      normalizedPositionMatchCount,
      orderedSequenceSimilarity: ratio(normalizedPositionMatchCount, maxLength),
      semanticPrecision,
      semanticRecall,
      semanticF1: f1(semanticPrecision, semanticRecall),
      evaluationLeakCount,
      workCenterAssignmentCount,
      unsupportedWorkCenterAssignmentCount,
      missingProcessIdCount,
      invalidProcessIds,
      warnings: [...(input.warnings ?? [])]
    };
  });

  const count = caseResults.length;
  const metrics: AiRoutingEvaluationMetrics = {
    holdoutCount: count,
    rawExactSequenceMatches: caseResults.filter(
      (result) => result.rawExactSequenceMatch
    ).length,
    normalizedExactSequenceMatches: caseResults.filter(
      (result) => result.normalizedExactSequenceMatch
    ).length,
    rawPositionMatchCount: caseResults.reduce(
      (total, result) => total + result.rawPositionMatchCount,
      0
    ),
    normalizedPositionMatchCount: caseResults.reduce(
      (total, result) => total + result.normalizedPositionMatchCount,
      0
    ),
    orderedSequenceSimilarity: ratio(
      caseResults.reduce(
        (total, result) => total + result.normalizedPositionMatchCount,
        0
      ),
      caseResults.reduce(
        (total, result) =>
          total +
          Math.max(
            result.expectedOperationCount,
            result.suggestedOperationCount
          ),
        0
      )
    ),
    semanticPrecision: ratio(
      caseResults.reduce(
        (total, result) =>
          total + result.semanticPrecision * result.suggestedOperationCount,
        0
      ),
      caseResults.reduce(
        (total, result) => total + result.suggestedOperationCount,
        0
      )
    ),
    semanticRecall: ratio(
      caseResults.reduce(
        (total, result) =>
          total + result.semanticRecall * result.expectedOperationCount,
        0
      ),
      caseResults.reduce(
        (total, result) => total + result.expectedOperationCount,
        0
      )
    ),
    semanticF1: 0,
    totalEvaluationLeaks: caseResults.reduce(
      (total, result) => total + result.evaluationLeakCount,
      0
    ),
    totalWorkCenterAssignments: caseResults.reduce(
      (total, result) => total + result.workCenterAssignmentCount,
      0
    ),
    totalUnsupportedWorkCenterAssignments: caseResults.reduce(
      (total, result) => total + result.unsupportedWorkCenterAssignmentCount,
      0
    ),
    totalMissingProcessIds: caseResults.reduce(
      (total, result) => total + result.missingProcessIdCount,
      0
    ),
    invalidProcessIds: Array.from(
      new Set(caseResults.flatMap((result) => result.invalidProcessIds))
    ).sort(),
    productionGate: productionGateForHoldouts(count)
  };
  metrics.semanticF1 = f1(metrics.semanticPrecision, metrics.semanticRecall);

  return { caseResults, metrics };
}

export function buildAiRoutingEvaluationRunRecord(args: {
  companyId: string;
  userId: string;
  trainingSampleIds: string[];
  evaluationSampleIds: string[];
  generatorVersion: string;
  promptVersion?: string | null;
  extractorSchemaVersion: string;
  modelProvider?: string | null;
  modelName?: string | null;
  evaluation: AiRoutingEvaluationResult;
  completedAt: Date;
}): AiRoutingEvaluationRunRecord {
  const trainingSampleIds = Array.from(
    new Set(args.trainingSampleIds.map((id) => id.trim()))
  );
  const evaluationSampleIds = Array.from(
    new Set(args.evaluationSampleIds.map((id) => id.trim()))
  );
  const overlap = trainingSampleIds.filter((id) =>
    evaluationSampleIds.includes(id)
  );
  if (overlap.length > 0) {
    throw new Error(
      `Training and Evaluation sample IDs overlap: ${overlap.join(", ")}`
    );
  }

  return {
    companyId: args.companyId,
    status: "Succeeded",
    trainingSampleIds,
    evaluationSampleIds,
    generatorVersion: args.generatorVersion,
    promptVersion: args.promptVersion ?? null,
    extractorSchemaVersion: args.extractorSchemaVersion,
    modelProvider: args.modelProvider ?? null,
    modelName: args.modelName ?? null,
    caseResults: args.evaluation.caseResults,
    metrics: args.evaluation.metrics,
    createdBy: args.userId,
    completedAt: args.completedAt.toISOString()
  };
}
